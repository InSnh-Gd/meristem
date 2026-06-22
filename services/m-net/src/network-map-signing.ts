import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import type { NetworkMapFromSchema as NetworkMap } from '../../../packages/contracts/src/schemas/mnet-profile.ts'

export const NETWORK_MAP_SIGNING_KEY_ID_ENV_KEY = 'MERISTEM_MNET_MAP_SIGNING_KEY_ID'
export const NETWORK_MAP_SIGNING_PRIVATE_KEY_ENV_KEY = 'MERISTEM_MNET_MAP_SIGNING_PRIVATE_KEY_PEM'
export const NETWORK_MAP_SIGNING_PUBLIC_KEY_ENV_KEY = 'MERISTEM_MNET_MAP_SIGNING_PUBLIC_KEY'

export const DEFAULT_NETWORK_MAP_SIGNING_KEY_ID = 'mnet-signing-key-v1'

const TEST_NETWORK_MAP_SIGNING_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEINIE+26drFFp0l3biujeSbNTQ2u84uS1XBquEbem5Gfz
-----END PRIVATE KEY-----`

type NetworkMapSigningEnv = Readonly<Record<string, string | undefined>>
type NetworkMapSigningOptions = {
  readonly allowTestDefaults?: boolean
}

export type NetworkMapSigningKeyMaterial = {
  readonly keyId: string
  readonly privateKeyPem: string
  readonly publicKey?: string
}

type UnsignedNetworkMap = Omit<NetworkMap, 'signatureMetadata'>

function normalizePem(value: string): string {
  return `${value.trim()}\n`
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right)
    )
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function exportPublicKey(privateKeyPem: string): string {
  const publicKey = createPublicKey(normalizePem(privateKeyPem))
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
}

function allowTestDefaults(env: NetworkMapSigningEnv, options?: NetworkMapSigningOptions): boolean {
  if (options?.allowTestDefaults === true) return true
  return env.NODE_ENV === 'test' || env.BUN_ENV === 'test'
}

function resolvePrivateKeyPem(
  env: NetworkMapSigningEnv,
  options?: NetworkMapSigningOptions
): string {
  const configured = env[NETWORK_MAP_SIGNING_PRIVATE_KEY_ENV_KEY]
  if (configured) return normalizePem(configured)
  if (allowTestDefaults(env, options)) return normalizePem(TEST_NETWORK_MAP_SIGNING_PRIVATE_KEY_PEM)
  throw new Error(
    `${NETWORK_MAP_SIGNING_PRIVATE_KEY_ENV_KEY} is required for M-Net network-map signing`
  )
}

function resolvePublicKeyFromEnv(
  env: NetworkMapSigningEnv,
  options?: NetworkMapSigningOptions
): string {
  const configured = env[NETWORK_MAP_SIGNING_PUBLIC_KEY_ENV_KEY]
  if (configured) return configured.trim()
  const privateKeyPem = env[NETWORK_MAP_SIGNING_PRIVATE_KEY_ENV_KEY]
  if (privateKeyPem) return exportPublicKey(privateKeyPem)
  if (allowTestDefaults(env, options))
    return exportPublicKey(TEST_NETWORK_MAP_SIGNING_PRIVATE_KEY_PEM)
  throw new Error(
    `${NETWORK_MAP_SIGNING_PUBLIC_KEY_ENV_KEY} or ${NETWORK_MAP_SIGNING_PRIVATE_KEY_ENV_KEY} is required for node-agent network-map verification`
  )
}

export function resolveNetworkMapSigningKeyMaterial(
  env: NetworkMapSigningEnv,
  options?: NetworkMapSigningOptions
): NetworkMapSigningKeyMaterial {
  const privateKeyPem = resolvePrivateKeyPem(env, options)
  return {
    keyId: env[NETWORK_MAP_SIGNING_KEY_ID_ENV_KEY] ?? DEFAULT_NETWORK_MAP_SIGNING_KEY_ID,
    privateKeyPem,
    publicKey: exportPublicKey(privateKeyPem)
  }
}

export function resolveExpectedNetworkMapSigningPublicKey(
  env: NetworkMapSigningEnv,
  options?: NetworkMapSigningOptions
): string {
  return resolvePublicKeyFromEnv(env, options)
}

function toSigningPayload(map: UnsignedNetworkMap): Buffer {
  return Buffer.from(stableStringify(map), 'utf8')
}

export function buildNetworkMapSignatureMetadata(
  map: UnsignedNetworkMap,
  keyMaterial: NetworkMapSigningKeyMaterial
): NetworkMap['signatureMetadata'] {
  const signature = sign(null, toSigningPayload(map), createPrivateKey(keyMaterial.privateKeyPem))
  const publicKey = keyMaterial.publicKey ?? exportPublicKey(keyMaterial.privateKeyPem)
  return {
    algorithm: 'ed25519',
    keyId: keyMaterial.keyId,
    publicKey,
    value: signature.toString('base64')
  }
}

export function verifyNetworkMapSignature(
  map: NetworkMap,
  expectedKeyId: string,
  expectedPublicKey: string
): boolean {
  if (map.signatureMetadata.algorithm !== 'ed25519') return false
  if (map.signatureMetadata.keyId !== expectedKeyId) return false
  if (map.signatureMetadata.publicKey !== expectedPublicKey) return false
  if (map.signatureMetadata.value.length === 0) return false

  const unsignedMap: UnsignedNetworkMap = {
    profileVersion: map.profileVersion,
    networkId: map.networkId,
    members: map.members,
    aclRules: map.aclRules,
    ...(map.relayAssignment ? { relayAssignment: map.relayAssignment } : {}),
    expiresAt: map.expiresAt,
    mapVersion: map.mapVersion
  }

  return verify(
    null,
    toSigningPayload(unsignedMap),
    createPublicKey({ key: Buffer.from(expectedPublicKey, 'base64'), type: 'spki', format: 'der' }),
    Buffer.from(map.signatureMetadata.value, 'base64')
  )
}
