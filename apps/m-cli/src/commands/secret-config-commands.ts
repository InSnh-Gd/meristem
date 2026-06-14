import { readStdin, requireArg, requireMethod, success, type CliCommandHandler } from './shared.ts'

const SECRET_USAGE =
  'usage: meristem secret list | secret show <secret-ref-id> | secret create --name <name> --scope system|service|node --value-stdin [--metadata <json>] | secret rotate <secret-ref-id> --value-stdin --reason <text> | secret disable <secret-ref-id> --reason <text>'

const CONFIG_USAGE =
  'usage: meristem config list | config show <config-id> | config draft --domain <domain> --file <path> [--target-scope <service1,service2>] | config validate <config-id> | config publish <config-id> --reason <text> | config rollback <config-id> --to <version> --reason <text>'

/**
 * 密钥和配置命令都涉及本地输入读取，集中在同组可复用 stdin 与 JSON 解析逻辑。
 */
export const handleSecretConfigCommands: CliCommandHandler = async (client, args) => {
  const [command, subcommand] = args

  if (command === 'secret') {
    if (subcommand === 'list') {
      const list = requireMethod(client.secret?.list, 'secret.list')
      return success(await list())
    }
    if (subcommand === 'show') {
      const secretId = args[2]
      if (!secretId) throw new Error('usage: meristem secret show <secret-ref-id>')
      const get = requireMethod(client.secret?.get, 'secret.get')
      return success(await get(secretId))
    }
    if (subcommand === 'create') {
      const name = requireArg(args, '--name')
      const scope = requireArg(args, '--scope')
      const hasValueStdin = args.indexOf('--value-stdin') >= 0
      const value = hasValueStdin ? await readStdin() : requireArg(args, '--value')
      const metadataFlagIndex = args.indexOf('--metadata')
      const metadataRaw = metadataFlagIndex >= 0 ? args[metadataFlagIndex + 1] : undefined
      const metadata = metadataRaw ? JSON.parse(metadataRaw) : undefined
      const create = requireMethod(client.secret?.create, 'secret.create')
      return success(
        await create(metadata ? { name, scope, value, metadata } : { name, scope, value })
      )
    }
    if (subcommand === 'rotate') {
      const secretId = args[2]
      if (!secretId) {
        throw new Error(
          'usage: meristem secret rotate <secret-ref-id> --value-stdin --reason <text>'
        )
      }
      const hasValueStdin = args.indexOf('--value-stdin') >= 0
      const value = hasValueStdin ? await readStdin() : requireArg(args, '--value')
      const reason = requireArg(args, '--reason')
      const rotate = requireMethod(client.secret?.rotate, 'secret.rotate')
      return success(await rotate(secretId, { value, reason }))
    }
    if (subcommand === 'disable') {
      const secretId = args[2]
      if (!secretId)
        throw new Error('usage: meristem secret disable <secret-ref-id> --reason <text>')
      const reason = requireArg(args, '--reason')
      const disable = requireMethod(client.secret?.disable, 'secret.disable')
      return success(await disable(secretId, { reason }))
    }
    throw new Error(SECRET_USAGE)
  }

  if (command === 'config') {
    if (subcommand === 'list') {
      const list = requireMethod(client.config?.list, 'config.list')
      return success(await list())
    }
    if (subcommand === 'show') {
      const configId = args[2]
      if (!configId) throw new Error('usage: meristem config show <config-id>')
      const get = requireMethod(client.config?.get, 'config.get')
      return success(await get(configId))
    }
    if (subcommand === 'draft') {
      const domain = requireArg(args, '--domain')
      const fileFlagIndex = args.indexOf('--file')
      const file = fileFlagIndex >= 0 ? args[fileFlagIndex + 1] : undefined
      const targetScopeFlagIndex = args.indexOf('--target-scope')
      const targetScope =
        targetScopeFlagIndex >= 0 ? args[targetScopeFlagIndex + 1]?.split(',') : undefined
      const payload = file ? await Bun.file(file).text() : await readStdin()
      const draft = requireMethod(client.config?.draft, 'config.draft')
      const draftInput: { domain: string; payload: unknown; targetScope?: string[] } = {
        domain,
        payload: JSON.parse(payload)
      }
      if (targetScope) draftInput.targetScope = targetScope
      return success(await draft(draftInput))
    }
    if (subcommand === 'validate') {
      const configId = args[2]
      if (!configId) throw new Error('usage: meristem config validate <config-id>')
      const validate = requireMethod(client.config?.validate, 'config.validate')
      return success(await validate(configId))
    }
    if (subcommand === 'publish') {
      const configId = args[2]
      if (!configId) throw new Error('usage: meristem config publish <config-id> --reason <text>')
      const reason = requireArg(args, '--reason')
      const publish = requireMethod(client.config?.publish, 'config.publish')
      return success(await publish(configId, { reason }))
    }
    if (subcommand === 'rollback') {
      const configId = args[2]
      if (!configId) {
        throw new Error(
          'usage: meristem config rollback <config-id> --to <version> --reason <text>'
        )
      }
      const toVersion = requireArg(args, '--to')
      const reason = requireArg(args, '--reason')
      const rollback = requireMethod(client.config?.rollback, 'config.rollback')
      return success(await rollback(configId, { toVersion, reason }))
    }
    throw new Error(CONFIG_USAGE)
  }

  return undefined
}
