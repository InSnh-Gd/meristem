export const DEFAULT_MNET_OVERLAY_CIDR = '100.96.0.0/12'

export type OverlayCidr = {
  readonly cidr: string
  readonly baseAddress: string
  readonly prefixLength: number
  readonly networkAddress: string
  readonly broadcastAddress: string
  readonly addressCount: number
}

export type OverlayCidrParseResult =
  | { readonly ok: true; readonly value: OverlayCidr }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

export type NetworkSubnetAllocation = {
  readonly networkId: string
  readonly cidr: string
  readonly networkAddress: string
  readonly broadcastAddress: string
  readonly prefixLength: number
  readonly addressCount: number
}

export type TunnelIpAssignment = {
  readonly networkId: string
  readonly nodeId: string
  readonly tunnelIp: string
  readonly cidr: string
}

export type AddressConflictFailure = {
  readonly kind: 'address.conflict'
  readonly networkId: string
  readonly nodeId: string
  readonly conflictingIp: string
}

export type AddressExhaustedFailure = {
  readonly kind: 'address.exhausted'
  readonly networkId: string
  readonly cidr: string
}

export type AddressAllocationResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: AddressConflictFailure | AddressExhaustedFailure }

export type AllocateNetworkSubnetInput = {
  readonly overlayCidr: string
  readonly networkId: string
  readonly subnetPrefixLength: number
  readonly existingAllocations: readonly NetworkSubnetAllocation[]
}

export type AssignNodeTunnelIpInput = {
  readonly networkId: string
  readonly nodeId: string
  readonly subnetCidr: string
  readonly requestedIp?: string
  readonly existingAssignments: readonly TunnelIpAssignment[]
}

type OverlayCidrParts = {
  readonly octets: readonly [number, number, number, number]
  readonly prefixLength: number
}

function invalid(code: string, message: string): OverlayCidrParseResult {
  return { ok: false, error: { code, message } }
}

function parseParts(value: string): OverlayCidrParts | OverlayCidrParseResult {
  if (value.length === 0) {
    return invalid('mnet.overlay_cidr.empty', 'overlay CIDR is required')
  }

  const match = value.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/)
  if (!match) {
    return invalid('mnet.overlay_cidr.invalid_format', 'overlay CIDR must be IPv4 CIDR text')
  }

  const [, first = '', second = '', third = '', fourth = '', prefix = ''] = match
  const octets = [Number(first), Number(second), Number(third), Number(fourth)] as const
  const prefixLength = Number(prefix)

  if (octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return invalid('mnet.overlay_cidr.invalid_octet', 'overlay CIDR octets must be in 0..255')
  }
  if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > 32) {
    return invalid('mnet.overlay_cidr.invalid_prefix', 'overlay CIDR prefix must be in 0..32')
  }

  return { octets, prefixLength }
}

function ipv4ToNumber(parts: readonly [number, number, number, number]): number {
  return ((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]
}

function numberToIpv4(value: number): string {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.')
}

function parseIpv4Address(value: string): number | null {
  const parts = parseParts(`${value}/32`)
  if ('ok' in parts) return null
  return ipv4ToNumber(parts.octets) >>> 0
}

function subnetRange(cidr: string): { readonly start: number; readonly end: number } | null {
  const parsed = parseOverlayCidr(cidr)
  if (!parsed.ok) return null
  const start = parseIpv4Address(parsed.value.networkAddress)
  const end = parseIpv4Address(parsed.value.broadcastAddress)
  if (start === null || end === null) return null
  return { start, end }
}

function rangesOverlap(
  left: { readonly start: number; readonly end: number },
  right: { readonly start: number; readonly end: number }
): boolean {
  return left.start <= right.end && right.start <= left.end
}

function addressFailure(networkId: string, cidr: string): AddressAllocationResult<never> {
  return { ok: false, error: { kind: 'address.exhausted', networkId, cidr } }
}

function allocationFor(
  networkId: string,
  prefixLength: number,
  networkAddress: number,
  addressCount: number
): NetworkSubnetAllocation {
  const broadcastAddress = networkAddress + addressCount - 1
  return {
    networkId,
    cidr: `${numberToIpv4(networkAddress)}/${prefixLength}`,
    networkAddress: numberToIpv4(networkAddress),
    broadcastAddress: numberToIpv4(broadcastAddress),
    prefixLength,
    addressCount
  }
}

/**
 * 解析 M-Net 数据面 overlay CIDR，返回网络边界信息供地址分配和 network-map 渲染复用。
 */
export function parseOverlayCidr(input: string): OverlayCidrParseResult {
  const parts = parseParts(input.trim())
  if ('ok' in parts) return parts

  const { octets, prefixLength } = parts
  const address = ipv4ToNumber(octets)
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0
  const networkAddress = (address & mask) >>> 0
  const broadcastAddress = (networkAddress | (~mask >>> 0)) >>> 0
  if (address !== networkAddress) {
    return invalid(
      'mnet.overlay_cidr.host_bits_set',
      'overlay CIDR must use the network address, not a host address'
    )
  }

  return {
    ok: true,
    value: {
      cidr: `${numberToIpv4(networkAddress)}/${prefixLength}`,
      baseAddress: numberToIpv4(address),
      prefixLength,
      networkAddress: numberToIpv4(networkAddress),
      broadcastAddress: numberToIpv4(broadcastAddress),
      addressCount: 2 ** (32 - prefixLength)
    }
  }
}

/**
 * 在 overlay 范围内按地址顺序选择第一个空闲子网，保证不同逻辑网络不会得到重叠 CIDR。
 */
export function allocateNetworkSubnet(
  input: AllocateNetworkSubnetInput
): AddressAllocationResult<NetworkSubnetAllocation> {
  const overlay = parseOverlayCidr(input.overlayCidr)
  if (!overlay.ok) return addressFailure(input.networkId, input.overlayCidr)
  if (
    !Number.isInteger(input.subnetPrefixLength) ||
    input.subnetPrefixLength < overlay.value.prefixLength ||
    input.subnetPrefixLength > 32
  ) {
    return addressFailure(input.networkId, overlay.value.cidr)
  }

  const overlayStart = parseIpv4Address(overlay.value.networkAddress)
  if (overlayStart === null) return addressFailure(input.networkId, overlay.value.cidr)

  const subnetAddressCount = 2 ** (32 - input.subnetPrefixLength)
  const subnetCount = overlay.value.addressCount / subnetAddressCount
  if (!Number.isInteger(subnetCount) || subnetCount < 1) {
    return addressFailure(input.networkId, overlay.value.cidr)
  }

  const occupiedRanges = input.existingAllocations
    .map(allocation => subnetRange(allocation.cidr))
    .filter(range => range !== null)

  for (let index = 0; index < subnetCount; index++) {
    const start = overlayStart + index * subnetAddressCount
    const candidate = { start, end: start + subnetAddressCount - 1 }
    if (!occupiedRanges.some(range => rangesOverlap(candidate, range))) {
      return {
        ok: true,
        value: allocationFor(input.networkId, input.subnetPrefixLength, start, subnetAddressCount)
      }
    }
  }

  return addressFailure(input.networkId, overlay.value.cidr)
}

/**
 * 为节点分配子网内第一个可用主机地址；显式请求重复地址时返回可审计冲突结果。
 */
export function assignNodeTunnelIp(
  input: AssignNodeTunnelIpInput
): AddressAllocationResult<TunnelIpAssignment> {
  const subnet = parseOverlayCidr(input.subnetCidr)
  if (!subnet.ok) return addressFailure(input.networkId, input.subnetCidr)

  const networkAddress = parseIpv4Address(subnet.value.networkAddress)
  const broadcastAddress = parseIpv4Address(subnet.value.broadcastAddress)
  if (networkAddress === null || broadcastAddress === null) {
    return addressFailure(input.networkId, input.subnetCidr)
  }

  const assignedIps = new Set(
    input.existingAssignments
      .filter(assignment => assignment.networkId === input.networkId)
      .map(assignment => assignment.tunnelIp)
  )

  if (input.requestedIp !== undefined) {
    const requestedAddress = parseIpv4Address(input.requestedIp)
    const outsideSubnet =
      requestedAddress === null ||
      requestedAddress <= networkAddress ||
      requestedAddress >= broadcastAddress
    if (outsideSubnet || assignedIps.has(input.requestedIp)) {
      return {
        ok: false,
        error: {
          kind: 'address.conflict',
          networkId: input.networkId,
          nodeId: input.nodeId,
          conflictingIp: input.requestedIp
        }
      }
    }
    return {
      ok: true,
      value: {
        networkId: input.networkId,
        nodeId: input.nodeId,
        tunnelIp: input.requestedIp,
        cidr: subnet.value.cidr
      }
    }
  }

  // Tunnel IP 不使用网络地址和广播地址，避免与常见 IPv4 工具链语义冲突。
  for (let candidate = networkAddress + 1; candidate < broadcastAddress; candidate++) {
    const tunnelIp = numberToIpv4(candidate)
    if (!assignedIps.has(tunnelIp)) {
      return {
        ok: true,
        value: {
          networkId: input.networkId,
          nodeId: input.nodeId,
          tunnelIp,
          cidr: subnet.value.cidr
        }
      }
    }
  }

  return addressFailure(input.networkId, subnet.value.cidr)
}
