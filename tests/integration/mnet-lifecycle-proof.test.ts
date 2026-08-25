import { describe, expect, it } from 'bun:test'
import { applyHeartbeat } from '../../services/m-net/src/agent-runtime-session-lifecycle.ts'
import { projectNodeAgentSidecarStatus } from '../../services/m-net/src/closed-loop-workflow.ts'
import { breakGlassFailClosed } from '../../services/m-net/src/mnet-dataplane-workflows.ts'
import { shouldTransitionOffline } from '../../services/m-net/src/runtime.ts'
import { applySidecarDesiredState } from '../../services/node-agent/src/node-agent-sidecar-lifecycle.ts'
import {
  completeNetBirdSecrets,
  createDataPlaneLifecycleFixture,
  createHeartbeatRuntimeHarness,
  createMNetLifecycleFixture,
  createNetBirdSecretManager,
  lifecycleLegacyProfileVersion,
  lifecycleNetworkId,
  lifecycleNodeId,
  lifecycleProfileVersion,
  lifecycleStartedAt,
  lifecycleStemId,
  netBirdDeploymentConfig,
  netBirdDesiredSidecar,
  submitLifecycleJoin
} from '../helpers/mnet-lifecycle-proof-fixture.ts'

describe('integration: M-Net production lifecycle proof', () => {
  it('approves topology admission and projects a healthy NetBird sidecar into the authoritative topology', async () => {
    const fixture = createMNetLifecycleFixture()
    const requested = await submitLifecycleJoin(fixture)
    const approved = await fixture.service.decideJoinRequest({
      actor: 'admin',
      requestId: requested.requestId,
      decision: 'approve',
      credentialExpiresAt: '2026-07-25T10:00:00.000Z'
    })
    if (!('kind' in approved) || approved.kind !== 'mutation') {
      throw new Error('expected topology admission approval mutation')
    }
    if (approved.value.result !== 'approved')
      throw new Error('expected approved topology admission')

    await fixture.dataPlane.networkMaps.save({
      networkId: lifecycleNetworkId,
      mapVersion: 1,
      profileVersion: lifecycleProfileVersion,
      map: {
        networkId: lifecycleNetworkId,
        profileVersion: lifecycleProfileVersion,
        members: [],
        aclRules: [],
        expiresAt: Date.parse('2026-07-24T11:00:00.000Z'),
        mapVersion: 1,
        signatureMetadata: {
          algorithm: 'ed25519',
          keyId: 'mnet-lifecycle-map-key',
          publicKey: 'mnet-lifecycle-public-key',
          value: 'mnet-lifecycle-signature'
        }
      },
      signatureMetadata: { keyId: 'mnet-lifecycle-map-key' },
      expiresAt: '2026-07-24T11:00:00.000Z',
      publishedAt: lifecycleStartedAt
    })
    await fixture.dataPlane.nodePublicKeys.upsert({
      nodeId: lifecycleNodeId,
      keyId: 'mnet-lifecycle-node-key',
      publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      fingerprint: 'sha256:mnet-lifecycle-node-key',
      algorithm: 'wireguard-x25519',
      createdAt: lifecycleStartedAt,
      rotationCounter: 0,
      status: 'active'
    })

    const sidecarWrites: string[] = []
    const sidecarState = await applySidecarDesiredState(
      {
        nodeId: lifecycleNodeId,
        correlationId: 'correlation-mnet-lifecycle-sidecar',
        observedAt: lifecycleStartedAt,
        desired: netBirdDesiredSidecar,
        runtimeMap: { networkId: lifecycleNetworkId, mapVersion: 1 }
      },
      {
        deploymentConfig: netBirdDeploymentConfig,
        secretManager: createNetBirdSecretManager(completeNetBirdSecrets()),
        env: {
          MERISTEM_NODE_AGENT_SIDECAR_CONFIG_PATH: `${import.meta.dir}/mnet-lifecycle-sidecar.json`
        },
        async mkdir() {},
        async writeTextFile(_path, contents) {
          sidecarWrites.push(contents)
        },
        async spawnProcess() {
          return { pid: 42_101 }
        },
        isProcessRunning() {
          return true
        },
        async runCommand() {
          return { exitCode: 0, stdout: 'connected', stderr: '' }
        }
      }
    )

    expect(sidecarState.runtimeStatus.kind).toBe('healthy')
    expect(sidecarWrites).toHaveLength(1)
    expect(sidecarWrites.join('\n')).not.toContain('sidecar-lifecycle-secret')

    const sidecarStatus = projectNodeAgentSidecarStatus(
      lifecycleNodeId,
      sidecarState.runtimeStatus,
      { proofPath: 'runtime-probe' }
    )
    const recordedSidecar = await fixture.service.recordSidecarStatus({
      networkId: lifecycleNetworkId,
      status: sidecarStatus
    })
    if (recordedSidecar.kind !== 'mutation') {
      throw new Error('expected sidecar status mutation')
    }
    const recordedTunnel = await fixture.service.recordTunnelHealth({
      networkId: lifecycleNetworkId,
      health: {
        nodeId: lifecycleNodeId,
        peerNodeId: lifecycleStemId,
        status: 'up',
        mode: 'direct',
        relayStatus: 'not-required',
        checkedAt: lifecycleStartedAt,
        stateSource: 'node-runtime-report'
      }
    })
    if (recordedTunnel.kind !== 'mutation') {
      throw new Error('expected tunnel health mutation')
    }

    const topology = await fixture.service.getTopologyView({
      actor: 'operator',
      networkId: lifecycleNetworkId,
      correlationId: 'correlation-mnet-lifecycle-topology'
    })
    if ('kind' in topology) throw new Error(topology.error.message)

    expect(approved.value.credential.status).toBe('issued')
    expect(await fixture.service.isTunnelEligible(lifecycleNetworkId, lifecycleNodeId)).toBe(true)
    expect(topology.networks[0]).toMatchObject({
      status: 'healthy',
      mapStatus: {
        signedBy: 'mnet-lifecycle-map-key',
        freshness: 'fresh',
        validation: 'valid'
      }
    })
    expect(topology.nodes[0]).toMatchObject({
      nodeId: lifecycleNodeId,
      runtimeState: 'healthy',
      credentialStatus: 'issued',
      sidecar: { healthy: true, proofPath: 'runtime-probe' }
    })
    expect(fixture.events.map(event => event.subject)).toEqual(
      expect.arrayContaining([
        'mnet.join.requested.v0',
        'mnet.join.approved.v0',
        'mnet.credential.issued.v0',
        'mnet.topology.view.updated.v0'
      ])
    )
  })

  it('evaluates stale heartbeats and restores offline or recovering agents through reported runtime state', async () => {
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

    const timeoutHarness = createHeartbeatRuntimeHarness({
      status: 'offline',
      reachability: 'unreachable',
      lastSeenAt: new Date('2026-07-24T09:59:00.000Z')
    })
    const returningHeartbeat = await applyHeartbeat(timeoutHarness.context, lifecycleNodeId, {
      type: 'heartbeat',
      sessionId: 'session-mnet-lifecycle-returning',
      agentVersion: '0.2.0',
      reportedStatus: 'healthy',
      timestamp: '2026-07-24T10:01:00.000Z'
    })
    expect(returningHeartbeat).toEqual({ ok: true, value: undefined })
    expect(timeoutHarness.snapshot()).toMatchObject({
      status: 'healthy',
      reachability: 'reachable',
      agentVersion: '0.2.0'
    })

    const recoveryHarness = createHeartbeatRuntimeHarness({
      status: 'recovering',
      reachability: 'unreachable',
      lastSeenAt: new Date('2026-07-24T10:01:00.000Z')
    })
    await applyHeartbeat(recoveryHarness.context, lifecycleNodeId, {
      type: 'heartbeat',
      sessionId: 'session-mnet-lifecycle-recovery',
      agentVersion: '0.2.1',
      reportedStatus: 'healthy',
      timestamp: '2026-07-24T10:02:00.000Z'
    })

    expect(recoveryHarness.snapshot()).toMatchObject({
      status: 'healthy',
      reachability: 'reachable'
    })
    expect(recoveryHarness.audits).toContainEqual(
      expect.objectContaining({ action: 'node:recover-completed' })
    )
    expect(recoveryHarness.timeline).toContainEqual(
      expect.objectContaining({
        summary: `node recovery completed as healthy ${lifecycleNodeId}`
      })
    )
  })

  it('rotates an approved credential through the durable transition and restores eligibility only for its replacement', async () => {
    const fixture = createMNetLifecycleFixture()
    const requested = await submitLifecycleJoin(fixture, 'join-mnet-lifecycle-rotation')
    const approved = await fixture.service.decideJoinRequest({
      actor: 'admin',
      requestId: requested.requestId,
      decision: 'approve',
      credentialExpiresAt: '2026-07-25T10:00:00.000Z'
    })
    if (!('kind' in approved) || approved.kind !== 'mutation') {
      throw new Error('expected credential approval mutation')
    }
    if (approved.value.result !== 'approved') throw new Error('expected credential approval')

    expect(await fixture.service.isTunnelEligible(lifecycleNetworkId, lifecycleNodeId)).toBe(true)

    const rotated = await fixture.service.rotateCredential({
      actor: 'security-admin',
      credentialId: approved.value.credential.credentialId,
      expiresAt: '2026-07-26T10:00:00.000Z',
      reason: 'scheduled production rotation'
    })
    if (!('kind' in rotated) || rotated.kind !== 'mutation') {
      throw new Error('expected credential rotation mutation')
    }

    expect(rotated.value).toMatchObject({
      result: 'rotated',
      previousCredentialId: approved.value.credential.credentialId,
      existingTunnelsInvalidated: true,
      credential: {
        status: 'issued',
        rotatedFromCredentialId: approved.value.credential.credentialId
      }
    })
    expect(
      await fixture.store.credentials.get(approved.value.credential.credentialId)
    ).toMatchObject({
      status: 'revoked'
    })
    expect(await fixture.service.isTunnelEligible(lifecycleNetworkId, lifecycleNodeId)).toBe(true)
    expect(fixture.calls).toContain(`secret:revoke:${approved.value.credential.credentialId}`)
    expect(fixture.events.at(-1)?.subject).toBe('mnet.credential.rotated.v0')
  })

  it('preempts an active migration with break-glass and leaves the overlay fail closed', async () => {
    const fixture = createDataPlaneLifecycleFixture()
    await fixture.profileStore.setNetworkState(lifecycleNetworkId, {
      profileVersion: lifecycleLegacyProfileVersion,
      status: 'enabled'
    })
    await fixture.dataPlane.operationLocks.upsert({
      networkId: lifecycleNetworkId,
      operationType: 'migration',
      operationId: 'migration-mnet-lifecycle-active',
      acquiredAt: lifecycleStartedAt,
      expiresAt: '2099-07-24T10:15:00.000Z',
      status: 'active',
      lockRowId: 'lock-mnet-lifecycle-migration',
      fencingToken: 1,
      updatedAt: lifecycleStartedAt
    })

    const breakGlass = await breakGlassFailClosed(fixture.breakGlassDeps, {
      actor: 'security-admin',
      networkId: lifecycleNetworkId,
      reason: 'migration no longer has trustworthy runtime evidence'
    })
    if ('kind' in breakGlass) throw new Error(breakGlass.error.message)

    const interrupted = await fixture.dataPlane.operationLocks.getByOperationId(
      'migration-mnet-lifecycle-active'
    )
    const activeBreakGlass = await fixture.dataPlane.operationLocks.getByOperationId(
      breakGlass.operationId
    )
    const partition = await fixture.dataPlane.partitionStates.get(lifecycleNetworkId)
    const desiredSidecars = await fixture.dataPlane.sidecarDesiredConfigs.list()

    expect(interrupted).toMatchObject({ status: 'interrupted' })
    expect(activeBreakGlass).toMatchObject({
      status: 'active',
      operationType: 'break_glass',
      fencingToken: 2
    })
    expect(partition).toMatchObject({ state: 'fail_closed' })
    expect(desiredSidecars.map(sidecar => sidecar.nodeId).sort()).toEqual([
      lifecycleNodeId,
      lifecycleStemId
    ])
    expect(fixture.events).toContainEqual(
      expect.objectContaining({ subject: 'mnet.profile.disabled.v0' })
    )
  })
})
