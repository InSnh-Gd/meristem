import { requireMethod, success, type CliCommandHandler } from './shared.ts'

/**
 * 状态、服务和基础可观测性命令维持在同一分组，避免在 facade 中重新展开细节。
 */
export const handleBasicCommands: CliCommandHandler = async (client, args) => {
  const [command, subcommand] = args

  if (command === 'status') {
    return success(await client.status())
  }

  if (command === 'service' && subcommand === 'list') {
    const listServices = requireMethod(client.listServices, 'listServices')
    return success(await listServices())
  }

  if (command === 'service' && subcommand === 'reload') {
    const serviceId = requireArg(args, '--service')
    const reasonFlagIndex = args.indexOf('--reason')
    const reason = reasonFlagIndex >= 0 ? args[reasonFlagIndex + 1] : undefined
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

function requireArg(args: string[], flag: string): string {
  const index = args.indexOf(flag)
  const value = index >= 0 ? args[index + 1] : undefined
  if (!value) throw new Error(`missing ${flag}`)
  return value
}
