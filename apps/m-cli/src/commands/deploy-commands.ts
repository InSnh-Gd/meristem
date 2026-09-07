import { fileURLToPath } from 'node:url'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DEFAULT_MANIFEST_PATH,
  initManifest,
  mergeProfiles,
  readValidManifest,
  validateManifest
} from './deploy-manifest.ts'
import {
  hasFlag,
  optionalOption,
  parseArgs,
  requireMethod,
  requireOption,
  success,
  type CliCommandHandler
} from './shared.ts'

const LOCAL_STACK_STATE_DIR = '/tmp/meristem-local-stack'
const LOCAL_STACK_STATE_FILE = join(LOCAL_STACK_STATE_DIR, 'state.json')

type LocalStackState = {
  pid: number
  logFile: string
}

/** 仓库根目录：从 apps/m-cli/src/commands/deploy-commands.ts 上溯四级。 */
export const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

/**
 * 部署命令分组：
 * - install / init / validate / prepare 是本地安装器，只产生可验证的非秘密清单和本地进程；
 * - status / agents / drift / evidence / propose / approve / apply / rollback 通过 Core 公开
 *   facade 访问 M-Deploy 控制面，生产事实、审批、审计与证据始终由 M-Deploy/M-Policy/M-Log 拥有。
 */
export const handleDeployCommands: CliCommandHandler = async (client, args) => {
  const { positionals, options } = parseArgs(args)
  const [command, subcommand] = positionals
  if (command !== 'deploy') return undefined

  const manifestPath = optionalOption(options, '--config') ?? DEFAULT_MANIFEST_PATH

  if (subcommand === 'install') {
    return install({ client, options, manifestPath })
  }
  if (subcommand === 'stop') {
    return stopLocalStack()
  }
  if (subcommand === 'init') {
    return initManifest({
      manifestPath,
      profile: optionalOption(options, '--profile'),
      cwd: process.cwd()
    })
  }
  if (subcommand === 'validate') {
    return validateManifest(manifestPath)
  }
  if (subcommand === 'status') {
    const desiredState = requireMethod(client.deploy?.desiredState, 'deploy.desiredState')
    return success(await desiredState())
  }
  if (subcommand === 'agents') {
    const agents = requireMethod(client.deploy?.agents, 'deploy.agents')
    return success(await agents())
  }
  if (subcommand === 'drift') {
    if (hasFlag(options, '--check')) {
      const driftCheck = requireMethod(client.deploy?.driftCheck, 'deploy.driftCheck')
      return success(await driftCheck())
    }
    const drift = requireMethod(client.deploy?.drift, 'deploy.drift')
    return success(await drift())
  }
  if (subcommand === 'evidence') {
    const evidence = requireMethod(client.deploy?.evidence, 'deploy.evidence')
    return success(await evidence())
  }
  if (subcommand === 'propose') {
    return propose(client, manifestPath)
  }
  if (subcommand === 'approve') {
    const proposalId = positionals[2]
    if (!proposalId) throw new Error('usage: deploy approve <proposal-id> [--reject]')
    const approve = requireMethod(client.deploy?.approve, 'deploy.approve')
    return success(await approve(proposalId, hasFlag(options, '--reject') ? 'reject' : 'approve'))
  }
  if (subcommand === 'apply') {
    const proposalId = requireOption(options, '--proposal')
    const agentId = requireOption(options, '--agent')
    if (!hasFlag(options, '--confirm')) throw new Error('deploy apply requires --confirm')
    const apply = requireMethod(client.deploy?.apply, 'deploy.apply')
    return success(await apply({ proposalId, agentId }))
  }
  if (subcommand === 'rollback') {
    const agentId = requireOption(options, '--agent')
    const algorithm = optionalOption(options, '--digest-algorithm') ?? 'sha256'
    const value = requireOption(options, '--digest-value')
    if (!hasFlag(options, '--confirm')) throw new Error('deploy rollback requires --confirm')
    const rollback = requireMethod(client.deploy?.rollback, 'deploy.rollback')
    return success(await rollback({ agentId, targetDigest: { algorithm, value } }))
  }

  throw new Error(`unknown deploy command: ${subcommand ?? ''}`)
}

async function install(input: {
  client: Parameters<CliCommandHandler>[0]
  options: Record<string, string | boolean>
  manifestPath: string
}) {
  // 清单不存在时按 profile 参数生成；存在时直接使用并校验。
  if (!(await Bun.file(input.manifestPath).exists())) {
    await initManifest({
      manifestPath: input.manifestPath,
      profile: optionalOption(input.options, '--profile'),
      cwd: process.cwd()
    })
  }
  const manifest = await readValidManifest(input.manifestPath)
  if (manifest.profile !== 'local-compose') {
    throw new Error(
      'install only supports local-compose manifests; use deploy validate + deploy propose for production'
    )
  }
  const profiles = mergeProfiles(manifest.local.profiles, optionalOption(input.options, '--profiles'))
  const prepareOnly = hasFlag(input.options, '--prepare-only')
  const profileFlags = profiles.flatMap(profile => [`--${profile}`])

  const prepareArgs = ['run', 'deploy:local', '--prepare-only', ...profileFlags]
  const prepareResult = await Bun.spawn(['bun', ...prepareArgs], {
    cwd: repoRoot,
    stdout: 'inherit',
    stderr: 'inherit',
    env: spawnEnvWithoutToken()
  }).exited
  if (prepareResult !== 0) throw new Error('local dependency preparation failed')

  if (prepareOnly) {
    return success({ installed: true, prepared: true, started: false, profiles })
  }

  const state = await startLocalStack(profileFlags)

  return success({
    installed: true,
    prepared: true,
    started: true,
    profiles,
    pid: state.pid,
    logFile: state.logFile,
    next: 'run: meristem deploy status; stop: meristem deploy stop'
  })
}

async function startLocalStack(profileFlags: readonly string[]): Promise<LocalStackState> {
  await mkdir(LOCAL_STACK_STATE_DIR, { recursive: true })
  const logFile = join(LOCAL_STACK_STATE_DIR, 'dev-full.log')
  const pidFile = join(LOCAL_STACK_STATE_DIR, 'dev-full.pid')
  const command = ['bun', 'run', 'dev:full', ...profileFlags]
    .map(shellQuote)
    .join(' ')
  await rm(pidFile, { force: true })
  // PID 经文件回传而不是 stdout 管道：dev:full 的孙进程会继承该管道，
  // 读到 EOF 需要等整个服务组退出，会让 install 永久挂起。
  //
  // 记录的必须是 setsid 之后内层 shell 的 $$，也就是真实进程组 leader；
  // $! 是 setsid fork 前的短命父进程，用它发信号会漏掉整个服务组。
  const script = `cd ${shellQuote(repoRoot)} && nohup setsid sh -c 'printf %s "$$" > "$1"; shift; exec "$@"' meristem-local-stack ${shellQuote(pidFile)} ${command} > ${shellQuote(logFile)} 2>&1 < /dev/null &`
  const child = Bun.spawn(['sh', '-lc', script], {
    cwd: repoRoot,
    stdout: 'ignore',
    stderr: 'ignore',
    stdin: 'ignore',
    env: spawnEnvWithoutToken()
  })
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error(`local dev stack start failed with exit code ${exitCode}`)
  const pid = await readGroupLeaderPid(pidFile)

  try {
    await waitForReady('http://127.0.0.1:3107/ready')
    // Core 的就绪端点在公开 API 前缀下（/api/v0/ready），不是裸 /ready，
    // 并且依赖降级时仍返回 200，因此必须读取 ready 字段而不是只看状态码。
    await waitForReady(
      `${process.env.MERISTEM_CORE_URL ?? 'http://127.0.0.1:3000'}/api/v0/ready`,
      { requireReadyField: true }
    )
  } catch (error) {
    terminateProcessGroup(pid)
    throw error
  }
  const state = { pid, logFile }
  await writeFile(LOCAL_STACK_STATE_FILE, `${JSON.stringify(state)}\n`)
  return state
}

/** 等待 detached shell 写出进程组 leader PID；写文件与 shell 退出之间存在竞态。 */
async function readGroupLeaderPid(pidFile: string, timeoutMs = 10_000): Promise<number> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const pid = Number((await readFile(pidFile, 'utf8').catch(() => '')).trim())
    if (Number.isInteger(pid) && pid > 0) return pid
    await Bun.sleep(100)
  }
  throw new Error('local dev stack pid unavailable')
}

async function waitForReady(
  url: string,
  options: { requireReadyField?: boolean; timeoutMs?: number } = {}
): Promise<void> {
  // 冷启动需要迁移、seed 和多个服务监听，因此默认窗口比单进程启动宽。
  const timeoutMs = options.timeoutMs ?? 180_000
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        if (options.requireReadyField !== true) return
        const body = (await response.json()) as { ready?: unknown }
        if (body.ready === true) return
      }
    } catch {
      // The detached stack may still be starting its listener.
    }
    await Bun.sleep(500)
  }
  throw new Error(`timed out waiting for local control plane: ${url}`)
}

async function stopLocalStack() {
  let state: LocalStackState
  try {
    state = JSON.parse(await readFile(LOCAL_STACK_STATE_FILE, 'utf8')) as LocalStackState
  } catch {
    return success({ stopped: false, reason: 'no local stack state found' })
  }
  terminateProcessGroup(state.pid)
  await rm(LOCAL_STACK_STATE_FILE, { force: true })
  return success({ stopped: true, pid: state.pid, logFile: state.logFile })
}

function terminateProcessGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // The process may already have exited; cleanup remains idempotent.
    }
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

async function propose(
  client: Parameters<CliCommandHandler>[0],
  manifestPath: string
) {
  const manifest = await readValidManifest(manifestPath)
  if (manifest.profile !== 'production-podman') {
    throw new Error('deploy propose requires a production-podman manifest')
  }
  const propose = requireMethod(client.deploy?.propose, 'deploy.propose')
  return success(await propose(manifest.proposal))
}

/** 子进程不继承 CLI 的 Bearer token：本地脚本不需要也不应该拿到操作者凭据。 */
function spawnEnvWithoutToken(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env }
  env.MERISTEM_TOKEN = undefined
  return env
}
