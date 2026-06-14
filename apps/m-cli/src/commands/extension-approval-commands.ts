import type { MExtensionManifestV01 } from '../../../../packages/contracts/src/index.ts'
import { readJsonFile, requireMethod, success, type CliCommandHandler } from './shared.ts'

const APPROVALS_USAGE =
  'usage: meristem policy approvals list | policy approvals show <approval-id> | policy approvals approve <approval-id> [--reason <text>] | policy approvals reject <approval-id> [--reason <text>]'

/**
 * 扩展与审批命令都依赖外部控制面 API，拆分后继续保持原有 usage 和输入解析方式。
 */
export const handleExtensionApprovalCommands: CliCommandHandler = async (client, args) => {
  const [command, subcommand] = args

  if (command === 'extension' && subcommand === 'list') {
    const listExtensions = requireMethod(client.listExtensions, 'listExtensions')
    return success(await listExtensions())
  }

  if (command === 'extension' && subcommand === 'show') {
    const extensionId = args[2]
    if (!extensionId) throw new Error('usage: meristem extension show <id>')
    const getExtension = requireMethod(client.getExtension, 'getExtension')
    return success(await getExtension(extensionId))
  }

  if (command === 'extension' && subcommand === 'register') {
    const manifestFile = args[2]
    if (!manifestFile) {
      throw new Error('usage: meristem extension register <manifest-file> [--reason <text>]')
    }
    const reasonFlagIndex = args.indexOf('--reason')
    const reason = reasonFlagIndex >= 0 ? args[reasonFlagIndex + 1] : undefined
    const manifest = await readJsonFile<MExtensionManifestV01>(manifestFile)
    const registerExtension = requireMethod(client.registerExtension, 'registerExtension')
    return success(await registerExtension(reason ? { manifest, reason } : { manifest }))
  }

  if (command === 'extension' && subcommand === 'enable') {
    const extensionId = args[2]
    if (!extensionId) throw new Error('usage: meristem extension enable <id> [--reason <text>]')
    const reasonFlagIndex = args.indexOf('--reason')
    const reason = reasonFlagIndex >= 0 ? args[reasonFlagIndex + 1] : undefined
    const enableExtension = requireMethod(client.enableExtension, 'enableExtension')
    return success(await enableExtension(extensionId, reason ? { reason } : {}))
  }

  if (command === 'extension' && subcommand === 'disable') {
    const extensionId = args[2]
    if (!extensionId) throw new Error('usage: meristem extension disable <id> [--reason <text>]')
    const reasonFlagIndex = args.indexOf('--reason')
    const reason = reasonFlagIndex >= 0 ? args[reasonFlagIndex + 1] : undefined
    const disableExtension = requireMethod(client.disableExtension, 'disableExtension')
    return success(await disableExtension(extensionId, reason ? { reason } : {}))
  }

  if (command === 'policy' && subcommand === 'approvals') {
    const action = args[2]
    if (action === 'list') {
      const listApprovals = requireMethod(client.listApprovals, 'listApprovals')
      return success(await listApprovals())
    }
    if (action === 'show') {
      const id = args[3]
      if (!id) throw new Error('usage: meristem policy approvals show <approval-id>')
      const getApproval = requireMethod(client.getApproval, 'getApproval')
      return success(await getApproval(id))
    }
    if (action === 'approve') {
      const id = args[3]
      if (!id) {
        throw new Error('usage: meristem policy approvals approve <approval-id> [--reason <text>]')
      }
      const reasonFlagIndex = args.indexOf('--reason')
      const reason = reasonFlagIndex >= 0 ? args[reasonFlagIndex + 1] : undefined
      const approveApproval = requireMethod(client.approveApproval, 'approveApproval')
      return success(await approveApproval(id, reason))
    }
    if (action === 'reject') {
      const id = args[3]
      if (!id) {
        throw new Error('usage: meristem policy approvals reject <approval-id> [--reason <text>]')
      }
      const reasonFlagIndex = args.indexOf('--reason')
      const reason = reasonFlagIndex >= 0 ? args[reasonFlagIndex + 1] : undefined
      const rejectApproval = requireMethod(client.rejectApproval, 'rejectApproval')
      return success(await rejectApproval(id, reason))
    }
    throw new Error(APPROVALS_USAGE)
  }

  return undefined
}
