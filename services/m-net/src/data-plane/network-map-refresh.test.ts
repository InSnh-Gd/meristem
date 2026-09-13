import { describe, expect, it } from 'bun:test'
import type { MNetProfileVersionFromSchema } from '../../../../packages/contracts/src/schemas/mnet-profile.ts'
import type { MaterializedMembers } from './mnet-dataplane-support.ts'
import { type NetworkMapRefreshDeps, refreshNetworkMap } from './network-map-refresh.ts'

const materialized: MaterializedMembers = {
  relayAssignment: { nodeId: 'stem-1', relayEndpoint: 'relay.example:443', relayType: 'direct' },
  mapVersion: 7
}

function createDeps(overrides: Partial<NetworkMapRefreshDeps> = {}) {
  const published: Array<{ subject: string; payload: unknown; correlationId?: string }> = []
  const calls: { materialize: number } = { materialize: 0 }
  const deps: NetworkMapRefreshDeps = {
    profileStore: {
      async getNetworkState() {
        return {
          networkId: 'network-1',
          profileVersion: 'm-net@0.3.0',
          status: 'enabled',
          updatedAt: new Date().toISOString()
        }
      }
    },
    listMembers: async () => ({
      ok: true,
      value: [
        {
          networkId: 'network-1',
          nodeId: 'stem-1',
          nodeKind: 'stem',
          membershipMode: 'full',
          status: 'joined',
          joinedAt: new Date().toISOString()
        }
      ]
    }),
    materialize: async (_pv: MNetProfileVersionFromSchema, _cid: string) => {
      calls.materialize += 1
      return materialized
    },
    events: {
      async publish(subject, _type, payload, correlationId) {
        published.push({ subject, payload, ...(correlationId ? { correlationId } : {}) })
      }
    },
    ...overrides
  }
  return { deps, published, calls }
}

describe('refreshNetworkMap', () => {
  it('materializes and publishes network_map.published on a non-empty member set', async () => {
    const { deps, published, calls } = createDeps()

    const refreshed = await refreshNetworkMap(deps, 'network-1', 'corr-1')

    expect(refreshed).toBe(true)
    expect(calls.materialize).toBe(1)
    expect(published).toHaveLength(1)
    expect(published[0]?.subject).toBe('mnet.network_map.published.v0')
    expect(published[0]?.payload).toMatchObject({ networkId: 'network-1', mapVersion: 7 })
  })

  it('propagates the caller correlationId into the published payload and envelope', async () => {
    // Core 审计与 M-Net 事件必须共享同一条链路 id：removeMember 透传的 correlationId
    // 不能被 map 刷新路径丢弃或替换成本地随机值。
    const { deps, published } = createDeps()

    await refreshNetworkMap(deps, 'network-1', 'corr-from-caller')

    expect(published).toHaveLength(1)
    expect(published[0]?.payload).toMatchObject({ correlationId: 'corr-from-caller' })
    expect(published[0]?.correlationId).toBe('corr-from-caller')
  })

  it('is a no-op on an empty member set (legal last-member removal must not fail)', async () => {
    const { deps, published, calls } = createDeps({
      listMembers: async () => ({ ok: true, value: [] })
    })

    const refreshed = await refreshNetworkMap(deps, 'network-1', 'corr-1')

    expect(refreshed).toBe(false)
    expect(calls.materialize).toBe(0)
    expect(published).toHaveLength(0)
  })

  it('is a no-op when materialization fails instead of surfacing an error', async () => {
    const { deps, published } = createDeps({ materialize: async () => null })

    const refreshed = await refreshNetworkMap(deps, 'network-1', 'corr-1')

    expect(refreshed).toBe(false)
    expect(published).toHaveLength(0)
  })

  it('skips when the stored profile version cannot be narrowed', async () => {
    const { deps, calls } = createDeps({
      profileStore: {
        async getNetworkState() {
          return {
            networkId: 'network-1',
            profileVersion: 'unknown@9.9.9',
            status: 'enabled',
            updatedAt: new Date().toISOString()
          }
        }
      }
    })

    const refreshed = await refreshNetworkMap(deps, 'network-1', 'corr-1')

    expect(refreshed).toBe(false)
    expect(calls.materialize).toBe(0)
  })

  it('is a no-op (not a throw) when event publish fails after materialization', async () => {
    // 回归：事件发布失败此前会外抛，使已提交的成员移除被翻成 500/503 且无补发路径。
    // map 已物化并持久化，事件属 at-least-once 语义，应降级为 no-op + 告警。
    const { deps } = createDeps({
      events: {
        async publish() {
          throw new Error('eventbus offline')
        }
      }
    })

    const refreshed = await refreshNetworkMap(deps, 'network-1', 'corr-1')

    expect(refreshed).toBe(false)
  })
})
