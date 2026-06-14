const rootDir = import.meta.dir.replace(/\/scripts$/, '')
const services = [
  'dev:m-eventbus',
  'dev:m-policy',
  'dev:m-log',
  'dev:m-net',
  'dev:m-task',
  'dev:m-extension',
  'dev:core',
  'dev:m-ui-bff',
  'deploy:m-ui'
] as const

const profileFlags = {
  opensearch: Bun.argv.includes('--opensearch'),
  redis: Bun.argv.includes('--redis'),
  apisix: Bun.argv.includes('--apisix')
}

const prepareOnly = Bun.argv.includes('--prepare-only')

type CommandResult = {
  exitCode: number
  stderr: string
  stdout: string
}

function run(command: string[], cwd = rootDir, env = process.env): CommandResult {
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

function assertSuccess(label: string, result: CommandResult): void {
  if (result.exitCode === 0) return
  const detail = result.stderr || result.stdout || `exit code ${result.exitCode}`
  throw new Error(`${label} failed: ${detail}`)
}

/**
 * Docker Compose 已经定义了 healthcheck；本机部署脚本这里直接轮询健康状态，避免 migrate/seed 在依赖尚未就绪时提前失败。
 */
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

async function prepareInfra(): Promise<void> {
  const composeArgs = ['docker', 'compose']

  if (profileFlags.opensearch) composeArgs.push('--profile', 'opensearch')
  if (profileFlags.redis) composeArgs.push('--profile', 'redis')
  if (profileFlags.apisix) composeArgs.push('--profile', 'apisix')

  composeArgs.push('up', '-d', 'postgres', 'nats')

  if (profileFlags.opensearch) composeArgs.push('opensearch')
  if (profileFlags.redis) composeArgs.push('redis')
  if (profileFlags.apisix) composeArgs.push('apisix')

  assertSuccess('docker compose up', run(composeArgs))
  await waitForHealthy('postgres')
  await waitForHealthy('nats')
  if (profileFlags.opensearch) await waitForHealthy('opensearch')
  if (profileFlags.redis) await waitForHealthy('redis')
  if (profileFlags.apisix) await waitForHealthy('apisix')
}

async function prepareWorkspace(): Promise<void> {
  assertSuccess('cert generation', run(['bun', 'run', 'scripts/certs-dev.ts']))
  assertSuccess('db migrate', run(['bun', 'run', 'db:migrate']))
  assertSuccess('db seed', run(['bun', 'run', 'db:seed']))
}

function spawnService(scriptName: string): Bun.Subprocess {
  return Bun.spawn(['bun', 'run', scriptName], {
    cwd: rootDir,
    env: process.env,
    stdout: 'inherit',
    stderr: 'inherit'
  })
}

async function main(): Promise<void> {
  await prepareInfra()
  await prepareWorkspace()

  if (prepareOnly) {
    console.log('Local deployment prerequisites are ready.')
    return
  }

  const children = services.map(spawnService)

  console.log('Meristem local deployment started:')
  console.log('- Core: http://127.0.0.1:3000')
  console.log('- BFF: http://127.0.0.1:3200')
  console.log(`- Web UI: http://127.0.0.1:${process.env.MERISTEM_UI_PORT ?? '5173'}`)

  process.on('SIGINT', () => {
    for (const child of children) child.kill()
    process.exit(0)
  })

  await Promise.all(children.map(child => child.exited))
}

if (import.meta.main) {
  await main()
}

export {}
