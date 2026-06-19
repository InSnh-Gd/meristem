import {
  prepareInfra,
  profileFlagsFromArgv,
  rootDir,
  run,
  assertSuccess
} from './local-stack-runtime.ts'

type TestCommand = {
  label: string
  command: string[]
}

const sharedEnv = {
  ...process.env,
  MERISTEM_INTERNAL_TOKEN: process.env.MERISTEM_INTERNAL_TOKEN ?? 'real-env-internal-token',
  MERISTEM_JWT_SECRET: process.env.MERISTEM_JWT_SECRET ?? 'real-env-jwt-secret',
  MERISTEM_AGENT_HEARTBEAT_INTERVAL_MS: process.env.MERISTEM_AGENT_HEARTBEAT_INTERVAL_MS ?? '500',
  MERISTEM_AGENT_HEARTBEAT_TIMEOUT_MS: process.env.MERISTEM_AGENT_HEARTBEAT_TIMEOUT_MS ?? '2000',
  MERISTEM_AGENT_TASK_TIMEOUT_MS: process.env.MERISTEM_AGENT_TASK_TIMEOUT_MS ?? '2000',
  NODE_TLS_REJECT_UNAUTHORIZED: process.env.NODE_TLS_REJECT_UNAUTHORIZED ?? '0'
} as const

const preE2eCommands: readonly TestCommand[] = [
  { label: 'typecheck', command: ['bun', 'run', 'typecheck'] },
  { label: 'test:agent-submit', command: ['bun', 'run', 'test:agent-submit'] },
  { label: 'test:integration', command: ['bun', 'run', 'test:integration'] }
] as const

const e2eCommand: TestCommand = {
  label: 'test:e2e',
  command: ['bun', 'run', 'test:e2e']
}

const optionalProfileServices = [
  ['opensearch', 'opensearch'] as const,
  ['redis', 'redis'] as const,
  ['apisix', 'apisix'] as const
] as const

function hasFlag(flag: string): boolean {
  return Bun.argv.includes(flag)
}

function logStep(message: string): void {
  console.log(`\n[real-env] ${message}`)
}

function withNixDevelop(command: string[]): string[] {
  return ['nix', 'develop', '-c', ...command]
}

async function prepareWorkspaceInNix(): Promise<void> {
  assertSuccess('cert generation', run(withNixDevelop(['bun', 'run', 'scripts/certs-dev.ts'])))
  assertSuccess('db migrate', run(withNixDevelop(['bun', 'run', 'db:migrate'])))
  assertSuccess('db seed', run(withNixDevelop(['bun', 'run', 'db:seed'])))

  if (!process.env.MERISTEM_TOKEN) {
    const tokenResult = run(withNixDevelop(['bun', 'run', 'token:mint', '--actor', 'operator']))
    assertSuccess('default operator token mint', tokenResult)
    process.env.MERISTEM_TOKEN = tokenResult.stdout.trim()
  }

  if (!process.env.PUBLIC_MERISTEM_DEFAULT_TOKEN && process.env.MERISTEM_TOKEN) {
    process.env.PUBLIC_MERISTEM_DEFAULT_TOKEN = process.env.MERISTEM_TOKEN
  }
}

async function runCommand(command: TestCommand): Promise<void> {
  logStep(`running ${command.label}`)
  const process = Bun.spawn(withNixDevelop(command.command), {
    cwd: rootDir,
    env: sharedEnv,
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'ignore'
  })
  const exitCode = await process.exited
  if (exitCode !== 0) {
    throw new Error(`${command.label} failed with exit code ${exitCode}`)
  }
}

function printDryRun(): void {
  console.log('[real-env] dry run')
  console.log('[real-env] prepareInfra({ opensearch: false, redis: false, apisix: false })')
  const requestedProfiles = profileFlagsFromArgv()
  for (const [flag, service] of optionalProfileServices) {
    if (!requestedProfiles[flag]) continue
    console.log(
      `[real-env] best-effort optional profile: docker compose --profile ${flag} up -d ${service}`
    )
  }
  console.log('[real-env] prepareWorkspace()')
  for (const command of preE2eCommands) {
    console.log(`[real-env] run: ${withNixDevelop(command.command).join(' ')}`)
  }
  console.log(
    '[real-env] note: test:e2e self-manages dev:all + dev:m-ui-bff via tests/e2e/_shared.ts'
  )
  console.log(`[real-env] run: ${withNixDevelop(e2eCommand.command).join(' ')}`)
}

function startOptionalProfilesBestEffort(profiles: ReturnType<typeof profileFlagsFromArgv>): void {
  for (const [flag, service] of optionalProfileServices) {
    if (!profiles[flag]) continue
    logStep(`starting optional profile ${flag} (best-effort)`)
    const result = run(['docker', 'compose', '--profile', flag, 'up', '-d', service])
    if (result.exitCode === 0) continue
    const detail = result.stderr || result.stdout || `exit code ${result.exitCode}`
    console.warn(
      `[real-env] optional profile ${flag} failed to start; continuing because it is not required for integration/e2e gates\n${detail}`
    )
  }
}

if (hasFlag('--dry-run')) {
  printDryRun()
  process.exit(0)
}

const requestedProfiles = profileFlagsFromArgv()
await prepareInfra({ opensearch: false, redis: false, apisix: false })
startOptionalProfilesBestEffort(requestedProfiles)
await prepareWorkspaceInNix()

for (const command of preE2eCommands) {
  await runCommand(command)
}

await runCommand(e2eCommand)

logStep('all real-environment tests passed')
