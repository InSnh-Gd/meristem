import { describe, expect, it } from 'bun:test'
import { createInMemoryDataPlaneStores } from '@m-net/data-plane/data-plane-store-memory.ts'
import { createMigrationEngine } from '@m-net/migration/migration-engine.ts'
import { createInMemoryGlobalDefaultsStore } from '@m-net/profile/global-defaults-store.ts'
import { createInMemoryProfileStore } from '@m-net/profile/profile-store.ts'

describe('migration engine branch coverage', () => {
  it('marks missing networks as skipped and store failures as failed', async () => {
    const profileStore = createInMemoryProfileStore()
    await profileStore.setNetworkState('net-ok', {
      profileVersion: 'm-net-cn@0.1.0',
      status: 'enabled'
    })
    await profileStore.setNetworkState('net-fail', {
      profileVersion: 'm-net-cn@0.1.0',
      status: 'enabled'
    })

    const originalSet = profileStore.setNetworkState.bind(profileStore)
    profileStore.setNetworkState = async (networkId, state) => {
      if (networkId === 'net-fail') throw new Error('boom')
      return originalSet(networkId, state)
    }

    const store = createInMemoryGlobalDefaultsStore(profileStore)
    const engine = createMigrationEngine({
      globalDefaultsStore: store,
      profileStore,
      dataPlane: createInMemoryDataPlaneStores(),
      async writeAudit() {
        return 'audit-1'
      },
      async writeFull() {}
    })

    const plan = await engine.plan({
      targetProfileVersion: 'm-net-cn@0.3.0',
      batchSize: 3,
      reason: 'coverage',
      idempotencyKey: 'idem-migration-1'
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    const op = await store.getSwitchOperation(plan.value.operationId)
    expect(op).not.toBeNull()
    if (!op) return
    op.batches[0]?.networkIds.push('net-missing')

    const result = await engine.apply(plan.value.operationId, 'admin')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const missing = result.value.results.find(entry => entry.networkId === 'net-missing')
    const failed = result.value.results.find(entry => entry.networkId === 'net-fail')
    expect(missing?.status).toBe('skipped')
    expect(missing?.reason).toBe('network not found')
    expect(failed?.status).toBe('failed')
    expect(failed?.reason).toBe('internal error during apply')
  })
})
