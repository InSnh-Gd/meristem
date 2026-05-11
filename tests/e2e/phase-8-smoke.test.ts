import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { startProcess, stopProcess, type ManagedProcess } from '../helpers/process.ts'
import { createJoinTlsEnv } from '../helpers/tls.ts'
import { waitFor } from '../helpers/wait.ts'

type CliJson = Record<string, unknown>
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

async function listNodes(): Promise<NodeListResponse> {
  return await runJsonCommand(['meristem', 'node', 'list'], {
    MERISTEM_TOKEN: operatorToken
  }) as NodeListResponse
}

describe('Phase 8 real-process smoke', () => {
  beforeAll(async () => {
    await import('../../packages/db/src/migrate.ts')
    await import('../../packages/db/src/seed.ts')
    const certs = startProcess(['bun', 'run', 'scripts/certs-dev.ts'], { env: baseEnv })
    const certsExit = await certs.exited
    if (certsExit !== 0) {
      throw new Error(`failed to generate join ingress certs\n${certs.stderr}`)
    }

    const mintedToken = startProcess(['bun', 'run', 'token:mint', '--actor', 'operator'], { env: baseEnv })
    const mintedExit = await mintedToken.exited
    if (mintedExit !== 0) {
      throw new Error(`failed to mint operator token\n${mintedToken.stderr}`)
    }
    operatorToken = mintedToken.stdout.trim()

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

  it('joins a real node-agent, completes noop, and recovers offline after shutdown', async () => {
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

    nodeAgent = startProcess(['bun', 'run', 'dev:node-agent'], {
      env: {
        ...baseEnv,
        MERISTEM_JOIN_TICKET: ticket,
        MERISTEM_JOIN_URL: joinUrl
      }
    })

    await waitFor(() => nodeAgent?.stdout.includes('node-agent joined as') ?? false, {
      label: 'node-agent join',
      timeoutMs: 20_000,
      intervalMs: 100
    })
    expect(nodeAgent.stdout).not.toContain('; runtime token ')
    expect(nodeAgent.stderr).not.toContain('runtime token')

    let nodeId = ''
    await waitFor(async () => {
      const response = await listNodes()
      const node = response.nodes.find((entry) => entry.name === smokeName)
      if (!node) return false
      nodeId = node.id
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
  })
})
