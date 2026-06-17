import { describe, expect, it } from 'bun:test'
import { createInMemoryGlobalDefaultsStore } from '../../services/m-net/src/global-defaults-store.ts'
import { createMigrationEngine } from '../../services/m-net/src/migration-engine.ts'
import { createInMemoryProfileStore } from '../../services/m-net/src/profile-store.ts'

describe('migration engine branch coverage', () => {
  it('marks missing networks as skipped and store failures as failed', async () => {
    const profileStore = createInMemoryProfileStore()
    await profileStore.setNetworkState('net-ok', {
      profileVersion: 'm-net-default@0.1.0',
      status: 'disabled'
    })
    await profileStore.setNetworkState('net-fail', {
      profileVersion: 'm-net-default@0.1.0',
      status: 'disabled'
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
      async writeAudit() {
        return 'audit-1'
      },
      async writeFull() {}
    })

    const plan = await engine.plan({
      targetProfileVersion: 'm-net-cn@0.1.0',
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
