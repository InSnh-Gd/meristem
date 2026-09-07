import { existsSync } from 'node:fs'
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
import { type CliCommandHandler, hasFlag, optionalOption, parseArgs, success } from './shared.ts'
import { defaultDeployPrompter, runDeployWizard } from './deploy-wizard.ts'
import { runDeployTui } from './deploy-tui.ts'

// 说明：本文件是 deploy 命令族的分派层；共享能力在 deploy-common.ts，
// 交互式形态在 deploy-wizard.ts（CLI 问答）与 deploy-tui.ts（全屏控制台）。
export type { DeployCommandDeps, DeployProcessResult } from './deploy-common.ts'
export { DEPLOY_USAGE } from './deploy-common.ts'

/** deploy init：从模板生成 env 文件并替换随机密钥，重复执行默认拒绝覆盖。 */
async function initEnvFile(
  deps: DeployCommandDeps,
  envFile: string,
  options: Record<string, string | boolean>
): Promise<{ envFile: string; generatedKeys: string[]; stderr: string }> {
  const overwriting = existsSync(envFile)
  if (overwriting && !hasFlag(options, '--force')) {
    throw new Error(`${envFile} already exists; pass --force to overwrite`)
  }
  const template = await loadEnvTemplate(deps)
  const { content, generatedKeys } = buildEnvContent(template)
  await writeEnvFile(envFile, content)
  // 覆盖即轮换全部密钥：与既有 postgres 数据卷密码失配会让栈起不来
  const stderr = overwriting
    ? 'warning: regenerated all secrets; if a data volume from a previous deployment exists, ' +
      "run 'meristem deploy down --volumes' before the next 'deploy up'\n"
    : ''
  return { envFile, generatedKeys, stderr }
}

/**
 * deploy 命令组：单机生产部署的 kubectl 式入口（非交互）+ 交互式向导与 TUI。
 * 不经过 Core client——部署发生在控制面可用之前，副作用全部委托 compose。
 */
export function createDeployCommands(deps: DeployCommandDeps): CliCommandHandler {
  return async (_client, args) => {
    if (args[0] !== 'deploy') return undefined
    const { positionals, options } = parseArgs(args)
    const action = positionals[1]
    if (!action) throw new Error(DEPLOY_USAGE)
    const file = optionalOption(options, '--file')
    const envFile = optionalOption(options, '--env-file')
    const overrides = { ...(file ? { file } : {}), ...(envFile ? { envFile } : {}) }

    // deploy init：生成 env 文件，不需要 compose 上下文
    if (action === 'init') {
      const paths = resolveComposePaths(deps, overrides)
      const init = await initEnvFile(deps, paths.envFile, options)
      return { exitCode: 0, stdout: success(init).stdout, stderr: init.stderr }
    }

    const compose = resolveComposeContext(deps, overrides)

    if (action === 'up') {
      // --pull 走 registry 镜像（配合 CI 推送 / deploy.sh 场景）；
      // 默认从源码构建，适配单机首次部署。
      const timeout = optionalOption(options, '--timeout')
      const exitCode = await runUp(deps, compose, {
        pull: hasFlag(options, '--pull'),
        ...(timeout ? { timeout } : {})
      })
      return streamResult(exitCode)
    }

    if (action === 'status') {
      const result = await deps.run({
        binary: compose.binary,
        args: [...compose.args, 'ps', '--all'],
        stream: true
      })
      return streamResult(result.exitCode)
    }

    if (action === 'logs') {
      const logArgs = [...compose.args, 'logs']
      const tail = optionalOption(options, '--tail')
      if (tail) logArgs.push('--tail', tail)
      if (hasFlag(options, '--follow')) logArgs.push('--follow')
      const service = positionals[2]
      if (service) logArgs.push(service)
      const result = await deps.run({ binary: compose.binary, args: logArgs, stream: true })
      return streamResult(result.exitCode)
    }

    if (action === 'down') {
      const result = await deps.run({
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

    if (action === 'token') {
      const actor = positionals[2]
      if (!actor) throw new Error('usage: meristem deploy token <actor>')
      // actor 直接拼进容器内路径；argv 数组执行无 shell 注入面，
      // 字符集校验只防路径穿越（.. 等）。
      if (!/^[A-Za-z0-9_-]+$/.test(actor)) {
        throw new Error('actor must match [A-Za-z0-9_-]+')
      }
      const token = await runToken(deps, compose, actor)
      if (!token.ok) return { exitCode: 1, stdout: '', stderr: token.stderr }
      return success({ actor, token: token.token })
    }

    // 交互式形态：CLI 问答向导 / 全屏 TUI 控制台
    if (action === 'wizard') {
      const timeout = optionalOption(options, '--timeout')
      return runDeployWizard(deps, defaultDeployPrompter, overrides, {
        ...(timeout ? { timeout } : {})
      })
    }
    if (action === 'tui') return runDeployTui(deps, overrides)

    throw new Error(`unknown deploy action: ${action}\n${DEPLOY_USAGE}`)
  }
}

/** 生产入口使用真实进程执行器与仓库根路径。 */
export const handleDeployCommands: CliCommandHandler = createDeployCommands({
  repoRoot: resolveDefaultRepoRoot(),
  which: binary => Bun.which(binary),
  run: runProcess
})
