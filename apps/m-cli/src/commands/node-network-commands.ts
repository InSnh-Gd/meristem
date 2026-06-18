import { type CliCommandHandler, requireArg, requireMethod, success } from './shared.ts'

const NETWORK_PROFILE_USAGE =
  'usage: meristem network profile list | network profile show <version> | network profile enable --network <id> --profile <version> --reason <text> | network profile disable --network <id> --reason <text>'

/**
 * 节点与网络命令共同描述 M-Net 入口动作，放在同组可保留原有平铺分发语义。
 */
export const handleNodeNetworkCommands: CliCommandHandler = async (client, args) => {
  const [command, subcommand] = args

  if (command === 'node' && subcommand === 'register') {
    const kind = requireArg(args, '--kind')
    const name = requireArg(args, '--name')
    const modeFlagIndex = args.indexOf('--mode')
    const mode = modeFlagIndex >= 0 ? args[modeFlagIndex + 1] : undefined
    if (kind !== 'stem' && kind !== 'leaf') throw new Error('--kind must be stem or leaf')
    if (mode !== undefined && mode !== 'agent' && mode !== 'simulated')
      throw new Error('--mode must be agent or simulated')
    if (mode === 'agent')
      throw new Error('agent mode moved to node ticket create and the M-Net join ingress')
    const registerNode = requireMethod(client.registerNode, 'registerNode')
    return success(await registerNode(mode ? { kind, name, mode } : { kind, name }))
  }

  if (command === 'node' && subcommand === 'ticket') {
    const action = args[2]
    if (action !== 'create') {
      throw new Error(
        'usage: meristem node ticket create --kind <stem|leaf> --name <name> [--expires <seconds>]'
      )
    }
    const kind = requireArg(args, '--kind')
    const name = requireArg(args, '--name')
    const expiresFlagIndex = args.indexOf('--expires')
    const expires = expiresFlagIndex >= 0 ? Number(args[expiresFlagIndex + 1]) : undefined
    if (kind !== 'stem' && kind !== 'leaf') throw new Error('--kind must be stem or leaf')
    if (expires !== undefined && (!Number.isFinite(expires) || expires <= 0)) {
      throw new Error('--expires must be a positive integer')
    }
    const createNodeTicket = requireMethod(client.createNodeTicket, 'createNodeTicket')
    return success(
      await createNodeTicket(
        expires === undefined ? { kind, name } : { kind, name, expiresInSeconds: expires }
      )
    )
  }

  if (command === 'node' && subcommand === 'issue-token') {
    const nodeId = requireArg(args, '--node')
    const issueNodeToken = requireMethod(client.issueNodeToken, 'issueNodeToken')
    return success(await issueNodeToken(nodeId))
  }

  if (command === 'node' && subcommand === 'list') {
    const listNodes = requireMethod(client.listNodes, 'listNodes')
    return success(await listNodes())
  }

  if (command === 'network' && subcommand === 'create') {
    const name = requireArg(args, '--name')
    const profileFlagIndex = args.indexOf('--profile')
    const profileVersion = profileFlagIndex >= 0 ? args[profileFlagIndex + 1] : undefined
    const createNetwork = requireMethod(client.createNetwork, 'createNetwork')
    return success(await createNetwork(profileVersion ? { name, profileVersion } : { name }))
  }

  if (command === 'network' && subcommand === 'list') {
    const listNetworks = requireMethod(client.listNetworks, 'listNetworks')
    return success(await listNetworks())
  }

  if (command === 'network' && subcommand === 'join') {
    const networkId = requireArg(args, '--network')
    const nodeId = requireArg(args, '--node')
    const joinNetwork = requireMethod(client.joinNetwork, 'joinNetwork')
    return success(await joinNetwork({ networkId, nodeId }))
  }

  if (command === 'network' && subcommand === 'members') {
    const networkId = requireArg(args, '--network')
    const listNetworkMembers = requireMethod(client.listNetworkMembers, 'listNetworkMembers')
    return success(await listNetworkMembers(networkId))
  }

  if (command === 'network' && subcommand === 'profile') {
    const action = args[2]
    if (action === 'list') {
      const listNetworkProfiles = requireMethod(client.listNetworkProfiles, 'listNetworkProfiles')
      return success(await listNetworkProfiles())
    }
    if (action === 'show') {
      const profileVersion = args[3]
      if (!profileVersion) throw new Error('usage: meristem network profile show <profile-version>')
      const getNetworkProfile = requireMethod(client.getNetworkProfile, 'getNetworkProfile')
      return success(await getNetworkProfile(profileVersion))
    }
    if (action === 'enable') {
      const networkId = requireArg(args, '--network')
      const profileVersion = requireArg(args, '--profile')
      const reason = requireArg(args, '--reason')
      const enableNetworkProfile = requireMethod(
        client.enableNetworkProfile,
        'enableNetworkProfile'
      )
      return success(await enableNetworkProfile(networkId, profileVersion, reason))
    }
    if (action === 'disable') {
      const networkId = requireArg(args, '--network')
      const reason = requireArg(args, '--reason')
      const disableNetworkProfile = requireMethod(
        client.disableNetworkProfile,
        'disableNetworkProfile'
      )
      return success(await disableNetworkProfile(networkId, reason))
    }
    throw new Error(NETWORK_PROFILE_USAGE)
  }

  // ── M-Net 数据面与迁移命令（mnet 前缀） ────────────────────────────────
  if (command === 'mnet') {
    const action = args[1]

    // migration 子命令组
    if (action === 'migration') {
      const migrationAction = args[2]

      if (migrationAction === 'status') {
        const operationFlagIndex = args.indexOf('--operation')
        const operationId = operationFlagIndex >= 0 ? args[operationFlagIndex + 1] : undefined
        const migrationStatus = requireMethod(client.getMigrationStatus, 'getMigrationStatus')
        return success(await migrationStatus(operationId))
      }

      if (migrationAction === 'dry-run') {
        const targetVersion = requireArg(args, '--target-version')
        const reason = requireArg(args, '--reason')
        const batchSizeFlagIndex = args.indexOf('--batch-size')
        const batchSize = batchSizeFlagIndex >= 0 ? Number(args[batchSizeFlagIndex + 1]) : undefined
        const planMigration = requireMethod(client.planMigration, 'planMigration')
        return success(await planMigration(targetVersion, batchSize, reason))
      }

      if (migrationAction === 'apply') {
        const operationId = requireArg(args, '--operation')
        const applyMigration = requireMethod(client.applyMigration, 'applyMigration')
        return success(await applyMigration(operationId))
      }

      if (migrationAction === 'resume') {
        const operationId = requireArg(args, '--operation')
        const resumeMigration = requireMethod(client.resumeMigration, 'resumeMigration')
        return success(await resumeMigration(operationId))
      }

      if (migrationAction === 'rollback') {
        const operationId = requireArg(args, '--operation')
        const reason = requireArg(args, '--reason')
        const rollbackMigration = requireMethod(client.rollbackMigration, 'rollbackMigration')
        return success(await rollbackMigration(operationId, reason))
      }

      throw new Error(
        'usage: meristem mnet migration status [--operation <id>] | dry-run --target-version <v> --reason <text> [--batch-size <n>] | apply --operation <id> | resume --operation <id> | rollback --operation <id> --reason <text>'
      )
    }

    // health 子命令
    if (action === 'health') {
      const networkId = requireArg(args, '--network')
      const getDataplaneHealth = requireMethod(client.getDataplaneHealth, 'getDataplaneHealth')
      return success(await getDataplaneHealth(networkId))
    }

    // relay 子命令
    if (action === 'relay') {
      const networkId = requireArg(args, '--network')
      const getRelayAssignment = requireMethod(client.getRelayAssignment, 'getRelayAssignment')
      return success(await getRelayAssignment(networkId))
    }

    // map 子命令组
    if (action === 'map') {
      const mapAction = args[2]
      if (mapAction === 'inspect') {
        const networkId = requireArg(args, '--network')
        const getNetworkMap = requireMethod(client.getNetworkMap, 'getNetworkMap')
        return success(await getNetworkMap(networkId))
      }
      throw new Error('usage: meristem mnet map inspect --network <id>')
    }

    // break-glass 子命令
    if (action === 'break-glass') {
      const networkId = requireArg(args, '--network')
      const reason = requireArg(args, '--reason')
      const hasConfirm = args.includes('--confirm-break-glass')
      if (!hasConfirm) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: '--confirm-break-glass flag is required for break-glass operation\n'
        }
      }
      const breakGlass = requireMethod(client.breakGlass, 'breakGlass')
      return success(await breakGlass(networkId, reason))
    }

    throw new Error(
      'usage: meristem mnet migration status [--operation <id>] | migration dry-run --target-version <v> --reason <text> | migration apply --operation <id> | migration resume --operation <id> | migration rollback --operation <id> --reason <text> | health --network <id> | relay --network <id> | map inspect --network <id> | break-glass --network <id> --reason <text> --confirm-break-glass'
    )
  }

  return undefined
}
