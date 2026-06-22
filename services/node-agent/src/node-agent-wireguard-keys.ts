import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type WireGuardKeyMaterial = {
  keyId: string
  publicKey: string
  privateKey: string
  createdAt: string
}

type ExportedJwk = {
  x?: string
  d?: string
}

type PersistedKeyMetadata = {
  keyId?: string
  createdAt?: string
}

const DEFAULT_HOST_PRIVATE_KEY_PATH =
  process.env.MERISTEM_HOST_PRIVATE_KEY_PATH ?? '/etc/meristem/node-agent/wg/private.key'

function derivePublicKeyPath(privateKeyPath: string): string {
  return `${privateKeyPath}.pub`
}

function deriveMetadataPath(privateKeyPath: string): string {
  return `${privateKeyPath}.meta.json`
}

function base64UrlToBase64(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  return Buffer.from(padded, 'base64').toString('base64')
}

function assertJwkString(value: string | undefined, field: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`wireguard key export missing ${field}`)
  }

  return value
}

export function generateWireGuardKeyMaterial(now: Date = new Date()): WireGuardKeyMaterial {
  const { privateKey, publicKey } = generateKeyPairSync('x25519')
  const privateJwk = privateKey.export({ format: 'jwk' }) as ExportedJwk
  const publicJwk = publicKey.export({ format: 'jwk' }) as ExportedJwk

  return {
    keyId: `wg-${randomUUID()}`,
    publicKey: base64UrlToBase64(assertJwkString(publicJwk.x, 'public x')),
    privateKey: base64UrlToBase64(assertJwkString(privateJwk.d, 'private d')),
    createdAt: now.toISOString()
  }
}

export async function loadOrCreateWireGuardKeyMaterial(
  privateKeyPath: string = DEFAULT_HOST_PRIVATE_KEY_PATH,
  now: Date = new Date()
): Promise<WireGuardKeyMaterial> {
  const publicKeyPath = derivePublicKeyPath(privateKeyPath)
  const metadataPath = deriveMetadataPath(privateKeyPath)

  try {
    const [privateKey, publicKey, metadataPayload] = await Promise.all([
      readFile(privateKeyPath, 'utf8'),
      readFile(publicKeyPath, 'utf8'),
      readFile(metadataPath, 'utf8').catch(() => '')
    ])

    const metadata =
      metadataPayload.trim().length === 0
        ? {}
        : (JSON.parse(metadataPayload) as PersistedKeyMetadata)

    return {
      keyId: metadata.keyId ?? `wg-${randomUUID()}`,
      publicKey: publicKey.trim(),
      privateKey: privateKey.trim(),
      createdAt: metadata.createdAt ?? now.toISOString()
    }
  } catch {
    const generated = generateWireGuardKeyMaterial(now)
    await mkdir(dirname(privateKeyPath), { recursive: true })
    await Promise.all([
      writeFile(privateKeyPath, `${generated.privateKey}\n`, { mode: 0o600 }),
      writeFile(publicKeyPath, `${generated.publicKey}\n`, { mode: 0o644 }),
      writeFile(
        metadataPath,
        `${JSON.stringify({ keyId: generated.keyId, createdAt: generated.createdAt }, null, 2)}\n`,
        { mode: 0o600 }
      )
    ])
    return generated
  }
}
