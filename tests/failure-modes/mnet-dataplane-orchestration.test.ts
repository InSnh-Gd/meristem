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

function createDeps(overrides?: Partial<DataPlaneDeps>): DataPlaneDeps {
  const dataPlane = createInMemoryDataPlaneStores()
  const profileStore = createInMemoryProfileStore()

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
    ...overrides
  }
}

describe('M-Net dataplane orchestration failure modes', () => {
  it('policy denial blocks enable with typed outcome', async () => {
    const profileStore = createInMemoryProfileStore()
    await profileStore.setNetworkState('network-dataplane-orchestration-failure', {
      profileVersion: 'm-net-default@0.1.0',
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
        body: { profileVersion: 'm-net-cn@0.2.0', reason: 'policy deny' }
      }
    )

    expect(result).toEqual({
      kind: 'failure',
      status: 403,
      error: { code: 'policy.denied', message: 'profile enable denied: blocked' }
    })
  })

  it('audit write failure blocks high-risk enable and leaves state unchanged', async () => {
    const deps = createDeps({
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
      profileVersion: 'm-net-default@0.1.0',
      status: 'disabled'
    })

    const result = await enableDataPlaneProfile(deps, {
      actor: 'admin',
      networkId: 'network-dataplane-orchestration-failure',
      reason: 'audit must succeed'
    })

    expect(result).toEqual({
      kind: 'failure',
      status: 503,
      error: { code: 'audit.write_failed', message: 'audit unavailable' }
    })
    expect(
      await deps.profileStore.getNetworkState('network-dataplane-orchestration-failure')
    ).toMatchObject({
      profileVersion: 'm-net-default@0.1.0',
      status: 'disabled'
    })
    expect(
      await deps.dataPlane.networkMaps.getLatest('network-dataplane-orchestration-failure')
    ).toBeNull()
  })

  it('event bus failure returns typed outcome after persistence work', async () => {
    const deps = createDeps({
      events: {
        async publish() {
          throw new Error('event bus offline')
        }
      }
    })
    await deps.profileStore.setNetworkState('network-dataplane-orchestration-failure', {
      profileVersion: 'm-net-default@0.1.0',
      status: 'disabled'
    })

    const result = await enableDataPlaneProfile(deps, {
      actor: 'admin',
      networkId: 'network-dataplane-orchestration-failure',
      reason: 'event bus failure path'
    })

    expect(result).toEqual({
      kind: 'failure',
      status: 503,
      error: { code: 'event.publish_failed', message: 'event bus offline' }
    })
    expect(
      await deps.dataPlane.networkMaps.getLatest('network-dataplane-orchestration-failure')
    ).not.toBeNull()
  })

  it('writes ISO tunnel allocation timestamps during enable orchestration', async () => {
    const base = createDeps()
    await base.profileStore.setNetworkState('network-dataplane-orchestration-failure', {
      profileVersion: 'm-net-default@0.1.0',
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
        reason: 'timestamp regression coverage'
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
    const deps = createDeps()
    await deps.profileStore.setNetworkState('network-dataplane-orchestration-failure', {
      profileVersion: 'm-net-default@0.1.0',
      status: 'disabled'
    })

    const result = await enableDataPlaneProfile(deps, {
      actor: 'admin',
      networkId: 'network-dataplane-orchestration-failure',
      reason: 'unique tunnel allocation regression'
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
    const base = createDeps()
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
        reason: 'pg failure path'
      }
    )

    expect(result).toEqual({
      kind: 'failure',
      status: 503,
      error: {
        code: 'dataplane.store_failed',
        message:
          'network_maps save failed for network-dataplane-orchestration-failure: pg write failed'
      }
    })
  })

  it('break-glass preempts ongoing migration and forces fail-closed partition state', async () => {
    const deps = createDeps()
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
