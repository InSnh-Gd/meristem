import { existsSync } from 'node:fs'
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
  type DeployCommandDeps,
  DEPLOY_USAGE,
  buildEnvContent,
  loadEnvTemplate,
  resolveComposeContext,
  resolveComposePaths,
  resolveDefaultRepoRoot,
  runProcess,
  runToken,
  runUp,
  streamResult,
  writeEnvFile
} from './deploy-common.ts'
import { defaultDeployPrompter, runDeployWizard } from './deploy-wizard.ts'
import { runDeployTui } from './deploy-tui.ts'
import {
  encode,
  hasFlag,
  optionalOption,
  parseArgs,
  requireMethod,
  requireOption,
  success,
  type CliCommandHandler
} from './shared.ts'
import type { CliRunResult } from './types.ts'

const LOCAL_STACK_STATE_DIR = '/tmp/meristem-local-stack'
const LOCAL_STACK_STATE_FILE = join(LOCAL_STACK_STATE_DIR, 'state.json')

type LocalStackState = {
  pid: number
  logFile: string
}

/** 仓库根目录：从 apps/m-cli/src/commands/deploy-commands.ts 上溯四级。 */
export const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

/**
 * 单机部署（wizard/tui/up/status/logs/down/token）的 compose 执行 seam：
 * 部署发生在控制面可用之前，副作用直接委托容器 provider，不经 Core client。
 */
const singleHostDeps: DeployCommandDeps = {
  repoRoot: resolveDefaultRepoRoot(),
  which: binary => Bun.which(binary),
  run: runProcess
}

/**
 * deploy 命令分组：
 * - 单机组（wizard / tui / up / logs / down / token）在控制面可用之前操作本地
 *   compose 栈；`init` 按旗标消歧——`--profile` / `--config` 生成安装清单，
 *   否则生成单机 compose env 文件；
 * - `status` 同样消歧——带 `--file` / `--env-file` 显示 compose 容器表，裸调用
 *   走 Core facade 的 desired-state 摘要；
 * - install / stop / validate / agents / drift / evidence / propose / approve /
 *   apply / rollback 通过 Core 公开 facade 访问 M-Deploy 控制面，生产事实、
 *   审批、审计与证据始终由 M-Deploy/M-Policy/M-Log 拥有。
 */
export const handleDeployCommands: CliCommandHandler = async (client, args) => {
  const { positionals, options } = parseArgs(args)
  const [command, subcommand] = positionals
  if (command !== 'deploy') return undefined

  const manifestPath = optionalOption(options, '--config') ?? DEFAULT_MANIFEST_PATH

  if (subcommand === 'init') {
    const profile = optionalOption(options, '--profile')
    const config = optionalOption(options, '--config')
    if (profile !== undefined || config !== undefined) {
      return initManifest({ manifestPath, profile, cwd: process.cwd() })
    }
    return initEnvFile(options)
  }
  if (subcommand === 'stop') {
    return stopLocalStack()
  }
  if (subcommand === 'install') {
    return install({ client, options, manifestPath })
  }
  if (subcommand === 'validate') {
    return validateManifest(manifestPath)
  }
  if (subcommand === 'status') {
    const stackView =
      optionalOption(options, '--file') !== undefined ||
      optionalOption(options, '--env-file') !== undefined
    if (stackView) {
      const compose = resolveComposeContext(singleHostDeps, composeOverrides(options))
      const result = await singleHostDeps.run({
        binary: compose.binary,
        args: [...compose.args, 'ps', '--all'],
        stream: true
      })
      return streamResult(result.exitCode)
    }
    const desiredState = requireMethod(client.deploy?.desiredState, 'deploy.desiredState')
    return success(await desiredState())
  }
  if (subcommand === 'up') {
    return deployUp(options)
  }
  if (subcommand === 'logs') {
    return deployLogs(options, positionals)
  }
  if (subcommand === 'down') {
    const compose = resolveComposeContext(singleHostDeps, composeOverrides(options))
    const result = await singleHostDeps.run({
      binary: compose.binary,
      args: [
        ...compose.args,
        'down',
        ...(hasFlag(options, '--volumes') ? ['--volumes'] : []),
        '--remove-orphans'
      ],
      stream: true
    })
    return streamResult(result.exitCode)
  }
  if (subcommand === 'token') {
    return deployToken(options, positionals)
  }
  if (subcommand === 'wizard') {
    const timeout = optionalOption(options, '--timeout')
    return runDeployWizard(singleHostDeps, defaultDeployPrompter, composeOverrides(options), {
      ...(timeout ? { timeout } : {})
    })
  }
  if (subcommand === 'tui') {
    return runDeployTui(singleHostDeps, composeOverrides(options))
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

  throw new Error(`unknown deploy command: ${subcommand ?? ''}\n${DEPLOY_USAGE}`)
}

/** 组装 compose 路径覆盖：exactOptionalPropertyTypes 下只携带显式传入的键。 */
function composeOverrides(options: Record<string, string | boolean>): {
  file?: string
  envFile?: string
} {
  const file = optionalOption(options, '--file')
  const envFile = optionalOption(options, '--env-file')
  return {
    ...(file ? { file } : {}),
    ...(envFile ? { envFile } : {})
  }
}

/** 单机部署 init：从模板生成 compose env 文件并替换随机密钥，重复执行默认拒绝覆盖。 */
async function initEnvFile(options: Record<string, string | boolean>): Promise<CliRunResult> {
  const envFile = resolveComposePaths(singleHostDeps, composeOverrides(options)).envFile
  const overwriting = existsSync(envFile)
  if (overwriting && !hasFlag(options, '--force')) {
    throw new Error(`${envFile} already exists; pass --force to overwrite`)
  }
  const template = await loadEnvTemplate(singleHostDeps)
  const { content, generatedKeys } = buildEnvContent(template)
  await writeEnvFile(envFile, content)
  // 覆盖即轮换全部密钥：与既有 postgres 数据卷密码失配会让栈起不来
  const stderr = overwriting
    ? 'warning: regenerated all secrets; if a data volume from a previous deployment exists, ' +
      "run 'meristem deploy down --volumes' before the next 'deploy up'\n"
    : ''
  return { exitCode: 0, stdout: encode({ envFile, generatedKeys }), stderr }
}

/** 单机部署 up：默认从源码构建并等待全部 healthy，--pull 走 registry 镜像。 */
async function deployUp(options: Record<string, string | boolean>): Promise<CliRunResult> {
  const compose = resolveComposeContext(singleHostDeps, composeOverrides(options))
  const timeout = optionalOption(options, '--timeout')
  const exitCode = await runUp(singleHostDeps, compose, {
    pull: hasFlag(options, '--pull'),
    ...(timeout ? { timeout } : {})
  })
  return streamResult(exitCode)
}

/** 单机部署 logs：stream compose logs，--tail/--follow 与服务名原样转发。 */
async function deployLogs(
  options: Record<string, string | boolean>,
  positionals: string[]
): Promise<CliRunResult> {
  const compose = resolveComposeContext(singleHostDeps, composeOverrides(options))
  const logArgs = [...compose.args, 'logs']
  const tail = optionalOption(options, '--tail')
  if (tail) logArgs.push('--tail', tail)
  if (hasFlag(options, '--follow')) logArgs.push('--follow')
  const service = positionals[2]
  if (service) logArgs.push(service)
  const result = await singleHostDeps.run({ binary: compose.binary, args: logArgs, stream: true })
  return streamResult(result.exitCode)
}

/**
 * 单机部署 token：读取 bootstrap 铸造的 actor 运行时 token。
 * actor 直接拼进容器内路径；argv 数组执行无 shell 注入面，字符集校验只防路径穿越。
 */
async function deployToken(
  options: Record<string, string | boolean>,
  positionals: string[]
): Promise<CliRunResult> {
  const actor = positionals[2]
  if (!actor) throw new Error('usage: meristem deploy token <actor>')
  if (!/^[A-Za-z0-9_-]+$/.test(actor)) {
    throw new Error('actor must match [A-Za-z0-9_-]+')
  }
  const compose = resolveComposeContext(singleHostDeps, composeOverrides(options))
  const token = await runToken(singleHostDeps, compose, actor)
  if (!token.ok) return { exitCode: 1, stdout: '', stderr: token.stderr }
  return success({ actor, token: token.token })
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
  const profiles = mergeProfiles(
    manifest.local.profiles,
    optionalOption(input.options, '--profiles')
  )
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
  const command = ['bun', 'run', 'dev:full', ...profileFlags].map(shellQuote).join(' ')
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
    await waitForReady(`${process.env.MERISTEM_CORE_URL ?? 'http://127.0.0.1:3000'}/api/v0/ready`, {
      requireReadyField: true
    })
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

async function propose(client: Parameters<CliCommandHandler>[0], manifestPath: string) {
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
