import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { hashNodeToken } from '../../packages/auth/src/index.ts'
import { createDb, createSqlClient } from '../../packages/db/src/client.ts'
import { nodeCredentials, nodeJoinTickets, nodes } from '../../packages/db/src/schema.ts'
import { internalTokenHeaderName } from '../../packages/internal-http/src/index.ts'
import { createAgentRuntime } from '../../services/m-net/src/agent-runtime.ts'
import { createMNetApp } from '../../services/m-net/src/app.ts'
import { createMTaskApp } from '../../services/m-task/src/app.ts'
import { createHttpMNetTaskDeliveryPort } from '../../services/m-task/src/mnet-delivery-port.ts'
import { createInMemoryMTaskDeps } from '../../services/m-task/src/testing.ts'
import { createJoinTlsEnv } from '../helpers/tls.ts'
import { waitFor } from '../helpers/wait.ts'

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

type LocalFetchApp = {
  handle(request: Request): Response | Promise<Response>
}

type FetchInput = Parameters<typeof fetch>[0]
type FetchInit = Parameters<typeof fetch>[1]

const joinIngressPort = 19_443
const joinIngressUrl = `wss://localhost:${joinIngressPort}/join/v0/session`
const internalToken = 'task-mnet-integration-token'

const pgAvailable = await (async () => {
  try {
    const client = createSqlClient()
    await client`select 1`
    await client.end()
    return true
  } catch {
    return false
  }
})()

let db: ReturnType<typeof createDb>['db'] | null = null
let client: ReturnType<typeof createDb>['client'] | null = null
let agentRuntime: ReturnType<typeof createAgentRuntime> | null = null
let joinIngress: Awaited<
  ReturnType<ReturnType<typeof createAgentRuntime>['createJoinIngress']>
> | null = null

function readStringField(value: unknown, key: string): string {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`expected object field ${key}`)
  }
  const field = Reflect.get(value, key)
  if (typeof field !== 'string') {
    throw new Error(`expected string field ${key}`)
  }
  return field
}

function deliveryFailureFromPayload(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const value = Reflect.get(payload, 'deliveryFailure')
  return typeof value === 'string' ? value : null
}

function createMNetFixtureApp(runtime: ReturnType<typeof createAgentRuntime>) {
  return createMNetApp({
    async readiness() {
      return { ready: true }
    },
    async createNetwork() {
      return { ok: false, error: { code: 'network.unavailable', message: 'not used' } }
    },
    async listNetworks() {
      return { ok: false, error: { code: 'network.unavailable', message: 'not used' } }
    },
    async joinNetwork() {
      return { ok: false, error: { code: 'network.unavailable', message: 'not used' } }
    },
    async listMembers() {
      return { ok: false, error: { code: 'network.unavailable', message: 'not used' } }
    },
    executeNoop: runtime.executeNoop
  })
}

function localFetcher(app: LocalFetchApp): typeof fetch {
  const fetcher = (input: FetchInput, init?: FetchInit) => {
    const headers = new Headers(init?.headers)
    headers.set(internalTokenHeaderName, internalToken)
    const request =
      typeof input === 'string'
        ? new Request(input, { ...init, headers })
        : input instanceof URL
          ? new Request(input.toString(), { ...init, headers })
          : new Request(input, { ...init, headers })
    return app.handle(request)
  }

  return Object.assign(fetcher, { preconnect: fetch.preconnect }) as typeof fetch
}

function parseSessionMessage(raw: string): ParsedSessionMessage {
  return JSON.parse(raw) as ParsedSessionMessage
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
  if (!db) throw new Error('db not initialized')
  const ticketId = crypto.randomUUID()
  const ticketHash = await hashNodeToken(input.ticket)

  await db.insert(nodeJoinTickets).values({
    id: ticketId,
    ticketHash,
    kind: 'leaf',
    name: input.name,
    capabilities: ['task.execute'],
    status: input.status,
    expiresAt: input.expiresAt,
    createdBy: 'operator',
    createdAt: new Date(),
    redeemedAt: input.status === 'redeemed' ? new Date() : null,
    redeemedNodeId: null
  })

  return ticketId
}

async function cleanupTicket(ticketId: string, nodeId?: string): Promise<void> {
  if (!db) return
  if (nodeId) {
    await db.delete(nodeCredentials).where(eq(nodeCredentials.nodeId, nodeId))
  }

  await db.delete(nodeJoinTickets).where(eq(nodeJoinTickets.id, ticketId))

  if (nodeId) {
    await db.delete(nodes).where(eq(nodes.id, nodeId))
  }
}

async function readNode(nodeId: string): Promise<{ status: string; reachability: string } | null> {
  if (!db) throw new Error('db not initialized')
  const [row] = await db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1)
  if (!row) return null
  return {
    status: row.status,
    reachability: row.reachability
  }
}

async function submitNoop(
  app: ReturnType<typeof createMTaskApp>,
  nodeId: string
): Promise<unknown> {
  const response = await app.handle(
    new Request('http://localhost/api/v0/tasks', {
      method: 'POST',
      headers: {
        authorization: 'Bearer operator-token',
        'content-type': 'application/json',
        'x-correlation-id': `corr-${nodeId}`
      },
      body: JSON.stringify({ nodeId, type: 'noop' })
    })
  )

  expect(response.status).toBe(200)
  return await response.json()
}

describe('M-Task → M-Net → agent noop dispatch integration', () => {
  beforeAll(async () => {
    if (!pgAvailable) return
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    process.env.MERISTEM_INTERNAL_TOKEN = internalToken
    process.env.MERISTEM_OTEL_EXPORTER = 'none'
    process.env.MERISTEM_AGENT_HEARTBEAT_TIMEOUT_MS = '20000'
    process.env.MERISTEM_AGENT_TASK_TIMEOUT_MS = '5000'
    Object.assign(
      process.env,
      createJoinTlsEnv({
        port: joinIngressPort,
        certFile: '.local/certs/join-ingress-cert.pem',
        keyFile: '.local/certs/join-ingress-key.pem'
      })
    )

    const created = createDb()
    db = created.db
    client = created.client

    await import('../../packages/db/src/migrate.ts')

    const runtime = createAgentRuntime({
      db: created.db,
      async publishEvent() {},
      async writeTimeline() {},
      async writeFull() {},
      async writeAudit() {}
    })
    agentRuntime = runtime
    joinIngress = await runtime.createJoinIngress()
  })

  afterAll(async () => {
    if (!pgAvailable) return
    joinIngress?.stop(true)
    if (client) await client.end()
  })

  it.skipIf(!pgAvailable)(
    'delivers noop tasks to an active agent session and records completion evidence',
    async () => {
      const ticket = `noop-${crypto.randomUUID()}`
      const ticketId = await seedJoinTicket({
        ticket,
        status: 'active',
        expiresAt: new Date(Date.now() + 60_000),
        name: `noop-${crypto.randomUUID()}`
      })
      const socket = await openSessionSocket(joinIngressUrl)
      let nodeId: string | undefined

      try {
        const runtime = agentRuntime
        if (!runtime) throw new Error('agent runtime not initialized')
        socket.send({ type: 'join.redeem', ticket })
        const accepted = await socket.waitForMessage(
          message => message.type === 'join.accepted',
          'join'
        )
        nodeId = readStringField(Reflect.get(accepted, 'node'), 'id')
        const sessionId = readStringField(accepted, 'sessionId')

        socket.send({
          type: 'heartbeat',
          sessionId,
          agentVersion: '0.1.0',
          reportedStatus: 'healthy',
          timestamp: new Date().toISOString()
        })

        await waitFor(
          async () => {
            if (!nodeId) return false
            const node = await readNode(nodeId)
            return node?.status === 'healthy' && node.reachability === 'reachable'
          },
          { label: 'node healthy', timeoutMs: 2_000, intervalMs: 25 }
        )

        const mnet = createMNetFixtureApp(runtime)

        const deps = createInMemoryMTaskDeps({ actor: 'operator' })
        const app = createMTaskApp({
          ...deps,
          delivery: createHttpMNetTaskDeliveryPort({
            baseUrl: 'http://internal.test',
            fetcher: localFetcher(mnet)
          })
        })

        const waitForExecute = socket.waitForMessage(
          message => message.type === 'task.execute',
          'task.execute'
        )
        if (!nodeId) throw new Error('node id missing after join acceptance')
        const bodyPromise = submitNoop(app, nodeId)
        const execute = await waitForExecute

        socket.send({
          type: 'task.result',
          sessionId,
          taskId: readStringField(execute, 'taskId'),
          result: 'completed',
          completedAt: '2026-06-18T12:34:56.000Z'
        })

        const body = await bodyPromise
        expect(body).toMatchObject({
          task: {
            nodeId,
            status: 'completed',
            completedAt: '2026-06-18T12:34:56.000Z'
          }
        })
      } finally {
        socket.close()
        await cleanupTicket(ticketId, nodeId)
      }
    },
    15_000
  )

  it.skipIf(!pgAvailable)(
    'fails cleanly when the target node no longer has an active session and records evidence',
    async () => {
      const ticket = `offline-${crypto.randomUUID()}`
      const ticketId = await seedJoinTicket({
        ticket,
        status: 'active',
        expiresAt: new Date(Date.now() + 60_000),
        name: `offline-${crypto.randomUUID()}`
      })
      const socket = await openSessionSocket(joinIngressUrl)
      let nodeId: string | undefined

      try {
        const runtime = agentRuntime
        if (!runtime) throw new Error('agent runtime not initialized')
        socket.send({ type: 'join.redeem', ticket })
        const accepted = await socket.waitForMessage(
          message => message.type === 'join.accepted',
          'join'
        )
        nodeId = readStringField(Reflect.get(accepted, 'node'), 'id')
        const sessionId = readStringField(accepted, 'sessionId')

        socket.send({
          type: 'heartbeat',
          sessionId,
          agentVersion: '0.1.0',
          reportedStatus: 'healthy',
          timestamp: new Date().toISOString()
        })

        await waitFor(
          async () => {
            if (!nodeId) return false
            const node = await readNode(nodeId)
            return node?.status === 'healthy' && node.reachability === 'reachable'
          },
          { label: 'node healthy before disconnect', timeoutMs: 2_000, intervalMs: 25 }
        )

        socket.close()

        await waitFor(
          async () => {
            if (!nodeId) return false
            const node = await readNode(nodeId)
            return node?.status === 'offline'
          },
          { label: 'node offline after disconnect', timeoutMs: 2_000, intervalMs: 25 }
        )

        const mnet = createMNetFixtureApp(runtime)

        const deps = createInMemoryMTaskDeps({ actor: 'operator' })
        const app = createMTaskApp({
          ...deps,
          delivery: createHttpMNetTaskDeliveryPort({
            baseUrl: 'http://internal.test',
            fetcher: localFetcher(mnet)
          })
        })

        if (!nodeId) throw new Error('node id missing after join acceptance')
        const body = await submitNoop(app, nodeId)
        expect(body).toMatchObject({
          task: {
            nodeId,
            status: 'failed'
          }
        })
        expect(
          deps.__testing
            .auditEntries()
            .some(entry => deliveryFailureFromPayload(entry.payload) === 'dispatch.offline')
        ).toBe(true)
        expect(
          deps.__testing.fullEntries().some(entry => entry.message.includes('dispatch.offline'))
        ).toBe(true)
      } finally {
        await cleanupTicket(ticketId, nodeId)
      }
    },
    15_000
  )

  it.skipIf(pgAvailable)(
    'skipped: PostgreSQL unavailable, run docker compose up -d postgres',
    () => {
      expect(pgAvailable).toBe(false)
    }
  )
})
