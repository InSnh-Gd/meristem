import {
  DEFAULT_ACME_DIRECTORY,
  DEFAULT_CONFIG_DIR,
  DEFAULT_JOIN_URL,
  DEFAULT_RELAY_ENDPOINT,
  DEFAULT_RUNTIME_STATE_PATH,
  DEFAULT_WG_BINARY_PATH,
  DEFAULT_WSTUNNEL_BINARY_PATH,
  requireNodeRole,
  resolveLifecycleConfig
} from './node-agent-lifecycle-definitions.ts'
import {
  installNodeAgent,
  uninstallNodeAgent,
  upgradeNodeAgent
} from './node-agent-lifecycle-support.ts'
import {
  type CliCommandHandler,
  hasFlag,
  optionalOption,
  parseArgs,
  requireOption,
  success
} from './shared.ts'

const NODE_AGENT_USAGE =
  'usage: meristem node-agent install --kind <stem|leaf> --name <name> [--join-ticket <ticket>] [--join-url <url>] [--relay-endpoint <url>] [--wg-binary <path>] [--wstunnel-binary <path>] [--acme-directory <url>] [--config-dir <path>] [--runtime-state <path>] [--rotate-wireguard-key] [--rotate-acme-account-key] | node-agent upgrade [--join-ticket <ticket>] [--join-url <url>] [--relay-endpoint <url>] [--wg-binary <path>] [--wstunnel-binary <path>] [--acme-directory <url>] [--config-dir <path>] [--runtime-state <path>] [--rotate-runtime-token] [--rotate-wireguard-key] [--rotate-acme-account-key] | node-agent uninstall [--config-dir <path>] [--runtime-state <path>] [--purge-secrets]'

/**
 * 节点代理操作保持在主机本地文件与 systemd 契约边界内，不扩展为远程编排器。
 */
export const handleNodeAgentCommands: CliCommandHandler = async (_client, args) => {
  const { positionals, options } = parseArgs(args)
  const [command, action] = positionals

  if (command !== 'node-agent') return undefined

  const lifecycle = resolveLifecycleConfig(
    optionalOption(options, '--config-dir') ?? DEFAULT_CONFIG_DIR,
    optionalOption(options, '--runtime-state') ?? DEFAULT_RUNTIME_STATE_PATH
  )

  if (action === 'install') {
    return success(
      await installNodeAgent(lifecycle, {
        kind: requireNodeRole(requireOption(options, '--kind')),
        name: requireOption(options, '--name'),
        joinUrl: optionalOption(options, '--join-url') ?? DEFAULT_JOIN_URL,
        relayEndpoint: optionalOption(options, '--relay-endpoint') ?? DEFAULT_RELAY_ENDPOINT,
        wgBinaryPath: optionalOption(options, '--wg-binary') ?? DEFAULT_WG_BINARY_PATH,
        wstunnelBinaryPath:
          optionalOption(options, '--wstunnel-binary') ?? DEFAULT_WSTUNNEL_BINARY_PATH,
        acmeDirectory: optionalOption(options, '--acme-directory') ?? DEFAULT_ACME_DIRECTORY,
        joinTicket: optionalOption(options, '--join-ticket'),
        rotateWireGuardKey: hasFlag(options, '--rotate-wireguard-key'),
        rotateAcmeAccountKey: hasFlag(options, '--rotate-acme-account-key')
      })
    )
  }

  if (action === 'upgrade') {
    return success(
      await upgradeNodeAgent(lifecycle, {
        joinUrl: optionalOption(options, '--join-url'),
        relayEndpoint: optionalOption(options, '--relay-endpoint'),
        wgBinaryPath: optionalOption(options, '--wg-binary'),
        wstunnelBinaryPath: optionalOption(options, '--wstunnel-binary'),
        acmeDirectory: optionalOption(options, '--acme-directory'),
        joinTicket: optionalOption(options, '--join-ticket'),
        rotateRuntimeToken: hasFlag(options, '--rotate-runtime-token'),
        rotateWireGuardKey: hasFlag(options, '--rotate-wireguard-key'),
        rotateAcmeAccountKey: hasFlag(options, '--rotate-acme-account-key')
      })
    )
  }

  if (action === 'uninstall') {
    return success(
      await uninstallNodeAgent(lifecycle, { purgeSecrets: hasFlag(options, '--purge-secrets') })
    )
  }

  throw new Error(NODE_AGENT_USAGE)
}
