import { startProcess, stopProcess, type ManagedProcess } from '../helpers/process.ts'
import { createJoinTlsEnv } from '../helpers/tls.ts'
import { waitFor } from '../helpers/wait.ts'
import { createSqlClient } from '../../packages/db/src/client.ts'
import { connectToNats } from '../../packages/nats-rpc/src/index.ts'

export const coreUrl = 'http://localhost:3000'
export const bffUrl = 'http://localhost:3200'
export const taskUrl = 'http://localhost:3105'

export const baseEnv = {
  ...createJoinTlsEnv({
    port: 8443,
    certFile: '.local/certs/join-ingress-cert.pem',
    keyFile: '.local/certs/join-ingress-key.pem'
  }),
  MERISTEM_INTERNAL_TOKEN: 'e2e-internal-token',
  MERISTEM_JWT_SECRET: 'e2e-jwt-secret',
  MERISTEM_BFF_PORT: '3200',
  MERISTEM_CORE_URL: 'http://localhost:3000',
  MERISTEM_TASK_URL: 'http://localhost:3105',
  MERISTEM_AGENT_HEARTBEAT_INTERVAL_MS: '500',
  MERISTEM_AGENT_HEARTBEAT_TIMEOUT_MS: '2000',
  MERISTEM_AGENT_TASK_TIMEOUT_MS: '2000',
  NODE_TLS_REJECT_UNAUTHORIZED: '0'
} as const

/**
 * 检测 PostgreSQL 与 NATS 是否可达。e2e 套件在基础设施不可用时跳过，
 * 避免在 CI 未启动依赖时产生误报。
 */
export async function infrastructureAvailable(): Promise<boolean> {
  let pgOk = false
  let natsOk = false
  try {
    const client = createSqlClient()
    await client`select 1`
    await client.end()
    pgOk = true
  } catch {
    pgOk = false
  }
  try {
    const nc = await connectToNats('ws://localhost:4223')
    await nc.drain()
    natsOk = true
  } catch {
    natsOk = false
  }
  return pgOk && natsOk
}

/**
 * 启动完整服务栈：migrate + seed + certs + token mint + dev:all + BFF。
 * 返回管理句柄和三种角色的 token。
 */
export async function startFullStack(): Promise<{
  devAll: ManagedProcess
  bffProcess: ManagedProcess
  operatorToken: string
  adminToken: string
  viewerToken: string
  securityAdminToken: string
}> {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

  await import('../../packages/db/src/migrate.ts')
  await import('../../packages/db/src/seed.ts')

  const certs = startProcess(['bun', 'run', 'scripts/certs-dev.ts'], { env: baseEnv })
  const certsExit = await certs.exited
  if (certsExit !== 0) throw new Error(`certs failed:\n${certs.stderr}`)

  const operatorToken = await runTextCommand(['token:mint', '--actor', 'operator'])
  const adminToken = await runTextCommand(['token:mint', '--actor', 'admin'])
  const viewerToken = await runTextCommand(['token:mint', '--actor', 'viewer'])
  const securityAdminToken = await runTextCommand(['token:mint', '--actor', 'security-admin'])

  const devAll = startProcess(['bun', 'run', 'dev:all'], { env: baseEnv })
  await waitFor(
    () =>
      devAll.stdout.includes('meristem-core listening on http://localhost:3000') ||
      devAll.stdout.includes('meristem-core listening on http://127.0.0.1:3000'),
    { label: 'core startup', timeoutMs: 20_000, intervalMs: 100 }
  )
  await waitFor(
    () => devAll.stdout.includes('m-task listening on http://127.0.0.1:3105'),
    { label: 'm-task startup', timeoutMs: 20_000, intervalMs: 100 }
  )
  await waitFor(
    () => devAll.stdout.includes('m-net join ingress listening on https://0.0.0.0:8443'),
    { label: 'm-net join ingress startup', timeoutMs: 20_000, intervalMs: 100 }
  )

  const bffProcess = startProcess(['bun', 'run', 'dev:m-ui-bff'], { env: baseEnv })
  await waitFor(
    () => bffProcess.stdout.includes('m-ui-bff listening on'),
    { label: 'bff startup', timeoutMs: 10_000, intervalMs: 100 }
  )

  return { devAll, bffProcess, operatorToken, adminToken, viewerToken, securityAdminToken }
}

/**
 * 停止完整服务栈，按 BFF -> Core 的顺序优雅关闭。
 */
export async function stopFullStack(devAll: ManagedProcess, bffProcess: ManagedProcess): Promise<void> {
  await stopProcess(bffProcess)
  await stopProcess(devAll)
}

/**
 * 运行 CLI 命令并返回 stdout 文本。
 */
export async function runTextCommand(
  args: string[],
  env: Record<string, string> = {}
): Promise<string> {
  const proc = startProcess(['bun', 'run', ...args], { env: { ...baseEnv, ...env } })
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(`command failed: bun run ${args.join(' ')}\n${proc.stderr}`)
  }
  return proc.stdout.trim()
}

/**
 * 对 Core REST 发起 HTTP 请求，自动注入 Bearer token 和 content-type。
 */
export async function coreFetch(
  path: string,
  token?: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${coreUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    }
  })
  const data = res.status !== 204 ? (await res.json().catch(() => ({}))) : {}
  return { ok: res.ok, status: res.status, data }
}

/**
 * 对 M-Task REST 发起 HTTP 请求，验证 Phase 11 后任务入口不再经过 Core。
 */
export async function taskFetch(
  path: string,
  token?: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${taskUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    }
  })
  const data = res.status !== 204 ? (await res.json().catch(() => ({}))) : {}
  return { ok: res.ok, status: res.status, data }
}

/**
 * 对 BFF 发起 HTTP 请求，自动注入 Bearer token 和 content-type。
 */
export async function bffFetch(
  path: string,
  token?: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${bffUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    }
  })
  const data = res.status !== 204 ? (await res.json().catch(() => ({}))) : {}
  return { ok: res.ok, status: res.status, data }
}
