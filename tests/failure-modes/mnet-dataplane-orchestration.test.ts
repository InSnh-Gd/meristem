import { describe, expect, it } from 'bun:test'
import type { MNetworkMember } from '../../packages/contracts/src/index.ts'
import { createInMemoryDataPlaneStores } from '../../services/m-net/src/data-plane-store-memory.ts'
import type { DataPlaneDeps } from '../../services/m-net/src/mnet-dataplane-support.ts'
import {
  breakGlassFailClosed,
  enableDataPlaneProfile
} from '../../services/m-net/src/mnet-dataplane-workflows.ts'
import { requestNetworkProfileChange } from '../../services/m-net/src/profile-enable-disable-workflows.ts'
import { createInMemoryProfileStore } from '../../services/m-net/src/profile-store.ts'
import { CHINA_DATA_PLANE_PROFILE_VERSION } from '../../services/m-net/src/profile-workflow-types.ts'
import { createInMemorySuspendedOperationStore } from '../../services/m-net/src/suspended-operations.ts'

const members: MNetworkMember[] = [
  {
    networkId: 'network-dataplane-orchestration-failure',
    nodeId: 'stem-cn-1',
    nodeKind: 'stem',
    membershipMode: 'full',
    status: 'joined',
    joinedAt: '2026-06-18T00:00:00.000Z'
  },
  {
    networkId: 'network-dataplane-orchestration-failure',
    nodeId: 'leaf-cn-1',
    nodeKind: 'leaf',
    membershipMode: 'restricted',
    status: 'joined',
    joinedAt: '2026-06-18T00:01:00.000Z'
  }
]

async function createDeps(overrides?: Partial<DataPlaneDeps>): Promise<DataPlaneDeps> {
  const dataPlane = createInMemoryDataPlaneStores()
  const profileStore = createInMemoryProfileStore()

  // DFW-032：成员必须持有真实运行时密钥才会进入渲染 map，否则 materialize 会 fail closed
  // （network.no_runtime_keys）。这些用例关注的是其他编排行为，故先为测试成员注册密钥。
  for (const member of members) {
    await dataPlane.nodePublicKeys.upsert({
      nodeId: member.nodeId,
      keyId: `${member.nodeId}-runtime`,
      publicKey: `${member.nodeId
        .replace(/[^A-Za-z0-9]/g, 'A')
        .padEnd(43, 'B')
        .slice(0, 43)}=`,
      fingerprint: `fp-${member.nodeId}`,
      algorithm: 'wireguard-x25519',
      createdAt: new Date().toISOString(),
      rotationCounter: 0,
      status: 'active'
    })
  }

  return {
    profileStore,
    policyAuthorize: {
      async authorize() {
        return { result: 'allow' as const, id: crypto.randomUUID(), reasons: [] }
      }
    },
    listMembers: async input => ({
      ok: true as const,
      value: members.filter(member => member.networkId === input.networkId)
    }),
    dataPlane,
    events: {
      async publish() {
        /* noop */
      }
    },
    log: {
      async writeTimeline() {
        /* noop */
      },
      async writeFull() {
        /* noop */
      },
      async writeAudit() {
        /* noop */
      }
    },
    networkUpdater: {
      async setProfileVersion() {
        /* noop */
      }
    },
    /** NetBird adapter selection requires a valid control-plane config for V03 profile enable. */
    resolveNetBirdControlPlane: async () => ({
      managementUrl: 'https://netbird.meristem.internal:443',
      setupKey: 'test-setup-key-00000000000000000000',
      signalConfigRef: { configRef: 'netbird-test-signal-config' },
      relayConfigRef: { configRef: 'netbird-test-relay-config' },
      stunConfigRef: { configRef: 'netbird-test-stun-config' },
      sidecarCredentialRef: { provider: 'test-provider', keyPath: '/tmp/test/netbird-key' },
      sidecarCredentialStatus: 'ready' as const,
      sidecarHealthStatus: 'healthy' as const,
      prerequisites: { signalReady: true, relayReady: true, stunReady: true }
    }),
    ...overrides
  }
}

describe('M-Net dataplane orchestration failure modes', () => {
  it('legacy production profile requests fail closed with typed migration guidance before policy evaluation', async () => {
    const profileStore = createInMemoryProfileStore()
    await profileStore.setNetworkState('network-dataplane-orchestration-failure', {
      profileVersion: 'm-net-cn@0.2.0',
      status: 'disabled'
    })

    const result = await requestNetworkProfileChange(
      {
        profileStore,
        suspendedOps: createInMemorySuspendedOperationStore(),
        approvals: {
          async create() {
            return { ok: true as const, value: { approvalId: crypto.randomUUID() } }
          }
        },
        policyAuthorize: {
          async authorize() {
            return { result: 'deny' as const, id: crypto.randomUUID(), reasons: ['blocked'] }
          }
        },
        listMembers: async () => ({ ok: true as const, value: members })
      },
      {
        actor: 'admin',
        networkId: 'network-dataplane-orchestration-failure',
        body: { profileVersion: 'm-net-cn@0.3.0', reason: 'policy deny' }
      }
    )

    expect(result).toMatchObject({
      kind: 'failure',
      status: 409,
      error: {
        code: 'migration_required',
        migration: {
          reasonCode: 'legacy_wstunnel_profile_v0_2',
          targetProfileVersion: 'm-net-cn@0.3.0'
        }
      }
    })
  })

  it('audit write failure blocks high-risk enable and leaves state unchanged', async () => {
    const deps = await createDeps({
      log: {
        async writeTimeline() {
          /* noop */
        },
        async writeFull() {
          /* noop */
        },
        async writeAudit() {
          throw new Error('audit unavailable')
        }
      }
    })
    await deps.profileStore.setNetworkState('network-dataplane-orchestration-failure', {
      profileVersion: 'm-net@0.3.0',
      status: 'disabled'
    })

    const result = await enableDataPlaneProfile(deps, {
      actor: 'admin',
      networkId: 'network-dataplane-orchestration-failure',
      reason: 'audit must succeed',
      profileVersion: CHINA_DATA_PLANE_PROFILE_VERSION
    })

    expect(result).toEqual({
      kind: 'failure',
      ok: false,
      status: 503,
      error: { code: 'audit.write_failed', message: 'audit unavailable' }
    })
    expect(
      await deps.profileStore.getNetworkState('network-dataplane-orchestration-failure')
    ).toMatchObject({
      profileVersion: 'm-net@0.3.0',
      status: 'disabled'
    })
    expect(
      await deps.dataPlane.networkMaps.getLatest('network-dataplane-orchestration-failure')
    ).toBeNull()
  })

  it('event bus failure returns typed outcome after persistence work', async () => {
    const deps = await createDeps({
      events: {
        async publish() {
          throw new Error('event bus offline')
        }
      }
    })
    await deps.profileStore.setNetworkState('network-dataplane-orchestration-failure', {
      profileVersion: 'm-net@0.3.0',
      status: 'disabled'
    })

    const result = await enableDataPlaneProfile(deps, {
      actor: 'admin',
      networkId: 'network-dataplane-orchestration-failure',
      reason: 'event bus failure path',
      profileVersion: CHINA_DATA_PLANE_PROFILE_VERSION
    })

    expect(result).toEqual({
      kind: 'failure',
      ok: false,
      status: 503,
      error: { code: 'event.publish_failed', message: 'event bus offline' }
    })
    expect(
      await deps.dataPlane.networkMaps.getLatest('network-dataplane-orchestration-failure')
    ).not.toBeNull()
  })

  it('writes ISO tunnel allocation timestamps during enable orchestration', async () => {
    const base = await createDeps()
    await base.profileStore.setNetworkState('network-dataplane-orchestration-failure', {
      profileVersion: 'm-net@0.3.0',
      status: 'disabled'
    })

    const seenAllocatedAt: string[] = []
    const result = await enableDataPlaneProfile(
      {
        ...base,
        dataPlane: {
          ...base.dataPlane,
          tunnelAllocations: {
            ...base.dataPlane.tunnelAllocations,
            async upsert(record) {
              seenAllocatedAt.push(record.allocatedAt)
              await base.dataPlane.tunnelAllocations.upsert(record)
            }
          }
        }
      },
      {
        actor: 'admin',
        networkId: 'network-dataplane-orchestration-failure',
        reason: 'timestamp regression coverage',
        profileVersion: CHINA_DATA_PLANE_PROFILE_VERSION
      }
    )

    if ('kind' in result) {
      throw new Error(`expected enable success, got ${result.error.code}`)
    }

    expect(seenAllocatedAt.length).toBeGreaterThan(0)
    for (const allocatedAt of seenAllocatedAt) {
      expect(Number.isNaN(Date.parse(allocatedAt))).toBeFalse()
    }
  })

  it('assigns distinct tunnel IPs to multiple members in one enable pass', async () => {
    const deps = await createDeps()
    await deps.profileStore.setNetworkState('network-dataplane-orchestration-failure', {
      profileVersion: 'm-net-default@0.1.0',
      status: 'disabled'
    })

    const result = await enableDataPlaneProfile(deps, {
      actor: 'admin',
      networkId: 'network-dataplane-orchestration-failure',
      reason: 'unique tunnel allocation regression',
      profileVersion: CHINA_DATA_PLANE_PROFILE_VERSION
    })

    if ('kind' in result) {
      throw new Error(`expected enable success, got ${result.error.code}`)
    }

    const allocations = await deps.dataPlane.tunnelAllocations.listByNetwork(
      'network-dataplane-orchestration-failure'
    )
    expect(allocations).toHaveLength(2)
    expect(new Set(allocations.map(allocation => allocation.tunnelIp)).size).toBe(2)
  })

  it('store failure returns typed PG-like outcome', async () => {
    const base = await createDeps()
    await base.profileStore.setNetworkState('network-dataplane-orchestration-failure', {
      profileVersion: 'm-net-default@0.1.0',
      status: 'disabled'
    })

    const result = await enableDataPlaneProfile(
      {
        ...base,
        dataPlane: {
          ...base.dataPlane,
          networkMaps: {
            ...base.dataPlane.networkMaps,
            async save() {
              throw new Error('pg write failed')
            }
          }
        }
      },
      {
        actor: 'admin',
        networkId: 'network-dataplane-orchestration-failure',
        reason: 'pg failure path',
        profileVersion: CHINA_DATA_PLANE_PROFILE_VERSION
      }
    )

    expect(result).toEqual({
      kind: 'failure',
      ok: false,
      status: 503,
      error: {
        code: 'dataplane.store_failed',
        message:
          'network_maps save failed for network-dataplane-orchestration-failure: pg write failed'
      }
    })
  })

  it('releases the operation lock when enable fails after materialization (thrown store failure)', async () => {
    // 回归：锁泄漏缺陷。此前只有 return 路径释放锁，materialize 之后的抛异常（如
    // profileMigrations.upsert 抖动）会让锁在 15 分钟 TTL 内持续以 409 拒绝重试。
    const base = await createDeps()
    const deps: DataPlaneDeps = {
      ...base,
      dataPlane: {
        ...base.dataPlane,
        profileMigrations: {
          ...base.dataPlane.profileMigrations,
          async upsert() {
            throw new Error('pg write failed after materialize')
          }
        }
      }
    }

    const result = await enableDataPlaneProfile(deps, {
      actor: 'admin',
      networkId: 'network-dataplane-orchestration-failure',
      reason: 'post-materialize throw',
      profileVersion: CHINA_DATA_PLANE_PROFILE_VERSION
    })

    expect('kind' in result).toBe(true)
    // 关键断言：失败后不得残留 active 锁。
    const activeLock = await deps.dataPlane.operationLocks.getActiveByNetwork(
      'network-dataplane-orchestration-failure'
    )
    expect(activeLock).toBeNull()
  })

  it('break-glass preempts ongoing migration and forces fail-closed partition state', async () => {
    const deps = await createDeps()
    await deps.dataPlane.operationLocks.upsert({
      networkId: 'network-dataplane-orchestration-failure',
      operationType: 'migration',
      operationId: 'migration-001',
      acquiredAt: '2026-06-18T00:00:00.000Z',
      expiresAt: '2026-06-18T00:10:00.000Z',
      status: 'active',
      lockRowId: 'lock-row-1',
      fencingToken: 1,
      updatedAt: '2026-06-18T00:00:00.000Z'
    })

    const result = await breakGlassFailClosed(deps, {
      actor: 'security-admin',
      networkId: 'network-dataplane-orchestration-failure',
      reason: 'unsafe migration'
    })

    if ('kind' in result) {
      throw new Error(`expected break-glass success, got ${result.error.code}`)
    }
    const interruptedLock = await deps.dataPlane.operationLocks.getByOperationId('migration-001')
    const breakGlassLock = await deps.dataPlane.operationLocks.getByOperationId(result.operationId)
    const partition = await deps.dataPlane.partitionStates.get(
      'network-dataplane-orchestration-failure'
    )

    expect(interruptedLock?.status).toBe('interrupted')
    expect(breakGlassLock?.status).toBe('active')
    expect(partition?.state).toBe('fail_closed')
    expect(
      (await deps.dataPlane.sidecarDesiredConfigs.list()).map(item => item.nodeId).sort()
    ).toEqual(['leaf-cn-1', 'stem-cn-1'])
  })
})
