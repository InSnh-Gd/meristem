import cac from 'cac'
import { handleBasicCommands } from './commands/basic-commands.ts'
import { handleExtensionApprovalCommands } from './commands/extension-approval-commands.ts'
import { handleIdentityCommands } from './commands/identity-commands.ts'
import { handleNodeAgentCommands } from './commands/node-agent-commands.ts'
import { handleNodeNetworkCommands } from './commands/node-network-commands.ts'
import { handleSecretConfigCommands } from './commands/secret-config-commands.ts'
import { handleTaskProjectionCommands } from './commands/task-projection-commands.ts'
import type { CliClient, CliRunResult } from './commands/types.ts'

export type { CliClient, CliRunResult } from './commands/types.ts'

const handlers = [
  handleBasicCommands,
  handleNodeAgentCommands,
  handleNodeNetworkCommands,
  handleTaskProjectionCommands,
  handleExtensionApprovalCommands,
  handleIdentityCommands,
  handleSecretConfigCommands
]

/** 已知顶层命令名，用于检测未知命令。 */
const knownCommands = new Set([
  'status',
  'health',
  'ready',
  'node',
  'node-agent',
  'network',
  'mnet',
  'extension',
  'task',
  'service',
  'log',
  'audit',
  'policy',
  'projection',
  'identity',
  'secret',
  'config'
])

/**
 * CLI 入口用 cac 生成 help 和检测未知命令，命令分派仍由各 handler 模块处理。
 * 保持 createCliRunner(client).run(args): Promise<CliRunResult> 契约不变。
 */
export function createCliRunner(client: CliClient) {
  return {
    async run(args: string[]): Promise<CliRunResult> {
      // --help / -h：用 cac 生成帮助输出
      if (args.includes('--help') || args.includes('-h')) {
        return generateHelp()
      }

      // 检测未知顶层命令
      const firstArg = args[0]
      if (firstArg !== undefined && !knownCommands.has(firstArg)) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `Unknown command: ${firstArg}\nRun 'meristem --help' for available commands.\n`
        }
      }

      // 分派到 handler，保持原有解析逻辑
      try {
        for (const handler of handlers) {
          const result = await handler(client, args)
          if (result) return result
        }
        // 已知顶层命令但 handler 未匹配（如缺少子命令参数）
        throw new Error(
          `Incomplete command: ${firstArg ?? ''}\nRun 'meristem --help' for available commands.`
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown CLI error'
        return { exitCode: 1, stdout: '', stderr: `${message}\n` }
      }
    }
  }
}

/** 用 cac 构建命令树并生成 help 文本，不执行任何命令。 */
function generateHelp(): CliRunResult {
  const cli = cac('meristem')
  cli.usage('<command> [options]')
  cli.command('status', 'Show Core status')
  cli.command('health', 'Show health check')
  cli.command('ready', 'Show readiness check')
  cli.command('node', 'Node: register, ticket, issue-token, list')
  cli.command('node-agent', 'Node agent: install, upgrade, uninstall')
  cli.command('network', 'Network: create, list, join, members, profile')
  cli.command('mnet', 'M-Net: migration, health, relay, map, break-glass')
  cli.command('extension', 'Extension: list, show, register, enable, disable')
  cli.command('task', 'Task: submit, cancel, status, list, retry')
  cli.command('service', 'Service: list, reload')
  cli.command('log', 'Log: timeline')
  cli.command('audit', 'Audit: list')
  cli.command('policy approvals', 'Policy approvals: list, show, approve, reject')
  cli.command('projection', 'Projection: health, backfill, dlq')
  cli.command('identity', 'Identity: actor, token')
  cli.command('secret', 'Secret: list, show, create, rotate, disable')
  cli.command('config', 'Config: list, show, set, reload')
  cli.help()

  // 捕获 cac 的 console.info 输出
  let helpText = ''
  const originalInfo = console.info
  console.info = (...parts: unknown[]) => {
    helpText += `${parts.join(' ')}\n`
  }
  try {
    cli.parse(['meristem', 'meristem', '--help'], { run: false })
  } finally {
    console.info = originalInfo
  }

  return { exitCode: 0, stdout: helpText, stderr: '' }
}
