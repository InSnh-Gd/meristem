import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { startProcess, stopProcess, type ManagedProcess } from '../helpers/process.ts'
import { createJoinTlsEnv } from '../helpers/tls.ts'
import { waitFor } from '../helpers/wait.ts'

type CliJson = Record<string, unknown>
type ParsedSessionMessage = {
  readonly type: string
  readonly [key: string]: unknown
}
type NodeListResponse = {
  nodes: Array<{
    id: string
    name: string
    mode: string
    status: string
    reachability: string
  }>
}

const smokeName = `phase8-smoke-${crypto.randomUUID()}`
const coreUrl = 'http://localhost:3000'
const baseEnv = {
  ...createJoinTlsEnv({
    port: 8443,
    certFile: '.local/certs/join-ingress-cert.pem',
    keyFile: '.local/certs/join-ingress-key.pem'
  }),
  MERISTEM_INTERNAL_TOKEN: 'phase8-smoke-internal-token',
  MERISTEM_JWT_SECRET: 'phase8-smoke-jwt-secret',
  MERISTEM_AGENT_HEARTBEAT_INTERVAL_MS: '500',
  MERISTEM_AGENT_HEARTBEAT_TIMEOUT_MS: '2000',
  MERISTEM_AGENT_TASK_TIMEOUT_MS: '2000',
  NODE_TLS_REJECT_UNAUTHORIZED: '0'
} as const

let devAll: ManagedProcess | null = null
let nodeAgent: ManagedProcess | null = null
let operatorToken = ''
let securityAdminToken = ''

async function runJsonCommand(args: string[], env: Record<string, string> = {}): Promise<CliJson> {
  const process = startProcess(['bun', 'run', ...args], {
    env: {
      ...baseEnv,
      ...env
    }
  })
  const exitCode = await process.exited
  if (exitCode !== 0) {
    throw new Error(`command failed: bun run ${args.join(' ')}\n${process.stderr}`)
  }
  return JSON.parse(process.stdout) as CliJson
}

async function runTextCommand(args: string[], env: Record<string, string> = {}): Promise<string> {
  const process = startProcess(['bun', 'run', ...args], {
    env: {
      ...baseEnv,
      ...env
    }
  })
  const exitCode = await process.exited
  if (exitCode !== 0) {
    throw new Error(`command failed: bun run ${args.join(' ')}\n${process.stderr}`)
  }
  return process.stdout.trim()
}

function openSessionSocket(url: string): Promise<{
  readonly socket: WebSocket
  send(message: unknown): void
  waitForMessage(predicate: (message: ParsedSessionMessage) => boolean, label: string, timeoutMs?: number): Promise<ParsedSessionMessage>
  close(): void
}> {
  return new Promise((resolve, reject) => {
    const messages: ParsedSessionMessage[] = []
    const socket = new WebSocket(url)

    const cleanupLifecycleListeners = (): void => {
      socket.removeEventListener('open', onOpen)
      socket.removeEventListener('error', onError)
    }

    const onMessage = (event: MessageEvent): void => {
      if (typeof event.data !== 'string') return
      messages.push(JSON.parse(event.data) as ParsedSessionMessage)
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
        async waitForMessage(predicate: (message: ParsedSessionMessage) => boolean, label: string, timeoutMs = 2_000): Promise<ParsedSessionMessage> {
          const existing = messages.find(predicate)
          if (existing) return existing

          return await new Promise<ParsedSessionMessage>((resolveMessage, rejectMessage) => {
            const timer = setTimeout(() => {
              socket.removeEventListener('message', onBufferedMessage)
              rejectMessage(new Error(`${label} timed out after ${timeoutMs}ms`))
            }, timeoutMs)

            const onBufferedMessage = (event: MessageEvent): void => {
              if (typeof event.data !== 'string') return
              const parsed = JSON.parse(event.data) as ParsedSessionMessage
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

async function fetchCoreJson(path: string, token: string): Promise<unknown> {
  const response = await fetch(`${coreUrl}${path}`, {
    headers: {
      authorization: `Bearer ${token}`
    }
  })
  if (!response.ok) {
    throw new Error(`request failed for ${path}: ${response.status}`)
  }
  return await response.json() as unknown
}

async function listNodes(): Promise<NodeListResponse> {
  return await runJsonCommand(['meristem', 'node', 'list'], {
    MERISTEM_TOKEN: operatorToken
  }) as NodeListResponse
}

describe('Phase 8 real-process smoke', () => {
  beforeAll(async () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    await import('../../packages/db/src/migrate.ts')
    await import('../../packages/db/src/seed.ts')
    const certs = startProcess(['bun', 'run', 'scripts/certs-dev.ts'], { env: baseEnv })
    const certsExit = await certs.exited
    if (certsExit !== 0) {
      throw new Error(`failed to generate join ingress certs\n${certs.stderr}`)
    }

    operatorToken = await runTextCommand(['token:mint', '--actor', 'operator'])
    securityAdminToken = await runTextCommand(['token:mint', '--actor', 'security-admin'])

    devAll = startProcess(['bun', 'run', 'dev:all'], { env: baseEnv })

    await waitFor(() => devAll?.stdout.includes('meristem-core listening on http://localhost:3000') ?? false, {
      label: 'core startup',
      timeoutMs: 20_000,
      intervalMs: 100
    })
    await waitFor(() => devAll?.stdout.includes('m-net join ingress listening on https://0.0.0.0:8443') ?? false, {
      label: 'm-net join ingress startup',
      timeoutMs: 20_000,
      intervalMs: 100
    })
  })

  afterAll(async () => {
    if (nodeAgent) await stopProcess(nodeAgent)
    if (devAll) await stopProcess(devAll)
  })

  it('redeems a Join Ticket, resumes a real node-agent, completes noop, and recovers offline after shutdown', async () => {
    const ticketResponse = await runJsonCommand([
      'meristem',
      'node',
      'ticket',
      'create',
      '--kind',
      'leaf',
      '--name',
      smokeName
    ], {
      MERISTEM_TOKEN: operatorToken
    })

    const ticket = String(ticketResponse.ticket)
    const joinUrl = String(ticketResponse.joinUrl)
    const joinSocket = await openSessionSocket(joinUrl)
    joinSocket.send({ type: 'join.redeem', ticket })
    const accepted = await joinSocket.waitForMessage((message) => message.type === 'join.accepted', 'join.accepted')
    const runtimeToken = String(accepted.runtimeToken)
    const nodeId = String((accepted.node as { id: string }).id)
    joinSocket.close()

    nodeAgent = startProcess(['bun', 'run', 'dev:node-agent'], {
      env: {
        ...baseEnv,
        MERISTEM_NODE_ID: nodeId,
        MERISTEM_NODE_TOKEN: runtimeToken,
        MERISTEM_JOIN_URL: joinUrl
      }
    })

    await waitFor(() => nodeAgent?.stdout.includes('node-agent resumed session for') ?? false, {
      label: 'node-agent resume',
      timeoutMs: 20_000,
      intervalMs: 100
    })
    expect(nodeAgent.stdout).not.toContain(runtimeToken)
    expect(nodeAgent.stderr).not.toContain(runtimeToken)
    expect(nodeAgent.stdout).not.toContain('runtime token')
    expect(nodeAgent.stderr).not.toContain('runtime token')

    await waitFor(async () => {
      const response = await listNodes()
      const node = response.nodes.find((entry) => entry.name === smokeName)
      if (!node) return false
      return node.mode === 'agent' && node.status === 'healthy' && node.reachability === 'reachable'
    }, {
      label: 'agent healthy state',
      timeoutMs: 20_000,
      intervalMs: 200
    })

    const taskResponse = await runJsonCommand([
      'meristem',
      'task',
      'assign',
      '--leaf',
      nodeId,
      '--type',
      'noop'
    ], {
      MERISTEM_TOKEN: operatorToken
    })

    expect((taskResponse.task as { status: string }).status).toBe('completed')

    const fullLogs = await fetchCoreJson('/api/v0/logs/full', operatorToken)
    const auditLogs = await fetchCoreJson('/api/v0/audit', securityAdminToken)
    const logDump = JSON.stringify({ fullLogs, auditLogs })
    expect(logDump).not.toContain(runtimeToken)

    await stopProcess(nodeAgent)
    nodeAgent = null

    await waitFor(async () => {
      const response = await listNodes()
      const node = response.nodes.find((entry) => entry.id === nodeId)
      return node?.status === 'offline' && node.reachability === 'unreachable'
    }, {
      label: 'agent offline recovery',
      timeoutMs: 20_000,
      intervalMs: 200
    })
  }, 30_000)
})
