import type {
  FileUpdate,
  InstallInput,
  LifecycleConfig,
  UpgradeInput
} from './node-agent-lifecycle-definitions.ts'
import { assertSafeLifecyclePaths } from './node-agent-lifecycle-paths.ts'
import {
  type PersistedEnv,
  buildValidationSummary,
  clearRuntimeTokenMaterial,
  ensureParentDirs,
  ensureWireGuardMaterial,
  readPersistedEnv,
  readRuntimeState,
  removeFileIfExists,
  renderEnvFile,
  renderPersistedEnvFile,
  stageOperatorManagedSecretFile,
  stageRuntimeTokenFile,
  summarizeOptionalSecret,
  summarizePresence,
  writeOptionalSecretFile,
  writeTextFile
} from './node-agent-lifecycle-helpers.ts'

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
