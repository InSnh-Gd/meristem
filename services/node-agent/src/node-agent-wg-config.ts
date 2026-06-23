import { createHash } from 'node:crypto'
import type { NetworkMapFromSchema as NetworkMap } from '../../../packages/contracts/src/schemas/mnet-profile.ts'

export const DEFAULT_WG_LISTEN_PORT = 51820
export const DEFAULT_WG_PRIVATE_KEY_PATH = '/run/meristem/wg-private.key'
export const DEFAULT_WSTUNNEL_UDP_BIND_HOST = '127.0.0.1'
export const DEFAULT_WSTUNNEL_UDP_BIND_PORT = 51821

type Result<TValue, TError> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: TError }

export type WgConfigInput = {
  readonly map: NetworkMap
  readonly agentNodeId: string
  readonly listenPort?: number
  /** WireGuard 私钥的 base64 内容，直接内联到配置中供 `wg setconf` 消费。 */
  readonly privateKey: string
  readonly localRelayEndpoint?: string
}

export type WgConfigOutput = {
  readonly config: string
  readonly listenPort: number
  readonly peerCount: number
}

export type WgConfigError =
  | {
      readonly kind: 'wg.local_member_missing'
      readonly nodeId: string
    }
  | {
      readonly kind: 'wg.listen_port_invalid'
      readonly listenPort: number
    }
  | {
      readonly kind: 'wg.private_key_path_missing'
    }
  | {
      readonly kind: 'wg.endpoint_missing'
      readonly nodeId: string
    }
  | {
      readonly kind: 'wg.endpoint_invalid'
      readonly endpoint: string
    }

export type WgConfigResult = Result<WgConfigOutput, WgConfigError>

export type WgToolingInput = {
  readonly wgBinaryPath?: string
  readonly wgVersionOutput?: string
  readonly wireguardGoBinaryPath?: string
  readonly wireguardGoVersionOutput?: string
}

export type WgBinaryInfo = {
  readonly binary: 'wg' | 'wireguard-go'
  readonly path: string
  readonly version: string
}

export type WgToolingOutput = {
  readonly wg: WgBinaryInfo
  readonly wireguardGo?: WgBinaryInfo
}

export type WgToolingError =
  | {
      readonly kind: 'wg.binary_missing'
      readonly binary: 'wg' | 'wireguard-go'
    }
  | {
      readonly kind: 'wg.version_unparseable'
      readonly binary: 'wg' | 'wireguard-go'
      readonly output: string
    }

export type WgToolingResult = Result<WgToolingOutput, WgToolingError>

type NetworkMapMember = NetworkMap['members'][number]

function isValidListenPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65_535
}

function isNonEmpty(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0
}

function normalizePeerEndpoint(endpoint: string): Result<string, WgConfigError> {
  const trimmed = endpoint.trim()
  if (trimmed.length === 0) {
    return { ok: false, error: { kind: 'wg.endpoint_invalid', endpoint } }
  }

  if (/^[^\s:]+:\d+$/.test(trimmed)) {
    return { ok: true, value: trimmed }
  }

  try {
    const parsed = new URL(trimmed)
    const port = parsed.port.length > 0 ? parsed.port : defaultPortForProtocol(parsed.protocol)
    if (!isNonEmpty(parsed.hostname) || port === null) {
      return { ok: false, error: { kind: 'wg.endpoint_invalid', endpoint } }
    }
    return { ok: true, value: `${parsed.hostname}:${port}` }
  } catch {
    return { ok: false, error: { kind: 'wg.endpoint_invalid', endpoint } }
  }
}

function defaultPortForProtocol(protocol: string): string | null {
  switch (protocol) {
    case 'wss:':
    case 'https:':
      return '443'
    case 'ws:':
    case 'http:':
      return '80'
    default:
      return null
  }
}

function buildInterfaceLines(
  localMember: NetworkMapMember,
  privateKey: string,
  listenPort: number
) {
  // Address 由 ensureWireGuardInterface 通过 `ip address replace` 单独设置，
  // 不放入配置文件——`wg setconf` 不识别 wg-quick 专用的 Address 指令。
  return [
    '[Interface]',
    `PrivateKey = ${privateKey}`,
    `ListenPort = ${listenPort}`
  ]
}

function buildPeerLines(peer: NetworkMapMember, endpoint: string) {
  return [
    '[Peer]',
    `PublicKey = ${peer.publicKey}`,
    `AllowedIPs = ${peer.tunnelIp}/32`,
    `Endpoint = ${endpoint}`
  ]
}

function resolveRelayEndpoint(input: WgConfigInput): Result<string, WgConfigError> {
  const relayAssignment = input.map.relayAssignment
  if (relayAssignment === undefined) {
    return {
      ok: false,
      error: { kind: 'wg.endpoint_missing', nodeId: input.agentNodeId }
    }
  }

  if (relayAssignment.relayType === 'wstunnel') {
    const localEndpoint =
      input.localRelayEndpoint ??
      `${DEFAULT_WSTUNNEL_UDP_BIND_HOST}:${DEFAULT_WSTUNNEL_UDP_BIND_PORT}`
    return normalizePeerEndpoint(localEndpoint)
  }

  if (!isNonEmpty(relayAssignment.relayEndpoint)) {
    return {
      ok: false,
      error: { kind: 'wg.endpoint_missing', nodeId: input.agentNodeId }
    }
  }

  return normalizePeerEndpoint(relayAssignment.relayEndpoint)
}

function sortPeers(peers: readonly NetworkMapMember[]): readonly NetworkMapMember[] {
  return [...peers].sort((left, right) => left.nodeId.localeCompare(right.nodeId))
}

function parseVersion(output: string, binary: 'wg' | 'wireguard-go'): string | null {
  const pattern =
    binary === 'wg'
      ? /wireguard-tools\s+v(?<version>[^\s]+)/i
      : /wireguard-go\s+version\s+(?<version>[^\s]+)/i
  const match = output.match(pattern)
  return match?.groups?.version ?? null
}

/**
 * 从签名 network-map 渲染确定性的 WireGuard 配置文本；私钥以 base64 内容内联，
 * 供 `wg setconf` 直接消费（`wg setconf` 不支持 wg-quick 的 Address 指令和文件路径引用）。
 *
 * 对等节点 Endpoint 选择策略：
 * 1. 若对等节点在 network-map 中声明了 `endpoint`（STUN 发现的公网地址），使用直接 P2P 连接。
 * 2. 否则回退到 wstunnel relay 本地 UDP 绑定地址（`localRelayEndpoint`）。
 */
export function renderWireGuardConfig(input: WgConfigInput): WgConfigResult {
  const listenPort = input.listenPort ?? DEFAULT_WG_LISTEN_PORT
  if (!isValidListenPort(listenPort)) {
    return { ok: false, error: { kind: 'wg.listen_port_invalid', listenPort } }
  }

  if (!isNonEmpty(input.privateKey)) {
    return { ok: false, error: { kind: 'wg.private_key_path_missing' } }
  }

  const localMember = input.map.members.find(member => member.nodeId === input.agentNodeId)
  if (localMember === undefined) {
    return {
      ok: false,
      error: { kind: 'wg.local_member_missing', nodeId: input.agentNodeId }
    }
  }

  const peers = sortPeers(input.map.members.filter(member => member.nodeId !== input.agentNodeId))
  const lines = buildInterfaceLines(localMember, input.privateKey, listenPort)

  if (peers.length > 0) {
    // 预解析 relay fallback endpoint（仅在有 peer 缺少 direct endpoint 时使用）
    let relayFallback: string | null = null
    const needsRelay = peers.some(peer => !isNonEmpty(peer.endpoint))
    if (needsRelay) {
      const relayResult = resolveRelayEndpoint(input)
      if (!relayResult.ok) return relayResult
      relayFallback = relayResult.value
    }

    for (const peer of peers) {
      const peerEndpoint = isNonEmpty(peer.endpoint)
        ? normalizePeerEndpoint(peer.endpoint)
        : null
      const endpoint = peerEndpoint?.ok ? peerEndpoint.value : relayFallback
      if (!endpoint) {
        return { ok: false, error: { kind: 'wg.endpoint_missing', nodeId: peer.nodeId } }
      }
      lines.push('', ...buildPeerLines(peer, endpoint))
    }
  }

  return {
    ok: true,
    value: {
      config: lines.join('\n'),
      listenPort,
      peerCount: peers.length
    }
  }
}

/**
 * 计算配置文本的 SHA-256 十六进制摘要，用于节点侧判断配置是否发生确定性变化。
 */
export function computeConfigHash(config: string): string {
  return createHash('sha256').update(config).digest('hex')
}

/**
 * 校验 WireGuard 主机工具路径和版本文本是否可用；只解析调用方提供的静态信息，不执行任何进程。
 */
export function checkWgTooling(input: WgToolingInput): WgToolingResult {
  if (!isNonEmpty(input.wgBinaryPath)) {
    return { ok: false, error: { kind: 'wg.binary_missing', binary: 'wg' } }
  }
  if (!isNonEmpty(input.wgVersionOutput)) {
    return {
      ok: false,
      error: { kind: 'wg.version_unparseable', binary: 'wg', output: input.wgVersionOutput ?? '' }
    }
  }

  const wgVersion = parseVersion(input.wgVersionOutput, 'wg')
  if (wgVersion === null) {
    return {
      ok: false,
      error: { kind: 'wg.version_unparseable', binary: 'wg', output: input.wgVersionOutput }
    }
  }

  const wg: WgBinaryInfo = {
    binary: 'wg',
    path: input.wgBinaryPath,
    version: wgVersion
  }

  if (!isNonEmpty(input.wireguardGoBinaryPath) && !isNonEmpty(input.wireguardGoVersionOutput)) {
    return { ok: true, value: { wg } }
  }
  if (!isNonEmpty(input.wireguardGoBinaryPath)) {
    return { ok: false, error: { kind: 'wg.binary_missing', binary: 'wireguard-go' } }
  }
  if (!isNonEmpty(input.wireguardGoVersionOutput)) {
    return {
      ok: false,
      error: {
        kind: 'wg.version_unparseable',
        binary: 'wireguard-go',
        output: input.wireguardGoVersionOutput ?? ''
      }
    }
  }

  const wireguardGoVersion = parseVersion(input.wireguardGoVersionOutput, 'wireguard-go')
  if (wireguardGoVersion === null) {
    return {
      ok: false,
      error: {
        kind: 'wg.version_unparseable',
        binary: 'wireguard-go',
        output: input.wireguardGoVersionOutput
      }
    }
  }

  return {
    ok: true,
    value: {
      wg,
      wireguardGo: {
        binary: 'wireguard-go',
        path: input.wireguardGoBinaryPath,
        version: wireguardGoVersion
      }
    }
  }
}
