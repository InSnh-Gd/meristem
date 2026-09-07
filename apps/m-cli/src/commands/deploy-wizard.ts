import { existsSync } from 'node:fs'
import {
  assertComposeFiles,
  buildEnvContent,
  type ComposePaths,
  type DeployCommandDeps,
  ENV_PLACEHOLDER_KEYS,
  loadEnvTemplate,
  readEnvKeys,
  resolveComposePaths,
  resolveProvider,
  runToken,
  runUp,
  streamResult,
  writeEnvFile
} from './deploy-common.ts'
import { success } from './shared.ts'
import type { CliRunResult } from './types.ts'

// ── deploy wizard：CLI 问答式部署向导 ────────────────────────────────────
// 与 TUI 并列的交互形态：逐项询问部署参数（全部带默认值，可一路回车），
// 生成 env 后直接执行 compose up --wait。prompter 是测试 seam，
// 真实实现基于 Bun 内置 prompt，零外部依赖。

/** 问答 seam：text 空输入取 fallback；bool 接受 y/n，空输入取默认。 */
export type DeployPrompter = {
  text(question: string, fallback: string): Promise<string>
  bool(question: string, fallbackYes: boolean): Promise<boolean>
}

// bun-types 把全局 prompt 声明为 DOM 签名（返回 string | null，EOF 为 null）；
// Bun 运行时实现是可 await 的变体，行为一致。null 一律按拒绝/默认值处理。
type PromptFn = (question: string) => Promise<string | null>
const bunPrompt: PromptFn = async question => prompt(question)

export const defaultDeployPrompter: DeployPrompter = {
  async text(question, fallback) {
    // 不用 Bun.prompt 的 options.default：当前版本空输入会返回 options 对象而非默认值
    const raw = await bunPrompt(`${question} (${fallback})`)
    const value = typeof raw === 'string' ? raw.trim() : ''
    return value.length > 0 ? value : fallback
  },
  async bool(question, fallbackYes) {
    const raw = await bunPrompt(`${question} [${fallbackYes ? 'Y/n' : 'y/N'}]`)
    // Bun prompt 对「空回车」与「stdin EOF」都返回 null：
    // TTY 上空回车 = 接受默认值；非 TTY（管道/EOF）视为拒绝，防止无确认自动部署。
    if (raw === null) return process.stdin.isTTY ? fallbackYes : false
    const value = raw.trim().toLowerCase()
    if (value === 'y' || value === 'yes') return true
    if (value === 'n' || value === 'no') return false
    return fallbackYes
  }
}

export type WizardOptions = { timeout?: string }

/**
 * 问答流程：provider 探测 → env 覆盖确认 → 配置（快速/自定义）→ 确认 →
 * 写 env（0600）→ compose up --wait → 可选当场读取 admin token。
 * 进度走 deps.log（stderr），stdout 只承载最终 JSON 结果。
 */
export async function runDeployWizard(
  deps: DeployCommandDeps,
  prompter: DeployPrompter,
  overrides: { file?: string; envFile?: string },
  options: WizardOptions
): Promise<CliRunResult> {
  const log = deps.log ?? ((line: string) => process.stderr.write(`${line}\n`))
  const paths: ComposePaths = resolveComposePaths(deps, overrides)

  const binary = resolveProvider(deps)
  if (!existsSync(paths.composeFile)) {
    throw new Error(`compose file not found: ${paths.composeFile}`)
  }
  log(`容器 provider: ${binary}`)
  log(`compose 文件: ${paths.composeFile}`)

  // 已有 env：保留其中的密钥。postgres 数据卷只在首次初始化时应用密码，
  // 重新生成密钥会让 bootstrap 鉴权失败；因此重新配置仅更新端口等非密钥项。
  let keepSecrets = false
  if (existsSync(paths.envFile)) {
    keepSecrets = await prompter.bool(
      `env 文件已存在(${paths.envFile})，重新配置端口等项并保留现有密钥`,
      false
    )
    if (!keepSecrets) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `aborted; keep current env and run 'meristem deploy up' to redeploy\n`
      }
    }
  }

  const quick = await prompter.bool('使用默认配置快速部署（端口/地址全部默认值）', true)
  const corePort = quick ? '3000' : await prompter.text('Core API 端口', '3000')
  const bffPort = quick ? '3200' : await prompter.text('M-UI BFF 端口', '3200')
  const uiPort = quick ? '8080' : await prompter.text('M-UI 端口', '8080')
  const joinPort = quick ? '8443' : await prompter.text('Join Ingress 端口', '8443')
  const joinPublicUrl = quick
    ? `https://localhost:${joinPort}`
    : await prompter.text('节点可达的 Join 地址', `https://localhost:${joinPort}`)
  // BFF 地址会被烧入 M-UI 静态产物，远程部署时浏览器必须能直接访问它，
  // 因此自定义模式必须显式收集，不能想当然用 localhost。
  const publicBffUrl = quick
    ? `http://localhost:${bffPort}`
    : await prompter.text('浏览器可达的 BFF 地址', `http://localhost:${bffPort}`)
  const actors = quick ? 'admin' : await prompter.text('初始 actor 列表（逗号分隔）', 'admin')
  if (!quick) {
    // actor 会被 bootstrap 拼进 token 文件路径，与 deploy token 的校验保持同一字符集
    const invalid = actors
      .split(',')
      .map(a => a.trim())
      .filter(a => a.length > 0 && !/^[A-Za-z0-9_-]+$/.test(a))
    if (invalid.length > 0) {
      throw new Error(`invalid actor names (must match [A-Za-z0-9_-]+): ${invalid.join(', ')}`)
    }
  }

  const confirmed = await prompter.bool('确认生成配置并开始部署（构建镜像可能需要数分钟）', true)
  if (!confirmed) {
    return { exitCode: 1, stdout: '', stderr: 'aborted by user\n' }
  }

  const template = await loadEnvTemplate(deps)
  // 重新配置场景：从旧 env 原样带回密钥。四个密钥键缺一不可——缺键时若
  // 静默换成随机值，会与既有数据卷密码失配导致全栈起不来，必须显式失败。
  const secretKeys = Object.values(ENV_PLACEHOLDER_KEYS)
  const secretOverrides = keepSecrets
    ? readEnvKeys(await Bun.file(paths.envFile).text(), secretKeys)
    : {}
  const missingSecrets = secretKeys.filter(key => !(key in secretOverrides))
  if (keepSecrets && missingSecrets.length > 0) {
    throw new Error(
      `existing env is missing secret keys: ${missingSecrets.join(', ')}; ` +
        `run 'meristem deploy down --volumes' then re-run the wizard for a fresh deployment`
    )
  }
  const { content, generatedKeys } = buildEnvContent(template, {
    MERISTEM_CORE_PORT: corePort,
    MERISTEM_BFF_PORT: bffPort,
    MERISTEM_UI_PORT: uiPort,
    MERISTEM_JOIN_INGRESS_PORT: joinPort,
    MERISTEM_JOIN_PUBLIC_URL: joinPublicUrl,
    MERISTEM_PUBLIC_BFF_URL: publicBffUrl,
    MERISTEM_BOOTSTRAP_ACTORS: actors,
    ...secretOverrides
  })
  await writeEnvFile(paths.envFile, content)
  log(
    keepSecrets
      ? `env 已更新: ${paths.envFile}（0600；保留现有密钥，如需轮换请先 down --volumes 后重新向导）`
      : `env 已生成: ${paths.envFile}（0600；随机生成: ${generatedKeys.join(', ')}）`
  )
  log('开始部署：构建镜像并启动全栈，等待全部服务 healthy…')

  assertComposeFiles(paths)
  const exitCode = await runUp(
    deps,
    { binary, args: ['compose', '-f', paths.composeFile, '--env-file', paths.envFile] },
    { timeout: options.timeout ?? '900' }
  )
  if (exitCode !== 0) {
    return streamResult(exitCode)
  }

  log(`部署完成。M-UI: http://localhost:${uiPort} | Core API: http://localhost:${corePort}`)
  const fetchToken = await prompter.bool('立即读取首个 actor 的 token', false)
  if (!fetchToken) {
    return success({ deployed: true, envFile: paths.envFile, uiUrl: `http://localhost:${uiPort}` })
  }
  // 与 MERISTEM_BOOTSTRAP_ACTORS 对齐：取列表第一个 actor，而不是写死 admin
  const firstActor =
    actors
      .split(',')
      .map(a => a.trim())
      .find(a => a.length > 0) ?? 'admin'
  const token = await runToken(
    deps,
    {
      binary,
      args: ['compose', '-f', paths.composeFile, '--env-file', paths.envFile]
    },
    firstActor
  )
  if (!token.ok) return { exitCode: 1, stdout: '', stderr: token.stderr }
  return success({ deployed: true, envFile: paths.envFile, actor: firstActor, token: token.token })
}
