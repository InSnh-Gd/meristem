import {
  type CliCommandHandler,
  optionalOption,
  parseArgs,
  requireMethod,
  requireOption,
  success
} from './shared.ts'

/**
 * 状态、服务和基础可观测性命令维持在同一分组，避免在 facade 中重新展开细节。
 */
export const handleBasicCommands: CliCommandHandler = async (client, args) => {
  const { positionals, options } = parseArgs(args)
  const [command, subcommand] = positionals

  if (command === 'status') {
    return success(await client.status())
  }

  if (command === 'service' && subcommand === 'list') {
    const listServices = requireMethod(client.listServices, 'listServices')
    return success(await listServices())
  }

  if (command === 'service' && subcommand === 'reload') {
    const serviceId = requireOption(options, '--service')
    const reason = optionalOption(options, '--reason')
    const reloadService = requireMethod(client.reloadService, 'reloadService')
    return success(await reloadService(serviceId, reason))
  }

  if (command === 'log' && subcommand === 'timeline') {
    const listTimeline = requireMethod(client.listTimeline, 'listTimeline')
    return success(await listTimeline())
  }

  if (command === 'audit' && subcommand === 'list') {
    const listAudit = requireMethod(client.listAudit, 'listAudit')
    return success(await listAudit())
  }

  return undefined
}
