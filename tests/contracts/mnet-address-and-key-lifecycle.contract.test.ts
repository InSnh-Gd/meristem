import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_MNET_OVERLAY_CIDR,
  parseOverlayCidr
} from '../../services/m-net/src/overlay-cidr.ts'

type PureModule = Readonly<Record<string, unknown>>
type PureExport = (...args: unknown[]) => unknown

type Result<TValue, TError> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: TError }

type AllocatedSubnet = {
  readonly networkId: string
  readonly cidr: string
  readonly networkAddress: string
  readonly broadcastAddress: string
  readonly prefixLength: number
  readonly addressCount: number
}

type TunnelAssignment = {
  readonly networkId: string
  readonly nodeId: string
  readonly tunnelIp: string
  readonly cidr: string
}

type AddressConflictError = {
  readonly kind: 'address.conflict'
  readonly networkId: string
  readonly nodeId: string
  readonly conflictingIp: string
}

type AddressExhaustedError = {
  readonly kind: 'address.exhausted'
  readonly networkId: string
  readonly cidr: string
}

type KeyMetadata = {
  readonly nodeId: string
  readonly keyId: string
  readonly publicKey: string
  readonly fingerprint: string
  readonly algorithm: 'wireguard-x25519'
  readonly createdAt: string
  readonly rotatedAt?: string
  readonly rotationCounter: number
}

type KeyInvalidError = {
  readonly kind: 'key.invalid'
  readonly reason: string
}

type KeyDuplicateError = {
  readonly kind: 'key.duplicate'
  readonly nodeId: string
  readonly fingerprint: string
  readonly auditMetadata: {
    readonly action: 'mnet.node_key.duplicate_rejected'
    readonly nodeId: string
    readonly existingNodeId: string
    readonly fingerprint: string
  }
}

type RotationDecision = {
  readonly status: 'current' | 'rotation_due'
  readonly keyId: string
  readonly fingerprint: string
  readonly dueAt: string
}

type RotationPlan = {
  readonly action: 'rotate_node_key'
  readonly nodeId: string
  readonly keyId: string
  readonly fingerprint: string
  readonly plannedRotatedAt: string
}

type ClockSkewError = {
  readonly kind: 'clock.skew_exceeded'
  readonly skewMs: number
  readonly maxSkewMs: number
  readonly logEvidence: {
    readonly event: 'mnet.clock_skew.rejected'
    readonly operation: 'join' | 'key_registration'
  }
  readonly auditEvidence: {
    readonly action: 'mnet.clock_skew.rejected'
    readonly result: 'rejected'
  }
}

const validPublicKeyA = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
const validPublicKeyB = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB='
const validPublicKeyC = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC='
const now = '2026-06-18T00:00:00.000Z'

async function loadModule(path: string): Promise<PureModule> {
  try {
    const module = await import(path)
    return Object.fromEntries(Object.entries(module))
  } catch {
    return {}
  }
}

function isPureExport(value: unknown): value is PureExport {
  return typeof value === 'function'
}

function callExport<TValue>(module: PureModule, name: string, ...args: unknown[]): TValue {
  const candidate = module[name]
  if (!isPureExport(candidate)) {
    throw new Error(`${name} pure function is not implemented`)
  }
  return candidate(...args) as TValue
}

describe('M-Net address and key lifecycle contract', () => {
  it('parses the default overlay CIDR into canonical network boundaries', () => {
    const result = parseOverlayCidr(DEFAULT_MNET_OVERLAY_CIDR)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value).toEqual({
      cidr: '100.96.0.0/12',
      baseAddress: '100.96.0.0',
      prefixLength: 12,
      networkAddress: '100.96.0.0',
      broadcastAddress: '100.111.255.255',
      addressCount: 1_048_576
    })
  })

  it('returns typed CIDR parse errors for malformed, out-of-range, and host-address input', () => {
    expectInvalidOverlayCidr('not-cidr', 'mnet.overlay_cidr.invalid_format')
    expectInvalidOverlayCidr('300.96.0.0/12', 'mnet.overlay_cidr.invalid_octet')
    expectInvalidOverlayCidr('100.96.0.0/33', 'mnet.overlay_cidr.invalid_prefix')
    expectInvalidOverlayCidr('100.96.0.1/12', 'mnet.overlay_cidr.host_bits_set')
  })

  it('allocates non-overlapping per-network subnets inside the overlay CIDR', async () => {
    const addressModule = await loadModule('../../services/m-net/src/overlay-cidr.ts')
    const first = callExport<Result<AllocatedSubnet, AddressExhaustedError>>(
      addressModule,
      'allocateNetworkSubnet',
      {
        overlayCidr: DEFAULT_MNET_OVERLAY_CIDR,
        networkId: 'network-a',
        subnetPrefixLength: 24,
        existingAllocations: []
      }
    )
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.error.kind)

    const second = callExport<Result<AllocatedSubnet, AddressExhaustedError>>(
      addressModule,
      'allocateNetworkSubnet',
      {
        overlayCidr: DEFAULT_MNET_OVERLAY_CIDR,
        networkId: 'network-b',
        subnetPrefixLength: 24,
        existingAllocations: [first.value]
      }
    )

    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error(second.error.kind)
    expect(first.value.cidr).toBe('100.96.0.0/24')
    expect(second.value.cidr).toBe('100.96.1.0/24')
    expect(second.value.networkAddress).not.toBe(first.value.networkAddress)
  })

  it('assigns unique tunnel IPs inside one network subnet', async () => {
    const addressModule = await loadModule('../../services/m-net/src/overlay-cidr.ts')
    const first = assignTunnelIp(addressModule, {
      networkId: 'network-a',
      nodeId: 'node-a',
      subnetCidr: '100.96.0.0/24',
      existingAssignments: []
    })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.error.kind)

    const second = assignTunnelIp(addressModule, {
      networkId: 'network-a',
      nodeId: 'node-b',
      subnetCidr: '100.96.0.0/24',
      existingAssignments: [first.value]
    })

    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error(second.error.kind)
    expect(first.value.tunnelIp).toBe('100.96.0.1')
    expect(second.value.tunnelIp).toBe('100.96.0.2')
  })

  it('rejects an explicitly reused tunnel IP with a typed conflict failure', async () => {
    const addressModule = await loadModule('../../services/m-net/src/overlay-cidr.ts')
    const existing: TunnelAssignment = {
      networkId: 'network-a',
      nodeId: 'node-a',
      tunnelIp: '100.96.0.1',
      cidr: '100.96.0.0/24'
    }

    const result = assignTunnelIp(addressModule, {
      networkId: 'network-a',
      nodeId: 'node-b',
      subnetCidr: '100.96.0.0/24',
      requestedIp: existing.tunnelIp,
      existingAssignments: [existing]
    })

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'address.conflict',
        networkId: 'network-a',
        nodeId: 'node-b',
        conflictingIp: '100.96.0.1'
      }
    })
  })

  it('returns an operator-visible exhausted failure when no tunnel IP remains', async () => {
    const addressModule = await loadModule('../../services/m-net/src/overlay-cidr.ts')
    const first: TunnelAssignment = {
      networkId: 'network-small',
      nodeId: 'node-a',
      tunnelIp: '100.96.7.1',
      cidr: '100.96.7.0/30'
    }
    const second: TunnelAssignment = {
      networkId: 'network-small',
      nodeId: 'node-b',
      tunnelIp: '100.96.7.2',
      cidr: '100.96.7.0/30'
    }

    const result = assignTunnelIp(addressModule, {
      networkId: 'network-small',
      nodeId: 'node-c',
      subnetCidr: '100.96.7.0/30',
      existingAssignments: [first, second]
    })

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'address.exhausted',
        networkId: 'network-small',
        cidr: '100.96.7.0/30'
      }
    })
  })

  it('validates WireGuard public key metadata and rejects malformed base64 text', async () => {
    const keyModule = await loadModule('../../services/m-net/src/key-lifecycle.ts')
    const valid = validateKeyMetadata(keyModule, {
      nodeId: 'node-a',
      keyId: 'key-a',
      publicKey: validPublicKeyA,
      createdAt: now
    })
    expect(valid.ok).toBe(true)
    if (!valid.ok) throw new Error(valid.error.reason)
    expect(valid.value.algorithm).toBe('wireguard-x25519')
    expect(valid.value.fingerprint).toStartWith('wg:')

    const invalid = validateKeyMetadata(keyModule, {
      nodeId: 'node-b',
      keyId: 'key-b',
      publicKey: 'not-valid-base64',
      createdAt: now
    })
    expect(invalid).toEqual({
      ok: false,
      error: { kind: 'key.invalid', reason: 'public key must be 32-byte base64 text' }
    })
  })

  it('rejects duplicate public keys with audit metadata', async () => {
    const keyModule = await loadModule('../../services/m-net/src/key-lifecycle.ts')
    const existing = expectValidKey(
      validateKeyMetadata(keyModule, {
        nodeId: 'node-a',
        keyId: 'key-a',
        publicKey: validPublicKeyA,
        createdAt: now
      })
    )

    const result = callExport<Result<KeyMetadata, KeyDuplicateError | KeyInvalidError>>(
      keyModule,
      'rejectDuplicatePublicKey',
      {
        nodeId: 'node-b',
        keyId: 'key-b',
        publicKey: validPublicKeyA,
        createdAt: now,
        existingKeys: [existing]
      }
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected duplicate key rejection')
    expect(result.error.kind).toBe('key.duplicate')
    if (result.error.kind !== 'key.duplicate') throw new Error(result.error.kind)
    expect(result.error.nodeId).toBe('node-b')
    expect(result.error.fingerprint).toBe(existing.fingerprint)
    expect(result.error.auditMetadata).toEqual({
      action: 'mnet.node_key.duplicate_rejected',
      nodeId: 'node-b',
      existingNodeId: 'node-a',
      fingerprint: existing.fingerprint
    })
  })

  it('marks keys older than the default 30-day window as rotation_due', async () => {
    const keyModule = await loadModule('../../services/m-net/src/key-lifecycle.ts')
    const metadata = expectValidKey(
      validateKeyMetadata(keyModule, {
        nodeId: 'node-a',
        keyId: 'key-a',
        publicKey: validPublicKeyB,
        createdAt: '2026-05-18T23:59:59.999Z'
      })
    )

    const decision = callExport<RotationDecision>(keyModule, 'evaluateKeyRotationPolicy', {
      metadata,
      now: '2026-06-18T00:00:00.000Z'
    })

    expect(decision.status).toBe('rotation_due')
    expect(decision.keyId).toBe('key-a')
    expect(decision.fingerprint).toBe(metadata.fingerprint)
  })

  it('plans a forced key rotation command with key metadata only', async () => {
    const keyModule = await loadModule('../../services/m-net/src/key-lifecycle.ts')
    const metadata = expectValidKey(
      validateKeyMetadata(keyModule, {
        nodeId: 'node-c',
        keyId: 'key-c',
        publicKey: validPublicKeyC,
        createdAt: now
      })
    )

    const plan = callExport<RotationPlan>(keyModule, 'planForcedKeyRotation', {
      metadata,
      plannedRotatedAt: '2026-06-18T01:00:00.000Z'
    })

    expect(plan).toEqual({
      action: 'rotate_node_key',
      nodeId: 'node-c',
      keyId: 'key-c',
      fingerprint: metadata.fingerprint,
      plannedRotatedAt: '2026-06-18T01:00:00.000Z'
    })
  })

  it('rejects join and key operations when reported time exceeds five minutes of skew', async () => {
    const keyModule = await loadModule('../../services/m-net/src/key-lifecycle.ts')
    const result = callExport<Result<{ readonly status: 'accepted' }, ClockSkewError>>(
      keyModule,
      'gateClockSkew',
      {
        operation: 'key_registration',
        observedAt: '2026-06-18T00:10:01.000Z',
        reportedAt: '2026-06-18T00:05:00.000Z'
      }
    )

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'clock.skew_exceeded',
        skewMs: 301_000,
        maxSkewMs: 300_000,
        logEvidence: {
          event: 'mnet.clock_skew.rejected',
          operation: 'key_registration'
        },
        auditEvidence: {
          action: 'mnet.clock_skew.rejected',
          result: 'rejected'
        }
      }
    })
  })
})

function expectInvalidOverlayCidr(input: string, code: string): void {
  const result = parseOverlayCidr(input)

  expect(result.ok).toBe(false)
  if (result.ok) throw new Error(`expected ${input} to be invalid`)
  expect(result.error.code).toBe(code)
}

function assignTunnelIp(
  addressModule: PureModule,
  input: {
    readonly networkId: string
    readonly nodeId: string
    readonly subnetCidr: string
    readonly requestedIp?: string
    readonly existingAssignments: readonly TunnelAssignment[]
  }
): Result<TunnelAssignment, AddressConflictError | AddressExhaustedError> {
  return callExport<Result<TunnelAssignment, AddressConflictError | AddressExhaustedError>>(
    addressModule,
    'assignNodeTunnelIp',
    input
  )
}

function validateKeyMetadata(
  keyModule: PureModule,
  input: {
    readonly nodeId: string
    readonly keyId: string
    readonly publicKey: string
    readonly createdAt: string
  }
): Result<KeyMetadata, KeyInvalidError> {
  return callExport<Result<KeyMetadata, KeyInvalidError>>(
    keyModule,
    'validatePublicKeyMetadata',
    input
  )
}

function expectValidKey(result: Result<KeyMetadata, KeyInvalidError>): KeyMetadata {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error.reason)
  return result.value
}
