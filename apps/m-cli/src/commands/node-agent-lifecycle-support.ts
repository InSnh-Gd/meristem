import { randomUUID } from 'node:crypto'
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
  type InstallInput,
  type LifecycleConfig,
  type NodeRole,
  type UpgradeInput
} from './node-agent-lifecycle-definitions.ts'
import { generateLocalWireGuardKeyMaterial } from './node-agent-lifecycle-keys.ts'
import {
  assertSafeLifecycleFilePath,
  assertSafeLifecyclePaths
} from './node-agent-lifecycle-paths.ts'

type RuntimeState = {
  readonly nodeId?: string | undefined
  readonly runtimeToken?: string | undefined
}

type RuntimeTokenState = {
  readonly value?: string | undefined
  readonly update: FileUpdate
}

type PersistedEnv = {
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

/**
 * 本地 install 只写入 NixOS/systemd 已声明的宿主机边界文件，不生成新的生命周期框架。
 */
export async function installNodeAgent(lifecycle: LifecycleConfig, input: InstallInput) {
  await assertSafeLifecyclePaths(lifecycle)
  await ensureParentDirs(lifecycle)

  const fileUpdates: FileUpdate[] = []
  const runtimeState = await readRuntimeState(lifecycle.runtimeStatePath)
  const runtimeTokenState = await stageRuntimeTokenFile(
    lifecycle.runtimeTokenPath,
    runtimeState.runtimeToken
  )

  const wireGuardMaterial = await ensureWireGuardMaterial(lifecycle, input.rotateWireGuardKey)
  fileUpdates.push(...wireGuardMaterial.updates)

  const acmeAccountKey = await stageOperatorManagedSecretFile(
    lifecycle.acmeAccountKeyPath,
    input.rotateAcmeAccountKey
  )
  fileUpdates.push(acmeAccountKey.update)

  fileUpdates.push(
    await writeTextFile(lifecycle.envFilePath, renderEnvFile(lifecycle, input), { mode: 0o640 }),
    await writeOptionalSecretFile(lifecycle.joinTicketPath, input.joinTicket),
    await writeTextFile(lifecycle.nodeIdPath, `${runtimeState.nodeId ?? ''}\n`, { mode: 0o640 }),
    runtimeTokenState.update
  )

  // ponytail: install 只验证现有 systemd 单元契约，不尝试替换或生成远程/宿主机管理逻辑。
  const validation = await buildValidationSummary(lifecycle)

  return {
    action: 'install',
    serviceName: lifecycle.serviceName,
    serviceUnitPath: lifecycle.serviceUnitPath,
    configDir: lifecycle.configDir,
    runtimeStatePath: lifecycle.runtimeStatePath,
    preservedNodeIdentity: runtimeState.nodeId ?? null,
    runtimeSecretMaterial: {
      runtimeToken: summarizeOptionalSecret(runtimeTokenState.value),
      wireGuardPrivateKey: summarizePresence(wireGuardMaterial.privateKey),
      acmeAccountKey: summarizePresence(acmeAccountKey.value)
    },
    validation,
    fileUpdates
  }
}

/**
 * upgrade 默认保留节点标识与运行时秘密，只有显式 rotate 标记才替换对应材料。
 */
export async function upgradeNodeAgent(lifecycle: LifecycleConfig, input: UpgradeInput) {
  await assertSafeLifecyclePaths(lifecycle)
  const existingEnv = await readPersistedEnv(lifecycle.envFilePath)
  if (!existingEnv) {
    throw new Error('node-agent upgrade requires an existing install at node-agent.env')
  }

  const runtimeState = await readRuntimeState(lifecycle.runtimeStatePath)
  const mergedEnv: PersistedEnv = {
    ...existingEnv,
    joinUrl: input.joinUrl ?? existingEnv.joinUrl,
    relayEndpoint: input.relayEndpoint ?? existingEnv.relayEndpoint,
    wgBinaryPath: input.wgBinaryPath ?? existingEnv.wgBinaryPath,
    wstunnelBinaryPath: input.wstunnelBinaryPath ?? existingEnv.wstunnelBinaryPath,
    acmeDirectory: input.acmeDirectory ?? existingEnv.acmeDirectory
  }

  const runtimeTokenState = input.rotateRuntimeToken
    ? await clearRuntimeTokenMaterial(lifecycle)
    : await stageRuntimeTokenFile(lifecycle.runtimeTokenPath, runtimeState.runtimeToken)

  const fileUpdates: FileUpdate[] = []
  const wireGuardMaterial = await ensureWireGuardMaterial(lifecycle, input.rotateWireGuardKey)
  fileUpdates.push(...wireGuardMaterial.updates)

  const acmeAccountKey = await stageOperatorManagedSecretFile(
    lifecycle.acmeAccountKeyPath,
    input.rotateAcmeAccountKey
  )
  fileUpdates.push(acmeAccountKey.update)

  fileUpdates.push(
    await writeTextFile(lifecycle.envFilePath, renderPersistedEnvFile(mergedEnv), { mode: 0o640 }),
    await writeOptionalSecretFile(lifecycle.joinTicketPath, input.joinTicket),
    await writeTextFile(lifecycle.nodeIdPath, `${runtimeState.nodeId ?? ''}\n`, { mode: 0o640 }),
    runtimeTokenState.update
  )

  const validation = await buildValidationSummary(lifecycle)

  return {
    action: 'upgrade',
    serviceName: lifecycle.serviceName,
    serviceUnitPath: lifecycle.serviceUnitPath,
    configDir: lifecycle.configDir,
    runtimeStatePath: lifecycle.runtimeStatePath,
    preservedNodeIdentity: runtimeState.nodeId ?? null,
    runtimeSecretMaterial: {
      runtimeToken: summarizeOptionalSecret(runtimeTokenState.value),
      wireGuardPrivateKey: summarizePresence(wireGuardMaterial.privateKey),
      acmeAccountKey: summarizePresence(acmeAccountKey.value)
    },
    rotated: {
      runtimeToken: input.rotateRuntimeToken,
      wireGuardKey: input.rotateWireGuardKey,
      acmeAccountKey: input.rotateAcmeAccountKey
    },
    validation,
    fileUpdates
  }
}

/**
 * uninstall 默认仅移除服务配置与运行时指针，秘密材料需要显式 purge 才删除。
 */
export async function uninstallNodeAgent(
  lifecycle: LifecycleConfig,
  input: { readonly purgeSecrets: boolean }
) {
  await assertSafeLifecyclePaths(lifecycle)
  const fileUpdates: FileUpdate[] = []

  fileUpdates.push(
    await removeFileIfExists(lifecycle.envFilePath),
    await removeFileIfExists(lifecycle.joinTicketPath),
    await removeFileIfExists(lifecycle.nodeIdPath),
    await removeFileIfExists(lifecycle.runtimeTokenPath),
    await removeFileIfExists(lifecycle.runtimeStatePath)
  )

  if (input.purgeSecrets) {
    fileUpdates.push(
      await removeFileIfExists(lifecycle.wireGuardPrivateKeyPath),
      await removeFileIfExists(lifecycle.wireGuardPublicKeyPath),
      await removeFileIfExists(lifecycle.wireGuardMetadataPath),
      await removeFileIfExists(lifecycle.acmeAccountKeyPath)
    )
  } else {
    fileUpdates.push(
      { path: lifecycle.wireGuardPrivateKeyPath, action: 'kept' },
      { path: lifecycle.wireGuardPublicKeyPath, action: 'kept' },
      { path: lifecycle.wireGuardMetadataPath, action: 'kept' },
      { path: lifecycle.acmeAccountKeyPath, action: 'kept' }
    )
  }

  return {
    action: 'uninstall',
    serviceName: lifecycle.serviceName,
    serviceUnitPath: lifecycle.serviceUnitPath,
    configDir: lifecycle.configDir,
    runtimeStatePath: lifecycle.runtimeStatePath,
    purgedSecrets: input.purgeSecrets,
    fileUpdates
  }
}

async function ensureParentDirs(lifecycle: LifecycleConfig): Promise<void> {
  await Promise.all([
    mkdir(lifecycle.configDir, { recursive: true, mode: 0o750 }),
    mkdir(dirname(lifecycle.runtimeStatePath), { recursive: true, mode: 0o700 }),
    mkdir(dirname(lifecycle.acmeAccountKeyPath), { recursive: true, mode: 0o750 }),
    mkdir(dirname(lifecycle.wireGuardPrivateKeyPath), { recursive: true, mode: 0o750 })
  ])
}

async function readFileIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function readRuntimeState(path: string): Promise<RuntimeState> {
  const payload = await readFileIfExists(path)
  if (!payload) return {}
  try {
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

async function readPersistedEnv(path: string): Promise<PersistedEnv | null> {
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

function parseEnvFile(text: string): Record<string, string> {
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

function renderEnvFile(lifecycle: LifecycleConfig, input: InstallInput): string {
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

function renderPersistedEnvFile(env: PersistedEnv): string {
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

async function writeTextFile(
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

async function writeOptionalSecretFile(
  path: string,
  value: string | undefined
): Promise<FileUpdate> {
  return writeTextFile(path, `${value ?? ''}\n`, { mode: 0o600 })
}

async function stageOperatorManagedSecretFile(
  path: string,
  rotate: boolean
): Promise<{ readonly value: string; readonly update: FileUpdate }> {
  const existing = await readFileIfExists(path)
  if (existing !== null && !rotate) {
    return { value: existing.trim(), update: { path, action: 'kept' } }
  }
  return { value: '', update: await writeTextFile(path, '\n', { mode: 0o600 }) }
}

async function stageRuntimeTokenFile(
  path: string,
  existingValue: string | undefined
): Promise<RuntimeTokenState> {
  return {
    value: existingValue,
    update: await writeTextFile(path, `${existingValue ?? ''}\n`, { mode: 0o600 })
  }
}

async function clearRuntimeTokenMaterial(lifecycle: LifecycleConfig): Promise<RuntimeTokenState> {
  await removeFileIfExists(lifecycle.runtimeStatePath)
  return {
    value: undefined,
    update: await writeTextFile(lifecycle.runtimeTokenPath, '\n', { mode: 0o600 })
  }
}

async function ensureWireGuardMaterial(
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

async function removeFileIfExists(path: string): Promise<FileUpdate> {
  await assertSafeLifecycleFilePath(path)
  try {
    await rm(path)
    return { path, action: 'removed' }
  } catch {
    return { path, action: 'kept' }
  }
}

async function buildValidationSummary(lifecycle: LifecycleConfig) {
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

function summarizePresence(value: string): string {
  return value.length > 0 ? 'present' : 'missing'
}

function summarizeOptionalSecret(value: string | undefined): string {
  return value && value.length > 0 ? 'present' : 'staged-empty'
}
