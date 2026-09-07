import { existsSync, statSync } from 'node:fs'
import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// ── deploy 命令族共享层 ──────────────────────────────────────────────────
// init / up / status / logs / down / token / wizard / tui 都基于同一套
// compose 上下文解析与进程执行 seam；TUI 与向导只从这里取能力，
// 不反向依赖命令分派模块，避免循环 import。

export const COMPOSE_FILE_REL = 'ops/compose/meristem.prod.yml'
export const ENV_FILE_REL = 'ops/compose/meristem.prod.env'
export const ENV_EXAMPLE_REL = 'ops/compose/meristem.prod.env.example'

/** compose 里 bootstrap 服务的 token 挂载目录。 */
export const BOOTSTRAP_TOKEN_DIR = '/bootstrap/tokens'

/**
 * 默认仓库根：优先 MERISTEM_REPO_ROOT，其次 cwd（编译二进制可从仓库内任意
 * 目录执行），最后才是 import.meta.dir 推导（bun run 源码执行时成立，
 * --compile 产物里是虚拟路径，仅作最后兜底）。
 */
export function resolveDefaultRepoRoot(): string {
  const candidates = [
    process.env.MERISTEM_REPO_ROOT,
    process.cwd(),
    join(import.meta.dir, '..', '..', '..', '..')
  ].filter((dir): dir is string => typeof dir === 'string' && dir.length > 0)
  for (const dir of candidates) {
    if (existsSync(join(dir, COMPOSE_FILE_REL))) return dir
  }
  return process.cwd()
}

/** deploy init / wizard 需要用随机值替换的占位符（与 env 模板一一对应）。 */
export const ENV_PLACEHOLDERS = [
  'change-me-strong-password',
  'change-me-opensearch',
  'change-me-internal-token',
  'change-me-jwt-secret'
] as const

export const ENV_PLACEHOLDER_KEYS: Record<(typeof ENV_PLACEHOLDERS)[number], string> = {
  'change-me-strong-password': 'POSTGRES_PASSWORD',
  'change-me-opensearch': 'OPENSEARCH_INITIAL_PASSWORD',
  'change-me-internal-token': 'MERISTEM_INTERNAL_TOKEN',
  'change-me-jwt-secret': 'MERISTEM_JWT_SECRET'
}

/** 单进程执行结果；exitCode 保留真实退出码，返回 CliRunResult 前再归一化。 */
export type DeployProcessResult = { exitCode: number; stdout: string; stderr: string }

/** deploy 命令族的外部副作用 seam，测试注入 fake runner / which / 日志。 */
export type DeployCommandDeps = {
  repoRoot: string
  which(binary: string): string | null
  run(input: { binary: string; args: string[]; stream: boolean }): Promise<DeployProcessResult>
  /** 交互式命令（wizard/tui）的进度输出通道；默认写 stderr，保持 stdout 只承载结果 JSON。 */
  log?(line: string): void
}

// ── 外部执行 ─────────────────────────────────────────────────────────────

/**
 * 默认进程执行器：stream 模式（up/status/logs/down）把 compose 输出直接
 * 透传到终端，保持 kubectl 式实时反馈；capture 模式（token/TUI 取数）
 * 缓存 stdout 供程序消费。
 */
export async function runProcess(input: {
  binary: string
  args: string[]
  stream: boolean
}): Promise<DeployProcessResult> {
  const proc = Bun.spawn([input.binary, ...input.args], {
    stdio: input.stream ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe']
  })
  if (input.stream) {
    return { exitCode: await proc.exited, stdout: '', stderr: '' }
  }
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text()
  ])
  return { exitCode: await proc.exited, stdout, stderr }
}

// ── provider 与路径解析 ──────────────────────────────────────────────────

export function resolveProvider(deps: DeployCommandDeps): string {
  for (const binary of ['docker', 'podman']) {
    if (deps.which(binary)) return binary
  }
  throw new Error('no container provider found; install docker or podman (with a compose provider)')
}

export type ComposePaths = { composeFile: string; envFile: string }

/** 解析 compose / env 文件路径（不做存在性检查，wizard 在写入 env 前调用）。 */
export function resolveComposePaths(
  deps: DeployCommandDeps,
  overrides: { file?: string; envFile?: string }
): ComposePaths {
  return {
    composeFile: overrides.file ?? join(deps.repoRoot, COMPOSE_FILE_REL),
    envFile: overrides.envFile ?? join(deps.repoRoot, ENV_FILE_REL)
  }
}

/** compose 文件必须存在的 fail-fast 检查，env 缺失给出可执行的补救提示。 */
export function assertComposeFiles(paths: ComposePaths): void {
  if (!isRegularFile(paths.composeFile)) {
    throw new Error(`compose file not found: ${paths.composeFile}`)
  }
  if (!existsSync(paths.envFile)) {
    throw new Error(
      `env file not found: ${paths.envFile}; run 'meristem deploy init' to generate one`
    )
  }
}

/**
 * 所有 compose 调用的公共前缀：provider 之上的 `compose -f … --env-file …`。
 * env 文件必须存在——compose 对 `:?required` 变量的插值错误信息晦涩，
 * 这里提前给出指向 `deploy init` 的可执行提示。
 */
export function resolveComposeContext(
  deps: DeployCommandDeps,
  overrides: { file?: string; envFile?: string } = {}
): { binary: string; args: string[]; paths: ComposePaths } {
  const paths = resolveComposePaths(deps, overrides)
  assertComposeFiles(paths)
  return {
    binary: resolveProvider(deps),
    args: ['compose', '-f', paths.composeFile, '--env-file', paths.envFile],
    paths
  }
}

// ── env 文件生成 ─────────────────────────────────────────────────────────

export const DEPLOY_USAGE =
  'usage: meristem deploy init [--env-file <path>] [--force] | ' +
  'up [--pull] [--timeout <seconds>] [--file <compose>] [--env-file <path>] | ' +
  'status | logs [<service>] [--tail <n>] [--follow] | down [--volumes] | ' +
  'token <actor> | wizard | tui'

/** 读取仓库内 env 模板；向导与 init 共用，模板缺失显式失败。 */
export async function loadEnvTemplate(deps: DeployCommandDeps): Promise<string> {
  const examplePath = join(deps.repoRoot, ENV_EXAMPLE_REL)
  if (!existsSync(examplePath)) throw new Error(`env template not found: ${examplePath}`)
  return Bun.file(examplePath).text()
}

/** 32 字节 base64url 随机值，作 compose 所需的密码 / 共享密钥。 */
export function randomSecret(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
}

/**
 * 从 env 模板生成生产配置内容：替换四个 change-me 占位为随机密钥，
 * 再按 overrides 覆盖指定键值（如端口、actor 列表）；模板注释与
 * 可选项原样保留。占位符缺失或残留都显式失败，避免静默产出不可用 env。
 */
export function buildEnvContent(
  template: string,
  overrides: Record<string, string> = {}
): { content: string; generatedKeys: string[] } {
  let content = template
  const generatedKeys: string[] = []
  for (const placeholder of ENV_PLACEHOLDERS) {
    if (!content.includes(placeholder)) {
      throw new Error(`env template is missing expected placeholder ${placeholder}`)
    }
    content = content.replace(placeholder, randomSecret())
    generatedKeys.push(ENV_PLACEHOLDER_KEYS[placeholder])
  }
  if (content.includes('change-me')) {
    throw new Error('env template still contains change-me placeholders after generation')
  }
  for (const [key, value] of Object.entries(overrides)) {
    const linePattern = new RegExp(`^${key}=.*$`, 'm')
    // 必须用替换函数：字符串替换会展开 $&/$' 等 patterns，污染含 $ 的密钥值
    content = linePattern.test(content)
      ? content.replace(linePattern, () => `${key}=${value}`)
      : `${content.replace(/\s*$/, '\n')}${key}=${value}\n`
  }
  return { content, generatedKeys }
}

/** 目录/软链等非普通文件一律按缺失处理，避免 --file 指向目录时报晦涩错误。 */
function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** env 文件落盘：新建以 0600 原子创建（无先写后 chmod 窗口）；覆盖时显式收紧到 0600。 */
export async function writeEnvFile(envFile: string, content: string): Promise<void> {
  await writeFile(envFile, content, { mode: 0o600 })
  await chmod(envFile, 0o600)
}

/**
 * 从既有 env 内容提取指定键的当前值（`KEY=value` 行）。
 * wizard 重新配置时用它们保留密钥，避免与既有数据卷的密码不匹配。
 */
export function readEnvKeys(content: string, keys: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match?.[1] !== undefined && keys.includes(match[1])) {
      values[match[1]] = match[2] ?? ''
    }
  }
  return values
}

// ── 共享动作 ─────────────────────────────────────────────────────────────

/** CliRunResult.exitCode 只有 0|1；子进程退出码归一化，stream 输出已透传不再重复。 */
export function streamResult(exitCode: number) {
  return { exitCode: exitCode === 0 ? (0 as const) : (1 as const), stdout: '', stderr: '' }
}

/** `compose up -d --wait` 公共实现；pull 时跳过本地构建。供 up 命令与 wizard 复用。 */
export async function runUp(
  deps: DeployCommandDeps,
  compose: { binary: string; args: string[] },
  options: { pull?: boolean; timeout?: string }
): Promise<number> {
  const log = deps.log ?? ((line: string) => process.stderr.write(`${line}\n`))
  let useBuild = !options.pull
  if (options.pull) {
    const pulled = await deps.run({
      binary: compose.binary,
      args: [...compose.args, 'pull'],
      stream: true
    })
    if (pulled.exitCode !== 0) {
      // 拉取失败（如未配置 registry）回退为本地构建；registry 模式下
      // 镜像缺失时构建也会显式失败，不会静默产出错误镜像。
      log('[deploy] image pull failed; falling back to local build')
      useBuild = true
    }
  }
  const waitTimeout = options.timeout
  const result = await deps.run({
    binary: compose.binary,
    args: [
      ...compose.args,
      'up',
      '-d',
      ...(useBuild ? ['--build'] : []),
      '--remove-orphans',
      '--wait',
      ...(waitTimeout ? ['--wait-timeout', waitTimeout] : [])
    ],
    stream: true
  })
  return result.exitCode
}

/** 读取 bootstrap 卷内 actor token；compose run 复用服务定义，免推导卷名/镜像名。 */
export async function runToken(
  deps: DeployCommandDeps,
  compose: { binary: string; args: string[] },
  actor: string
): Promise<{ ok: true; token: string } | { ok: false; stderr: string }> {
  const result = await deps.run({
    binary: compose.binary,
    args: [
      ...compose.args,
      'run',
      '--rm',
      '--no-deps',
      '--entrypoint',
      'cat',
      'bootstrap',
      `${BOOTSTRAP_TOKEN_DIR}/${actor}.token`
    ],
    stream: false
  })
  if (result.exitCode !== 0) return { ok: false, stderr: result.stderr }
  return { ok: true, token: result.stdout.trim() }
}
