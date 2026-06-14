export const rootDir = import.meta.dir.replace(/\/scripts$/, '')

export type InfraProfiles = {
  opensearch: boolean
  redis: boolean
  apisix: boolean
}

export const coreServiceScripts = [
  'dev:m-eventbus',
  'dev:m-policy',
  'dev:m-log',
  'dev:m-net',
  'dev:m-task',
  'dev:m-extension',
  'dev:core-app'
] as const

export const webUiServiceScripts = ['dev:m-ui-bff', 'dev:m-ui'] as const
export const deployedWebUiServiceScripts = ['dev:m-ui-bff', 'deploy:m-ui'] as const

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
}

export function spawnService(scriptName: string): Bun.Subprocess {
  return Bun.spawn(['bun', 'run', scriptName], {
    cwd: rootDir,
    env: process.env,
    stdout: 'inherit',
    stderr: 'inherit'
  })
}

export async function runServiceGroup(serviceScripts: readonly string[]): Promise<void> {
  const children = serviceScripts.map(spawnService)

  process.on('SIGINT', () => {
    for (const child of children) child.kill()
    process.exit(0)
  })

  await Promise.all(children.map(child => child.exited))
}
