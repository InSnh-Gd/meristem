import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  DEFAULT_ACME_DIRECTORY,
  DEFAULT_AGENT_VERSION,
  DEFAULT_CONFIG_DIR,
  DEFAULT_JOIN_URL,
  DEFAULT_RELAY_ENDPOINT,
  DEFAULT_WG_BINARY_PATH,
  DEFAULT_WSTUNNEL_BINARY_PATH,
  type FileUpdate,
  type LifecycleConfig,
  type NodeRole
} from './node-agent-lifecycle-definitions.ts'
import { generateLocalWireGuardKeyMaterial } from './node-agent-lifecycle-keys.ts'
import { assertSafeLifecycleFilePath } from './node-agent-lifecycle-paths.ts'

export type RuntimeState = {
  readonly nodeId?: string | undefined
  readonly runtimeToken?: string | undefined
}

export type RuntimeTokenState = {
  readonly value?: string | undefined
  readonly update: FileUpdate
}

export type PersistedEnv = {
  readonly joinUrl: string
  readonly nodeRole: NodeRole
  readonly nodeName: string
  readonly relayEndpoint: string
  readonly wgBinaryPath: string
  readonly wstunnelBinaryPath: string
  readonly acmeDirectory: string
  readonly acmeAccountKeyPath: string
  readonly wireGuardPrivateKeyPath: string
  readonly agentVersion: string
}

export async function ensureParentDirs(lifecycle: LifecycleConfig): Promise<void> {
  await Promise.all([
    mkdir(lifecycle.configDir, { recursive: true, mode: 0o750 }),
    mkdir(dirname(lifecycle.runtimeStatePath), { recursive: true, mode: 0o700 }),
    mkdir(dirname(lifecycle.acmeAccountKeyPath), { recursive: true, mode: 0o750 }),
    mkdir(dirname(lifecycle.wireGuardPrivateKeyPath), { recursive: true, mode: 0o750 })
  ])
}

export async function readFileIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

export async function readRuntimeState(path: string): Promise<RuntimeState> {
  const payload = await readFileIfExists(path)
  if (!payload) return {}
  try {
    // 本地文件 I/O 运行时校验：JSON.parse 返回 unknown，先断言为 Record 再逐字段 typeof 校验。
    // 此处不引入 Effect Schema，因为只读本地 runtime state 文件，手动校验已覆盖所有字段。
    const decoded = JSON.parse(payload) as Record<string, unknown>
    return {
      nodeId:
        typeof decoded.nodeId === 'string' && decoded.nodeId.length > 0
          ? decoded.nodeId
          : undefined,
      runtimeToken:
        typeof decoded.runtimeToken === 'string' && decoded.runtimeToken.length > 0
          ? decoded.runtimeToken
          : undefined
    }
  } catch {
    return {}
  }
}

export async function readPersistedEnv(path: string): Promise<PersistedEnv | null> {
  const payload = await readFileIfExists(path)
  if (!payload) return null
  const values = parseEnvFile(payload)
  const nodeRole = values.MERISTEM_NODE_AGENT_ROLE
  const nodeName = values.MERISTEM_NODE_AGENT_NAME
  if (!nodeRole || !nodeName || (nodeRole !== 'stem' && nodeRole !== 'leaf')) {
    return null
  }
  return {
    joinUrl: values.MERISTEM_JOIN_URL ?? DEFAULT_JOIN_URL,
    nodeRole,
    nodeName,
    relayEndpoint: values.MERISTEM_RELAY_ENDPOINT ?? DEFAULT_RELAY_ENDPOINT,
    wgBinaryPath: values.MERISTEM_WG_BINARY_PATH ?? DEFAULT_WG_BINARY_PATH,
    wstunnelBinaryPath: values.MERISTEM_WSTUNNEL_BINARY_PATH ?? DEFAULT_WSTUNNEL_BINARY_PATH,
    acmeDirectory: values.MERISTEM_ACME_DIRECTORY ?? DEFAULT_ACME_DIRECTORY,
    acmeAccountKeyPath:
      values.MERISTEM_ACME_ACCOUNT_KEY ?? join(DEFAULT_CONFIG_DIR, 'tls/account.key'),
    wireGuardPrivateKeyPath:
      values.MERISTEM_HOST_PRIVATE_KEY_PATH ?? join(DEFAULT_CONFIG_DIR, 'wg/private.key'),
    agentVersion: values.MERISTEM_AGENT_VERSION ?? DEFAULT_AGENT_VERSION
  }
}

export function parseEnvFile(text: string): Record<string, string> {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
    .reduce<Record<string, string>>((acc, line) => {
      const separator = line.indexOf('=')
      if (separator <= 0) return acc
      acc[line.slice(0, separator)] = line.slice(separator + 1)
      return acc
    }, {})
}

export function renderEnvFile(
  lifecycle: LifecycleConfig,
  input: {
    readonly kind: NodeRole
    readonly name: string
    readonly joinUrl: string
    readonly relayEndpoint: string
    readonly wgBinaryPath: string
    readonly wstunnelBinaryPath: string
    readonly acmeDirectory: string
  }
): string {
  return renderPersistedEnvFile({
    joinUrl: input.joinUrl,
    nodeRole: input.kind,
    nodeName: input.name,
    relayEndpoint: input.relayEndpoint,
    wgBinaryPath: input.wgBinaryPath,
    wstunnelBinaryPath: input.wstunnelBinaryPath,
    acmeDirectory: input.acmeDirectory,
    acmeAccountKeyPath: lifecycle.acmeAccountKeyPath,
    wireGuardPrivateKeyPath: lifecycle.wireGuardPrivateKeyPath,
    agentVersion: DEFAULT_AGENT_VERSION
  })
}

export function renderPersistedEnvFile(env: PersistedEnv): string {
  return [
    `MERISTEM_JOIN_URL=${env.joinUrl}`,
    `MERISTEM_AGENT_VERSION=${env.agentVersion}`,
    `MERISTEM_WG_BINARY_PATH=${env.wgBinaryPath}`,
    `MERISTEM_WSTUNNEL_BINARY_PATH=${env.wstunnelBinaryPath}`,
    `MERISTEM_ACME_DIRECTORY=${env.acmeDirectory}`,
    `MERISTEM_ACME_ACCOUNT_KEY=${env.acmeAccountKeyPath}`,
    `MERISTEM_HOST_PRIVATE_KEY_PATH=${env.wireGuardPrivateKeyPath}`,
    `MERISTEM_RELAY_ENDPOINT=${env.relayEndpoint}`,
    'MERISTEM_LOG_LEVEL=info',
    `MERISTEM_NODE_AGENT_ROLE=${env.nodeRole}`,
    `MERISTEM_NODE_AGENT_NAME=${env.nodeName}`,
    ''
  ].join('\n')
}

export async function writeTextFile(
  path: string,
  content: string,
  options: { readonly mode: number }
): Promise<FileUpdate> {
  await assertSafeLifecycleFilePath(path)
  const existing = await readFileIfExists(path)
  const action: FileUpdate['action'] = existing === null ? 'created' : 'updated'
  await mkdir(dirname(path), { recursive: true, mode: 0o750 })
  await writeFile(path, content, options)
  return { path, action }
}

export async function writeOptionalSecretFile(
  path: string,
  value: string | undefined
): Promise<FileUpdate> {
  return writeTextFile(path, `${value ?? ''}\n`, { mode: 0o600 })
}

export async function stageOperatorManagedSecretFile(
  path: string,
  rotate: boolean
): Promise<{ readonly value: string; readonly update: FileUpdate }> {
  const existing = await readFileIfExists(path)
  if (existing !== null && !rotate) {
    return { value: existing.trim(), update: { path, action: 'kept' } }
  }
  return { value: '', update: await writeTextFile(path, '\n', { mode: 0o600 }) }
}

export async function stageRuntimeTokenFile(
  path: string,
  existingValue: string | undefined
): Promise<RuntimeTokenState> {
  return {
    value: existingValue,
    update: await writeTextFile(path, `${existingValue ?? ''}\n`, { mode: 0o600 })
  }
}

export async function clearRuntimeTokenMaterial(
  lifecycle: LifecycleConfig
): Promise<RuntimeTokenState> {
  await removeFileIfExists(lifecycle.runtimeStatePath)
  return {
    value: undefined,
    update: await writeTextFile(lifecycle.runtimeTokenPath, '\n', { mode: 0o600 })
  }
}

export async function ensureWireGuardMaterial(
  lifecycle: LifecycleConfig,
  rotate: boolean
): Promise<{ readonly privateKey: string; readonly updates: FileUpdate[] }> {
  const [privateKey, publicKey, metadata] = await Promise.all([
    readFileIfExists(lifecycle.wireGuardPrivateKeyPath),
    readFileIfExists(lifecycle.wireGuardPublicKeyPath),
    readFileIfExists(lifecycle.wireGuardMetadataPath)
  ])

  if (privateKey && publicKey && metadata && !rotate) {
    return {
      privateKey: privateKey.trim(),
      updates: [
        { path: lifecycle.wireGuardPrivateKeyPath, action: 'kept' },
        { path: lifecycle.wireGuardPublicKeyPath, action: 'kept' },
        { path: lifecycle.wireGuardMetadataPath, action: 'kept' }
      ]
    }
  }

  const generated = generateLocalWireGuardKeyMaterial()
  const metadataPayload = `${JSON.stringify(
    { keyId: generated.keyId, createdAt: generated.createdAt },
    null,
    2
  )}\n`

  return {
    privateKey: generated.privateKey,
    updates: [
      await writeTextFile(lifecycle.wireGuardPrivateKeyPath, `${generated.privateKey}\n`, {
        mode: 0o600
      }),
      await writeTextFile(lifecycle.wireGuardPublicKeyPath, `${generated.publicKey}\n`, {
        mode: 0o644
      }),
      await writeTextFile(lifecycle.wireGuardMetadataPath, metadataPayload, { mode: 0o600 })
    ]
  }
}

export async function removeFileIfExists(path: string): Promise<FileUpdate> {
  await assertSafeLifecycleFilePath(path)
  try {
    await rm(path)
    return { path, action: 'removed' }
  } catch {
    return { path, action: 'kept' }
  }
}

export async function buildValidationSummary(lifecycle: LifecycleConfig) {
  const [envFile, joinTicketFile, nodeIdFile, runtimeTokenFile, wgPrivateKeyFile, acmeKeyFile] =
    await Promise.all([
      readFileIfExists(lifecycle.envFilePath),
      readFileIfExists(lifecycle.joinTicketPath),
      readFileIfExists(lifecycle.nodeIdPath),
      readFileIfExists(lifecycle.runtimeTokenPath),
      readFileIfExists(lifecycle.wireGuardPrivateKeyPath),
      readFileIfExists(lifecycle.acmeAccountKeyPath)
    ])

  return {
    serviceName: lifecycle.serviceName,
    serviceUnitPath: lifecycle.serviceUnitPath,
    configDir: lifecycle.configDir,
    filesPresent: {
      envFile: envFile !== null,
      joinTicketFile: joinTicketFile !== null,
      nodeIdFile: nodeIdFile !== null,
      runtimeTokenFile: runtimeTokenFile !== null,
      wireGuardPrivateKeyFile: wgPrivateKeyFile !== null,
      acmeAccountKeyFile: acmeKeyFile !== null
    }
  }
}

export function summarizePresence(value: string): string {
  return value.length > 0 ? 'present' : 'missing'
}

export function summarizeOptionalSecret(value: string | undefined): string {
  return value && value.length > 0 ? 'present' : 'staged-empty'
}
