import { describe, expect, it } from 'bun:test'
import { applyHeartbeat } from '../../services/m-net/src/agent-runtime-session-lifecycle.ts'
import { enableDataPlaneProfile } from '../../services/m-net/src/mnet-dataplane-workflows.ts'
import { shouldTransitionOffline } from '../../services/m-net/src/runtime.ts'
import { applySidecarDesiredState } from '../../services/node-agent/src/node-agent-sidecar-lifecycle.ts'
import {
  completeNetBirdSecrets,
  createDataPlaneLifecycleFixture,
  createHeartbeatRuntimeHarness,
  createMNetLifecycleFixture,
  createNetBirdSecretManager,
  lifecycleNetworkId,
  lifecycleNodeId,
  lifecycleProfileVersion,
  lifecycleStartedAt,
  netBirdDeploymentConfig,
  netBirdDesiredSidecar,
  submitLifecycleJoin
} from '../helpers/mnet-lifecycle-proof-fixture.ts'

function createDeferred<T>() {
  let resolver: ((value: T | PromiseLike<T>) => void) | undefined
  const promise = new Promise<T>(resolve => {
    resolver = resolve
  })

  return {
    promise,
    resolve(value: T) {
      if (!resolver) throw new Error('deferred promise was not initialized')
      resolver(value)
    }
  }
}

const migrationEngineLegacyProfileVersion = 'm-net-cn@0.1.0'

async function approveLifecycleCredential(
  fixture: ReturnType<typeof createMNetLifecycleFixture>,
  requestId: string
) {
  const requested = await submitLifecycleJoin(fixture, requestId)
  const approved = await fixture.service.decideJoinRequest({
    actor: 'admin',
    requestId: requested.requestId,
    decision: 'approve',
    credentialExpiresAt: '2026-07-25T10:00:00.000Z'
  })
  if (!('kind' in approved) || approved.kind !== 'mutation') {
    throw new Error('expected credential approval mutation')
  }
  if (approved.value.result !== 'approved') throw new Error('expected approved credential')
  return approved.value.credential
}

describe('failure mode: M-Net production lifecycle proof', () => {
  it('rejects a concurrent topology activation while a migration has already claimed the network lock', async () => {
    const fixture = createDataPlaneLifecycleFixture()
    await fixture.profileStore.setNetworkState(lifecycleNetworkId, {
      profileVersion: 'm-net@0.3.0',
      status: 'disabled'
    })
    await fixture.dataPlane.operationLocks.upsert({
      networkId: lifecycleNetworkId,
      operationType: 'migration',
      operationId: 'migration-topology-race',
      acquiredAt: lifecycleStartedAt,
      expiresAt: '2099-07-24T10:15:00.000Z',
      status: 'active',
      lockRowId: 'lock-topology-race',
      fencingToken: 1,
      updatedAt: lifecycleStartedAt
    })

    const result = await enableDataPlaneProfile(fixture.dataPlaneDeps, {
      actor: 'admin',
      networkId: lifecycleNetworkId,
      reason: 'concurrent topology approval must not materialize twice',
      profileVersion: lifecycleProfileVersion
    })

    expect(result).toMatchObject({
      kind: 'failure',
      status: 409,
      error: { code: 'operation.locked' }
    })
    expect(await fixture.profileStore.getNetworkState(lifecycleNetworkId)).toMatchObject({
      profileVersion: 'm-net@0.3.0',
      status: 'disabled'
    })
    expect(await fixture.dataPlane.networkMaps.getLatest(lifecycleNetworkId)).toBeNull()
    expect(await fixture.dataPlane.sidecarDesiredConfigs.list()).toEqual([])
  })

  it('keeps a recovering node retryable when heartbeat completion evidence cannot be written', async () => {
    expect(
      shouldTransitionOffline(
        {
          id: lifecycleNodeId,
          mode: 'agent',
          status: 'healthy',
          reachability: 'reachable',
          lastSeenAt: '2026-07-24T09:59:00.000Z'
        },
        new Date(lifecycleStartedAt),
        30_000
      )
    ).toBe(true)

    const harness = createHeartbeatRuntimeHarness({
      status: 'recovering',
      reachability: 'unreachable',
      lastSeenAt: new Date('2026-07-24T09:59:00.000Z')
    })
    harness.setAvailability({ auditUnavailable: true })

    await expect(
      applyHeartbeat(harness.context, lifecycleNodeId, {
        type: 'heartbeat',
        sessionId: 'session-mnet-lifecycle-audit-failure',
        agentVersion: '0.2.0',
        reportedStatus: 'healthy',
        timestamp: lifecycleStartedAt
      })
    ).rejects.toThrow('audit unavailable')

    expect(harness.snapshot()).toMatchObject({
      status: 'recovering',
      reachability: 'unreachable'
    })

    harness.setAvailability({ auditUnavailable: false })
    await applyHeartbeat(harness.context, lifecycleNodeId, {
      type: 'heartbeat',
      sessionId: 'session-mnet-lifecycle-audit-retry',
      agentVersion: '0.2.0',
      reportedStatus: 'healthy',
      timestamp: '2026-07-24T10:01:00.000Z'
    })

    expect(harness.snapshot()).toMatchObject({
      status: 'healthy',
      reachability: 'reachable'
    })
    expect(harness.audits).toContainEqual(
      expect.objectContaining({ action: 'node:recover-completed' })
    )
  })

  it('removes an active tunnel from eligibility for the full duration of credential rotation', async () => {
    const fixture = createMNetLifecycleFixture()
    const credential = await approveLifecycleCredential(
      fixture,
      'join-mnet-lifecycle-active-connection'
    )
    const tunnel = await fixture.service.recordTunnelHealth({
      networkId: lifecycleNetworkId,
      health: {
        nodeId: lifecycleNodeId,
        peerNodeId: 'stem-mnet-lifecycle-proof',
        status: 'up',
        mode: 'direct',
        relayStatus: 'not-required',
        checkedAt: lifecycleStartedAt,
        stateSource: 'node-runtime-report'
      }
    })
    if (tunnel.kind !== 'mutation') throw new Error('expected active tunnel mutation')

    const rotationStarted = createDeferred<void>()
    const replacementSecret = createDeferred<{
      ok: true
      credentialRef: {
        provider: 'vault-kv-v2'
        keyPath: string
        version: number
      }
    }>()
    fixture.setRotateHandler(async () => {
      rotationStarted.resolve(undefined)
      return replacementSecret.promise
    })

    const rotation = fixture.service.rotateCredential({
      actor: 'security-admin',
      credentialId: credential.credentialId,
      expiresAt: '2026-07-26T10:00:00.000Z',
      reason: 'rotate while a direct peer session is active'
    })
    await rotationStarted.promise

    expect(await fixture.store.credentials.get(credential.credentialId)).toMatchObject({
      status: 'rotating'
    })
    expect(await fixture.service.isTunnelEligible(lifecycleNetworkId, lifecycleNodeId)).toBe(false)
    expect(await fixture.store.credentialOperations.listPending()).toHaveLength(1)
    expect(await fixture.store.tunnels.listByNetwork(lifecycleNetworkId)).toMatchObject([
      { nodeId: lifecycleNodeId, status: 'up', mode: 'direct' }
    ])

    replacementSecret.resolve({
      ok: true,
      credentialRef: {
        provider: 'vault-kv-v2',
        keyPath: 'secret/data/mnet/rotation-replacement',
        version: 2
      }
    })
    const rotated = await rotation
    if (!('kind' in rotated) || rotated.kind !== 'mutation') {
      throw new Error('expected completed credential rotation mutation')
    }

    expect(rotated.value).toMatchObject({
      result: 'rotated',
      existingTunnelsInvalidated: true,
      previousCredentialId: credential.credentialId
    })
    expect(await fixture.service.isTunnelEligible(lifecycleNetworkId, lifecycleNodeId)).toBe(true)
    expect(await fixture.store.credentialOperations.listPending()).toEqual([])
  })

  it('blocks the migration engine while break-glass owns the data-plane operation lock', async () => {
    const fixture = createDataPlaneLifecycleFixture()
    await fixture.profileStore.setNetworkState(lifecycleNetworkId, {
      profileVersion: migrationEngineLegacyProfileVersion,
      status: 'enabled'
    })
    await fixture.dataPlane.operationLocks.upsert({
      networkId: lifecycleNetworkId,
      operationType: 'break_glass',
      operationId: 'break-glass-migration-conflict',
      acquiredAt: lifecycleStartedAt,
      expiresAt: '2099-07-24T10:15:00.000Z',
      status: 'active',
      lockRowId: 'lock-break-glass-migration-conflict',
      fencingToken: 4,
      updatedAt: lifecycleStartedAt
    })

    const migration = await fixture.migrationEngine.migrateNetwork({
      networkId: lifecycleNetworkId,
      actor: 'admin',
      reason: 'do not bypass active break-glass containment',
      operationId: 'migration-mnet-lifecycle-blocked'
    })
    if (!migration.ok) throw new Error('expected migration engine response')

    expect(migration.value.result).toMatchObject({
      networkId: lifecycleNetworkId,
      status: 'failed'
    })
    expect(await fixture.profileStore.getNetworkState(lifecycleNetworkId)).toMatchObject({
      profileVersion: migrationEngineLegacyProfileVersion,
      status: 'enabled'
    })
    expect(
      await fixture.dataPlane.profileMigrations.get(
        lifecycleNetworkId,
        'migration-mnet-lifecycle-blocked'
      )
    ).toBeNull()
    expect(
      await fixture.dataPlane.operationLocks.getByOperationId('break-glass-migration-conflict')
    ).toMatchObject({ status: 'active', operationType: 'break_glass' })
  })

  it('recovers a NetBird sidecar after a process-loss reconciliation without exposing its credentials', async () => {
    const writes: string[] = []
    let spawnCount = 0
    const createLifecycleDeps = (running: boolean) => ({
      deploymentConfig: netBirdDeploymentConfig,
      secretManager: createNetBirdSecretManager(completeNetBirdSecrets()),
      env: {
        MERISTEM_NODE_AGENT_SIDECAR_CONFIG_PATH: `${import.meta.dir}/mnet-lifecycle-sidecar-recovery.json`
      },
      async mkdir() {},
      async writeTextFile(_path: string, contents: string) {
        writes.push(contents)
      },
      async spawnProcess() {
        spawnCount += 1
        return { pid: 43_000 + spawnCount }
      },
      isProcessRunning() {
        return running
      },
      async runCommand() {
        return { exitCode: 0, stdout: 'connected', stderr: '' }
      }
    })
    const lifecycleInput = {
      nodeId: lifecycleNodeId,
      correlationId: 'correlation-mnet-lifecycle-sidecar-recovery',
      observedAt: lifecycleStartedAt,
      desired: netBirdDesiredSidecar,
      runtimeMap: { networkId: lifecycleNetworkId, mapVersion: 7 }
    }

    const initial = await applySidecarDesiredState(lifecycleInput, createLifecycleDeps(true))
    expect(initial.runtimeStatus.kind).toBe('healthy')

    const restarted = await applySidecarDesiredState(
      { ...lifecycleInput, currentProcess: initial.process },
      createLifecycleDeps(false)
    )
    expect(restarted.runtimeStatus.kind).toBe('degraded')
    expect(
      restarted.runtimeStatus.degradedReasons.some(
        reason => reason.code === 'netbird.process_restarted'
      )
    ).toBe(true)
    expect(restarted.process.processPid).toBe(43_002)

    const recovered = await applySidecarDesiredState(
      { ...lifecycleInput, currentProcess: restarted.process },
      createLifecycleDeps(true)
    )
    expect(recovered.runtimeStatus).toMatchObject({
      kind: 'healthy',
      healthStatus: 'healthy',
      degradedReasons: []
    })
    expect(recovered.process.processPid).toBe(43_002)
    expect(spawnCount).toBe(2)
    expect(writes).toHaveLength(3)
    expect(writes.join('\n')).not.toContain('sidecar-lifecycle-secret')
  })
})
