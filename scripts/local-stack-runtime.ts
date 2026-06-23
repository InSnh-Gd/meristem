import {
  NETWORK_MAP_SIGNING_KEY_ID_ENV_KEY,
  NETWORK_MAP_SIGNING_PRIVATE_KEY_ENV_KEY,
  NETWORK_MAP_SIGNING_PRIVATE_KEY_FILE_ENV_KEY,
  NETWORK_MAP_SIGNING_PUBLIC_KEY_ENV_KEY,
  resolveNetworkMapSigningKeyMaterial
} from '../services/m-net/src/network-map-signing.ts'

export const rootDir = import.meta.dir.replace(/\/scripts$/, '')

export type InfraProfiles = {
  opensearch: boolean
  redis: boolean
  apisix: boolean
}

export type LocalServiceCommand = {
  cwd?: string
  label: string
  command: string[]
}

export const coreServiceCommands: readonly LocalServiceCommand[] = [
  {
    label: 'dev:m-eventbus',
    command: ['bun', 'run', 'services/m-eventbus/src/index.ts']
  },
  {
    label: 'dev:m-policy',
    command: ['bun', 'run', 'services/m-policy/src/index.ts']
  },
  {
    label: 'dev:m-log',
    command: ['bun', 'run', 'services/m-log/src/index.ts']
  },
  {
    label: 'dev:m-net',
    command: ['bun', 'run', 'services/m-net/src/index.ts']
  },
  {
    label: 'dev:m-task',
    command: ['bun', 'run', 'services/m-task/src/index.ts']
  },
  {
    label: 'dev:m-extension',
    command: ['bun', 'run', 'services/m-extension/src/index.ts']
  },
  {
    label: 'dev:core-app',
    command: ['bun', 'run', 'apps/core/src/index.ts']
  }
] as const

export const webUiServiceCommands: readonly LocalServiceCommand[] = [
  {
    label: 'dev:m-ui-bff',
    command: ['bun', 'run', 'services/m-ui-bff/src/index.ts']
  },
  {
    label: 'dev:m-ui',
    cwd: `${rootDir}/apps/m-ui`,
    command: ['bun', 'run', 'dev', '--', '--clearScreen', 'false']
  }
] as const

export const deployedWebUiServiceCommands: readonly LocalServiceCommand[] = [
  {
    label: 'dev:m-ui-bff',
    command: ['bun', 'run', 'services/m-ui-bff/src/index.ts']
  },
  {
    label: 'deploy:m-ui',
    command: ['bun', 'run', 'scripts/run-m-ui-local.ts']
  }
] as const

export type CommandResult = {
  exitCode: number
  stderr: string
  stdout: string
}

export function profileFlagsFromArgv(argv = Bun.argv): InfraProfiles {
  return {
    opensearch: argv.includes('--opensearch'),
    redis: argv.includes('--redis'),
    apisix: argv.includes('--apisix')
  }
}

export function run(command: string[], cwd = rootDir, env = process.env): CommandResult {
  const result = Bun.spawnSync(command, {
    cwd,
    env,
    stdout: 'pipe',
    stderr: 'pipe'
  })

  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString()
  }
}

export function assertSuccess(label: string, result: CommandResult): void {
  if (result.exitCode === 0) return
  const detail = result.stderr || result.stdout || `exit code ${result.exitCode}`
  throw new Error(`${label} failed: ${detail}`)
}

function readComposeHealth(serviceName: string): string | null {
  const idResult = run(['docker', 'compose', 'ps', '-q', serviceName])
  if (idResult.exitCode !== 0) return null
  const containerId = idResult.stdout.trim()
  if (!containerId) return null

  const inspectResult = run([
    'docker',
    'inspect',
    '--format={{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',
    containerId
  ])

  if (inspectResult.exitCode !== 0) return null
  return inspectResult.stdout.trim() || null
}

async function waitForHealthy(serviceName: string, timeoutMs = 120_000): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const health = readComposeHealth(serviceName)
    if (health === 'healthy' || health === 'running') return
    await Bun.sleep(1_000)
  }

  throw new Error(`Timed out waiting for ${serviceName} to become healthy`)
}

export async function prepareInfra(profiles: InfraProfiles): Promise<void> {
  const composeArgs = ['docker', 'compose']

  if (profiles.opensearch) composeArgs.push('--profile', 'opensearch')
  if (profiles.redis) composeArgs.push('--profile', 'redis')
  if (profiles.apisix) composeArgs.push('--profile', 'apisix')

  composeArgs.push('up', '-d', 'postgres', 'nats')

  if (profiles.opensearch) composeArgs.push('opensearch')
  if (profiles.redis) composeArgs.push('redis')
  if (profiles.apisix) composeArgs.push('apisix')

  assertSuccess('docker compose up', run(composeArgs))
  await waitForHealthy('postgres')
  await waitForHealthy('nats')
  if (profiles.opensearch) await waitForHealthy('opensearch')
  if (profiles.redis) await waitForHealthy('redis')
  if (profiles.apisix) await waitForHealthy('apisix')
}

export async function prepareWorkspace(): Promise<void> {
  assertSuccess('cert generation', run(['bun', 'run', 'scripts/certs-dev.ts']))
  assertSuccess('db migrate', run(['bun', 'run', 'db:migrate']))
  assertSuccess('db seed', run(['bun', 'run', 'db:seed']))

  if (!process.env.MERISTEM_TOKEN) {
    const tokenResult = run(['bun', 'run', 'token:mint', '--actor', 'operator'])
    assertSuccess('default operator token mint', tokenResult)
    process.env.MERISTEM_TOKEN = tokenResult.stdout.trim()
  }

  if (!process.env.PUBLIC_MERISTEM_DEFAULT_TOKEN && process.env.MERISTEM_TOKEN) {
    process.env.PUBLIC_MERISTEM_DEFAULT_TOKEN = process.env.MERISTEM_TOKEN
  }

  // 确保 M-Net 使用 PostgreSQL 持久化数据面状态，而非内存存储（重启后丢失）
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'postgres://meristem:meristem@localhost:55432/meristem'
  }

  // 自动设置网络地图签名密钥环境变量（与 harness 保持一致）
  // 优先使用已配置的环境变量；否则使用测试默认密钥
  if (!process.env[NETWORK_MAP_SIGNING_KEY_ID_ENV_KEY]) {
    const signing = resolveNetworkMapSigningKeyMaterial(process.env, { allowTestDefaults: true })
    process.env[NETWORK_MAP_SIGNING_KEY_ID_ENV_KEY] = signing.keyId
    process.env[NETWORK_MAP_SIGNING_PUBLIC_KEY_ENV_KEY] = signing.publicKey ?? ''
    // 优先使用文件路径方式（避免多行 PEM 在 bash export 中被截断）
    if (!process.env[NETWORK_MAP_SIGNING_PRIVATE_KEY_FILE_ENV_KEY]) {
      process.env[NETWORK_MAP_SIGNING_PRIVATE_KEY_ENV_KEY] = signing.privateKeyPem
    }
    // 同时设置 node-agent 侧使用的签名密钥 ID 和公钥
    if (!process.env.MERISTEM_MNET_SIGNING_KEY_ID) {
      process.env.MERISTEM_MNET_SIGNING_KEY_ID = signing.keyId
    }
    if (!process.env.MERISTEM_MNET_SIGNING_PUBLIC_KEY) {
      process.env.MERISTEM_MNET_SIGNING_PUBLIC_KEY = signing.publicKey ?? ''
    }
  }
}

export function spawnService(service: LocalServiceCommand): Bun.Subprocess {
  return Bun.spawn(service.command, {
    cwd: service.cwd ?? rootDir,
    env: process.env,
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'ignore'
  })
}

export async function runServiceGroup(
  serviceCommands: readonly LocalServiceCommand[]
): Promise<void> {
  const children = serviceCommands.map(service => ({
    service,
    child: spawnService(service)
  }))
  let shuttingDown = false

  const handleShutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return
    shuttingDown = true
    for (const { child } of children) {
      child.kill(signal)
    }
  }

  process.on('SIGINT', () => handleShutdown('SIGINT'))
  process.on('SIGTERM', () => handleShutdown('SIGTERM'))

  const exitCodes = await Promise.all(
    children.map(async ({ service, child }) => {
      const exitCode = await child.exited
      return { service, exitCode }
    })
  )

  if (shuttingDown) {
    process.exit(0)
  }

  const failed = exitCodes.filter(({ exitCode }) => exitCode !== 0)
  if (failed.length > 0) {
    const labels = failed.map(({ service }) => service.label).join(', ')
    throw new Error(`dev service group failed: ${labels}`)
  }
}
