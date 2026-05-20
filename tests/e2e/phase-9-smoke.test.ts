import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { startProcess, stopProcess, type ManagedProcess } from '../helpers/process.ts'
import { createJoinTlsEnv } from '../helpers/tls.ts'
import { waitFor } from '../helpers/wait.ts'

const baseEnv = {
  ...createJoinTlsEnv({
    port: 8443,
    certFile: '.local/certs/join-ingress-cert.pem',
    keyFile: '.local/certs/join-ingress-key.pem'
  }),
  MERISTEM_INTERNAL_TOKEN: 'phase9-smoke-internal-token',
  MERISTEM_JWT_SECRET: 'phase9-smoke-jwt-secret',
  MERISTEM_BFF_PORT: '3200',
  MERISTEM_CORE_URL: 'http://localhost:3000',
  MERISTEM_AGENT_HEARTBEAT_INTERVAL_MS: '500',
  MERISTEM_AGENT_HEARTBEAT_TIMEOUT_MS: '2000',
  MERISTEM_AGENT_TASK_TIMEOUT_MS: '2000',
  NODE_TLS_REJECT_UNAUTHORIZED: '0'
} as const

let devAll: ManagedProcess | null = null
let bffProcess: ManagedProcess | null = null
let operatorToken = ''
let viewerToken = ''
let securityAdminToken = ''

async function runTextCommand(
  args: string[],
  env: Record<string, string> = {}
): Promise<string> {
  const process = startProcess(['bun', 'run', ...args], {
    env: { ...baseEnv, ...env }
  })
  const exitCode = await process.exited
  if (exitCode !== 0) {
    throw new Error(`command failed: ${process.stderr}`)
  }
  return process.stdout.trim()
}

describe('Phase 9 BFF + Core integration smoke', () => {
  beforeAll(async () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    await import('../../packages/db/src/migrate.ts')
    await import('../../packages/db/src/seed.ts')

    const certs = startProcess(['bun', 'run', 'scripts/certs-dev.ts'], {
      env: baseEnv
    })
    const certsExit = await certs.exited
    if (certsExit !== 0) {
      throw new Error(`failed to generate certs\n${certs.stderr}`)
    }

    operatorToken = await runTextCommand(['token:mint', '--actor', 'operator'])
    viewerToken = await runTextCommand(['token:mint', '--actor', 'viewer'])
    securityAdminToken = await runTextCommand([
      'token:mint',
      '--actor',
      'security-admin'
    ])

    devAll = startProcess(['bun', 'run', 'dev:all'], { env: baseEnv })

    await waitFor(
      () =>
        devAll?.stdout.includes(
          'meristem-core listening on http://localhost:3000'
        ) ?? false,
      { label: 'core startup', timeoutMs: 20_000, intervalMs: 100 }
    )
    await waitFor(
      () =>
        devAll?.stdout.includes(
          'm-net join ingress listening on https://0.0.0.0:8443'
        ) ?? false,
      { label: 'm-net join ingress startup', timeoutMs: 20_000, intervalMs: 100 }
    )

    bffProcess = startProcess(['bun', 'run', 'dev:m-ui-bff'], { env: baseEnv })
    await waitFor(
      () =>
        bffProcess?.stdout.includes('m-ui-bff listening on') ?? false,
      { label: 'bff startup', timeoutMs: 10_000, intervalMs: 100 }
    )
  })

  afterAll(async () => {
    if (bffProcess) await stopProcess(bffProcess)
    if (devAll) await stopProcess(devAll)
  })

  it('BFF health and ready endpoints respond correctly', async () => {
    const health = await fetch('http://localhost:3200/health').then((r) =>
      r.json()
    )
    expect(health.ok).toBe(true)
    expect(health.service).toBe('m-ui-bff')

    const ready = await fetch('http://localhost:3200/ready').then((r) =>
      r.json()
    )
    expect(ready.ready).toBe(true)
  })

  it('BFF overview returns correct shape with operator token', async () => {
    const res = await fetch('http://localhost:3200/api/v0/overview', {
      headers: { authorization: `Bearer ${operatorToken}` }
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.session.actor).toBe('operator')
    expect(Array.isArray(body.session.permissions)).toBe(true)
    expect(body.session.permissions).toContain('task:assign')
    expect(body.core.id).toBe('meristem-core')
    expect(Array.isArray(body.nodes)).toBe(true)
    expect(Array.isArray(body.services)).toBe(true)
    expect(Array.isArray(body.timeline)).toBe(true)
    expect(typeof body.auditAccessible).toBe('boolean')
  })

  it('BFF overview returns 401 without token', async () => {
    const res = await fetch('http://localhost:3200/api/v0/overview')
    expect(res.status).toBe(401)
  })

  it('BFF overview with viewer token shows auditAccessible false', async () => {
    const res = await fetch('http://localhost:3200/api/v0/overview', {
      headers: { authorization: `Bearer ${viewerToken}` }
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.session.actor).toBe('viewer')
    expect(body.auditAccessible).toBe(false)
  })
})
