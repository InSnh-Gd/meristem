import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { hashNodeToken } from '../../packages/auth/src/index.ts'
import { createDb, createSqlClient } from '../../packages/db/src/client.ts'
import { nodeCredentials, nodeJoinTickets, nodes } from '../../packages/db/src/schema.ts'
import {
  type ManagedProcess,
  startBunScript,
  startProcess,
  stopProcess
} from '../helpers/process.ts'
import { createJoinTlsEnv } from '../helpers/tls.ts'
import { waitFor, waitForOutput } from '../helpers/wait.ts'

type ParsedSessionMessage = {
  readonly type: string
  readonly [key: string]: unknown
}

type ManagedSessionSocket = {
  readonly socket: WebSocket
  send(message: unknown): void
  waitForMessage(
    predicate: (message: ParsedSessionMessage) => boolean,
    label: string,
    timeoutMs?: number
  ): Promise<ParsedSessionMessage>
  close(): void
}

const { db, client } = createDb()
const joinIngressPort = 18_443
const joinIngressUrl = `wss://localhost:${joinIngressPort}/join/v0/session`
const joinIngressSessionTimeoutMs = 15_000
const pgAvailable = await (async () => {
  try {
    const sql = createSqlClient()
    await sql`select 1`
    await sql.end()
    return true
  } catch {
    return false
  }
})()

let logMock: ManagedProcess | null = null
let eventBusMock: ManagedProcess | null = null
let mnet: ManagedProcess | null = null

function parseSessionMessage(raw: string): ParsedSessionMessage {
  return JSON.parse(raw) as ParsedSessionMessage
}

function createMockInternalService(port: number, label: string): ManagedProcess {
  return startBunScript(`
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: ${port},
      fetch() {
        return Response.json({ ok: true, service: '${label}' })
      }
    })

    console.log('${label} ready')

    process.on('SIGINT', () => {
      server.stop(true)
      process.exit(0)
    })

    await new Promise(() => {})
  `)
}

async function startMNetService(): Promise<ManagedProcess> {
  return startProcess(['bun', 'run', 'services/m-net/src/index.ts'], {
    env: {
      ...createJoinTlsEnv({
        port: joinIngressPort,
        certFile: '.local/certs/join-ingress-cert.pem',
        keyFile: '.local/certs/join-ingress-key.pem'
      }),
      MERISTEM_INTERNAL_TOKEN: 'test-internal-token',
      MERISTEM_AGENT_HEARTBEAT_TIMEOUT_MS: '20000',
      MERISTEM_AGENT_TASK_TIMEOUT_MS: '5000'
    }
  })
}

async function waitForServiceReady(process: ManagedProcess, label: string): Promise<void> {
  await waitForOutput(() => process.stdout, {
    text: label,
    label,
    timeoutMs: 5_000,
    intervalMs: 25
  })
}

function openSessionSocket(url: string): Promise<ManagedSessionSocket> {
  return new Promise((resolve, reject) => {
    const messages: ParsedSessionMessage[] = []
    const socket = new WebSocket(url)

    const cleanupLifecycleListeners = (): void => {
      socket.removeEventListener('open', onOpen)
      socket.removeEventListener('error', onError)
    }

    const onMessage = (event: MessageEvent): void => {
      if (typeof event.data !== 'string') return
      messages.push(parseSessionMessage(event.data))
    }

    const onError = (): void => {
      cleanupLifecycleListeners()
      reject(new Error('websocket connection failed'))
    }

    const onOpen = (): void => {
      cleanupLifecycleListeners()
      resolve({
        socket,
        send(message: unknown): void {
          socket.send(JSON.stringify(message))
        },
        async waitForMessage(
          predicate: (message: ParsedSessionMessage) => boolean,
          label: string,
          timeoutMs = 2_000
        ): Promise<ParsedSessionMessage> {
          const existing = messages.find(predicate)
          if (existing) return existing

          return await new Promise<ParsedSessionMessage>((resolveMessage, rejectMessage) => {
            const timer = setTimeout(() => {
              socket.removeEventListener('message', onBufferedMessage)
              rejectMessage(new Error(`${label} timed out after ${timeoutMs}ms`))
            }, timeoutMs)

            const onBufferedMessage = (event: MessageEvent): void => {
              if (typeof event.data !== 'string') return
              const parsed = parseSessionMessage(event.data)
              messages.push(parsed)
              if (!predicate(parsed)) return
              clearTimeout(timer)
              socket.removeEventListener('message', onBufferedMessage)
              resolveMessage(parsed)
            }

            socket.addEventListener('message', onBufferedMessage)
          })
        },
        close(): void {
          socket.close()
        }
      })
    }

    socket.addEventListener('message', onMessage)
    socket.addEventListener('error', onError)
    socket.addEventListener('open', onOpen)
  })
}

async function seedJoinTicket(input: {
  readonly ticket: string
  readonly status: 'active' | 'expired' | 'redeemed' | 'revoked'
  readonly expiresAt: Date
  readonly name: string
}): Promise<string> {
  const ticketId = crypto.randomUUID()
  const ticketHash = await hashNodeToken(input.ticket)

  await db.insert(nodeJoinTickets).values({
    id: ticketId,
    ticketHash,
    kind: 'leaf',
    name: input.name,
    capabilities: [],
    status: input.status,
    expiresAt: input.expiresAt,
    createdBy: 'operator',
    createdAt: new Date(),
    redeemedAt: input.status === 'redeemed' ? new Date() : null,
    redeemedNodeId: null
  })

  return ticketId
}

async function readNode(nodeId: string): Promise<{ status: string; reachability: string } | null> {
  const [row] = await db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1)
  if (!row) return null
  return {
    status: row.status,
    reachability: row.reachability
  }
}

async function cleanupTicket(ticketId: string, nodeId?: string): Promise<void> {
  if (nodeId) {
    await db.delete(nodeCredentials).where(eq(nodeCredentials.nodeId, nodeId))
  }

  await db.delete(nodeJoinTickets).where(eq(nodeJoinTickets.id, ticketId))

  if (nodeId) {
    await db.delete(nodes).where(eq(nodes.id, nodeId))
  }
}

function closeManagedSessionSocket(socket: ManagedSessionSocket | null): void {
  socket?.close()
}

/**
 * Integration tests here drive the real join ingress so the session boundary is exercised
 * against Bun WebSockets, PostgreSQL, and the internal log/event callers together.
 */
describe('M-Net join ingress session handling', () => {
  beforeAll(async () => {
    if (!pgAvailable) return
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    await import('../../packages/db/src/migrate.ts')
    eventBusMock = createMockInternalService(3103, 'm-eventbus')
    logMock = createMockInternalService(3102, 'm-log')

    await waitForServiceReady(eventBusMock, 'm-eventbus ready')
    await waitForServiceReady(logMock, 'm-log ready')

    mnet = await startMNetService()
    await waitForServiceReady(mnet, 'm-net join ingress listening')
  })

  afterAll(async () => {
    const processes = [mnet, logMock, eventBusMock].filter(
      (process): process is ManagedProcess => process !== null
    )
    for (const process of processes.reverse()) {
      await stopProcess(process)
    }
    await client.end()
  })

  it('skips gracefully when PostgreSQL is unavailable', () => {
    expect(typeof pgAvailable).toBe('boolean')
  })

  it(
    'treats a resumed websocket as the active session and ignores stale frames from the superseded socket',
    async () => {
      if (!pgAvailable) return
      const ticket = `supersede-${crypto.randomUUID()}`
      const ticketId = await seedJoinTicket({
        ticket,
        status: 'active',
        expiresAt: new Date(Date.now() + 60_000),
        name: `supersede-${crypto.randomUUID()}`
      })
      let firstSocket: ManagedSessionSocket | null = null
      let secondSocket: ManagedSessionSocket | null = null
      let nodeId: string | undefined

      try {
        firstSocket = await openSessionSocket(joinIngressUrl)
        firstSocket.send({ type: 'join.redeem', ticket })
        const accepted = await firstSocket.waitForMessage(
          message => message.type === 'join.accepted',
          'join.accepted'
        )

        nodeId = String((accepted.node as { id: string }).id)
        const joinedNodeId = nodeId
        const runtimeToken = String(accepted.runtimeToken)
        const firstSessionId = String(accepted.sessionId)

        firstSocket.send({
          type: 'heartbeat',
          sessionId: firstSessionId,
          agentVersion: '0.1.0',
          reportedStatus: 'healthy',
          timestamp: new Date().toISOString()
        })

        await waitFor(
          async () => {
            const node = await readNode(joinedNodeId)
            return node?.status === 'healthy' && node.reachability === 'reachable'
          },
          {
            label: 'initial heartbeat state',
            timeoutMs: 2_000,
            intervalMs: 25
          }
        )

        secondSocket = await openSessionSocket(joinIngressUrl)
        secondSocket.send({
          type: 'session.resume',
          nodeId: joinedNodeId,
          token: runtimeToken
        })

        const resumed = await secondSocket.waitForMessage(
          message => message.type === 'session.resumed',
          'session.resumed'
        )
        const secondSessionId = String(resumed.sessionId)

        firstSocket.send({
          type: 'heartbeat',
          sessionId: firstSessionId,
          agentVersion: '0.1.1',
          reportedStatus: 'degraded',
          timestamp: new Date().toISOString()
        })

        secondSocket.send({
          type: 'heartbeat',
          sessionId: secondSessionId,
          agentVersion: '0.1.0',
          reportedStatus: 'healthy',
          timestamp: new Date().toISOString()
        })

        await Bun.sleep(100)

        const node = await readNode(joinedNodeId)
        expect(node).not.toBeNull()
        expect(node?.status).toBe('healthy')
        expect(node?.reachability).toBe('reachable')
      } finally {
        closeManagedSessionSocket(firstSocket)
        closeManagedSessionSocket(secondSocket)
        await cleanupTicket(ticketId, nodeId)
      }
    },
    joinIngressSessionTimeoutMs
  )

  it('returns stable join ticket errors and only redeems a ticket once', async () => {
    if (!pgAvailable) return
    const expiredTicket = `expired-${crypto.randomUUID()}`
    const revokedTicket = `revoked-${crypto.randomUUID()}`
    const redeemedTicket = `redeemed-${crypto.randomUUID()}`
    const invalidTicket = `invalid-${crypto.randomUUID()}`

    const expiredTicketId = await seedJoinTicket({
      ticket: expiredTicket,
      status: 'active',
      expiresAt: new Date(Date.now() - 1_000),
      name: `expired-${crypto.randomUUID()}`
    })
    const revokedTicketId = await seedJoinTicket({
      ticket: revokedTicket,
      status: 'revoked',
      expiresAt: new Date(Date.now() + 60_000),
      name: `revoked-${crypto.randomUUID()}`
    })
    const redeemedTicketId = await seedJoinTicket({
      ticket: redeemedTicket,
      status: 'redeemed',
      expiresAt: new Date(Date.now() + 60_000),
      name: `redeemed-${crypto.randomUUID()}`
    })
    const activeTicket = `single-use-${crypto.randomUUID()}`
    const activeTicketId = await seedJoinTicket({
      ticket: activeTicket,
      status: 'active',
      expiresAt: new Date(Date.now() + 60_000),
      name: `single-use-${crypto.randomUUID()}`
    })

    const openAndRedeem = async (ticketValue: string): Promise<ParsedSessionMessage> => {
      const socket = await openSessionSocket(joinIngressUrl)
      try {
        socket.send({ type: 'join.redeem', ticket: ticketValue })
        return await socket.waitForMessage(
          value => value.type === 'join.accepted' || value.type === 'error',
          `response for ${ticketValue}`
        )
      } finally {
        socket.close()
      }
    }

    let firstSocket: ManagedSessionSocket | null = null
    let secondSocket: ManagedSessionSocket | null = null
    let nodeId: string | undefined

    try {
      await expect(openAndRedeem(invalidTicket)).resolves.toMatchObject({
        type: 'error',
        code: 'node.join_ticket_invalid'
      })
      await expect(openAndRedeem(expiredTicket)).resolves.toMatchObject({
        type: 'error',
        code: 'node.join_ticket_expired'
      })
      await expect(openAndRedeem(revokedTicket)).resolves.toMatchObject({
        type: 'error',
        code: 'node.join_ticket_revoked'
      })
      await expect(openAndRedeem(redeemedTicket)).resolves.toMatchObject({
        type: 'error',
        code: 'node.join_ticket_redeemed'
      })

      firstSocket = await openSessionSocket(joinIngressUrl)
      secondSocket = await openSessionSocket(joinIngressUrl)

      firstSocket.send({ type: 'join.redeem', ticket: activeTicket })
      secondSocket.send({ type: 'join.redeem', ticket: activeTicket })

      const [firstResponse, secondResponse] = await Promise.all([
        firstSocket.waitForMessage(
          value => value.type === 'join.accepted' || value.type === 'error',
          'first redemption response'
        ),
        secondSocket.waitForMessage(
          value => value.type === 'join.accepted' || value.type === 'error',
          'second redemption response'
        )
      ])

      const acceptedCount = [firstResponse, secondResponse].filter(
        message => message.type === 'join.accepted'
      ).length
      const errorCodes = [firstResponse, secondResponse]
        .filter(
          (message): message is ParsedSessionMessage & { code: string } => message.type === 'error'
        )
        .map(message => message.code)

      expect(acceptedCount).toBe(1)
      expect(errorCodes).toContain('node.join_ticket_redeemed')

      const accepted = [firstResponse, secondResponse].find(
        message => message.type === 'join.accepted'
      )
      nodeId = accepted ? String((accepted.node as { id: string }).id) : undefined
    } finally {
      closeManagedSessionSocket(firstSocket)
      closeManagedSessionSocket(secondSocket)
      await cleanupTicket(expiredTicketId)
      await cleanupTicket(revokedTicketId)
      await cleanupTicket(redeemedTicketId)
      await cleanupTicket(activeTicketId, nodeId)
    }
  })
})
