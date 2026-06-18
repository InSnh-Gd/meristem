import { handleBasicCommands } from './commands/basic-commands.ts'
import { handleExtensionApprovalCommands } from './commands/extension-approval-commands.ts'
import { handleIdentityCommands } from './commands/identity-commands.ts'
import { handleNodeNetworkCommands } from './commands/node-network-commands.ts'
import { handleSecretConfigCommands } from './commands/secret-config-commands.ts'
import { handleTaskProjectionCommands } from './commands/task-projection-commands.ts'
import type { CliClient, CliRunResult } from './commands/types.ts'

export type { CliClient, CliRunResult } from './commands/types.ts'

const handlers = [
  handleBasicCommands,
  handleNodeNetworkCommands,
  handleTaskProjectionCommands,
  handleExtensionApprovalCommands,
  handleIdentityCommands,
  handleSecretConfigCommands
]

const CLI_USAGE =
  'usage: meristem status | node register --kind <stem|leaf> --name <name> [--mode simulated] | node ticket create --kind <stem|leaf> --name <name> [--expires <seconds>] | node issue-token --node <node-id> | node list | network create/list/join/members | network profile list | network profile show <version> | network profile enable --network <id> --profile <version> --reason <text> | network profile disable --network <id> --reason <text> | mnet migration status [--operation <id>] | mnet migration dry-run --target-version <v> --reason <text> [--batch-size <n>] | mnet migration apply --operation <id> | mnet migration resume --operation <id> | mnet migration rollback --operation <id> --reason <text> | mnet health --network <id> | mnet relay --network <id> | mnet map inspect --network <id> | mnet break-glass --network <id> --reason <text> --confirm-break-glass | extension list | extension show <id> | extension register <manifest-file> [--reason <text>] | extension enable <id> [--reason <text>] | extension disable <id> [--reason <text>] | task submit/cancel/status/list/retry | service list/reload | log timeline | audit list | policy approvals list | policy approvals show <id> | policy approvals approve <id> [--reason <text>] | policy approvals reject <id> [--reason <text>] | projection health | projection backfill --index <name> [--from <cursor>] [--to <cursor>] [--batch-size <n>] | projection dlq list [--index <name>] | projection dlq replay --id <dlq-id> | projection dlq skip --id <dlq-id> | identity actor list | identity actor show <actor-id> | identity token issue --actor <actor-id> --ttl <duration> --purpose <text> | identity token inspect <jti> | identity token revoke <jti> --reason <text> | secret list | secret show <secret-ref-id> | secret create --name <name> --scope system|service|node --value-stdin [--metadata <json>] | secret rotate <secret-ref-id> --value-stdin --reason <text> | secret disable <secret-ref-id> --reason <text> | config list | config show <config-id> | config draft --domain <domain> --file <path> [--target-scope <service1,service2>] | config validate <config-id> | config publish <config-id> --reason <text> | config rollback <config-id> --to <version> --reason <text>'

/**
 * CLI 入口只负责装配命令处理器和统一错误出口，业务行为仍由各命令分组模块维持。
 */
export function createCliRunner(client: CliClient) {
  return {
    async run(args: string[]): Promise<CliRunResult> {
      try {
        for (const handler of handlers) {
          const result = await handler(client, args)
          if (result) return result
        }
        throw new Error(CLI_USAGE)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown CLI error'
        return { exitCode: 1, stdout: '', stderr: `${message}\n` }
      }
    }
  }
}
