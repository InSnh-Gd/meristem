import { generateKeyPairSync, randomUUID } from 'node:crypto'

type ExportedJwk = {
  readonly x?: string
  readonly d?: string
}

export type LocalWireGuardKeyMaterial = {
  readonly keyId: string
  readonly privateKey: string
  readonly publicKey: string
  readonly createdAt: string
}

export function generateLocalWireGuardKeyMaterial(): LocalWireGuardKeyMaterial {
  const { privateKey, publicKey } = generateKeyPairSync('x25519')
  const privateJwk = privateKey.export({ format: 'jwk' }) as ExportedJwk
  const publicJwk = publicKey.export({ format: 'jwk' }) as ExportedJwk
  return {
    keyId: `wg-${randomUUID()}`,
    privateKey: base64UrlToBase64(assertJwkString(privateJwk.d, 'private d')),
    publicKey: base64UrlToBase64(assertJwkString(publicJwk.x, 'public x')),
    createdAt: new Date().toISOString()
  }
}

function base64UrlToBase64(value: string): string {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  return Buffer.from(padded, 'base64').toString('base64')
}

function assertJwkString(value: string | undefined, field: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`wireguard key export missing ${field}`)
  }
  return value
}
