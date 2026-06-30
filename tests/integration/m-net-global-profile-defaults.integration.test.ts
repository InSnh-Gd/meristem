import { beforeEach, describe, expect, it } from 'bun:test'
import { createInMemoryProfileStore } from '../../services/m-net/src/profile-store.ts'
import { createInMemorySuspendedOperationStore } from '../../services/m-net/src/suspended-operations.ts'
import {
  bearerHeaders,
  createTestApp,
  internalToken,
  jwtSecret,
  mintTestToken
} from '../contracts/_helpers/mnet-profile-routes.ts'

/**
 * 集成测试：全局默认 Profile 与批量迁移。
 * 使用内存存储，不依赖 PostgreSQL。
 */
describe('integration: m-net global profile defaults lifecycle', () => {
  const buildApp = () =>
    createTestApp(createInMemoryProfileStore(), createInMemorySuspendedOperationStore())

  beforeEach(() => {
    process.env.MERISTEM_JWT_SECRET = jwtSecret
    process.env.MERISTEM_INTERNAL_TOKEN = internalToken
  })

  // ──── 1. 全局默认应用仅影响新网络 ──────────────────────────────────

  it('global default applies to new network only, existing networks unchanged', async () => {
    const app = buildApp()
    const token = await mintTestToken('admin')

    // 读取当前默认
    const defaultsRes = await app.handle(
      new Request('http://localhost/api/v0/networks/profile-defaults', {
        headers: bearerHeaders(token)
      })
    )
    const defaults = (await defaultsRes.json()) as { defaultProfileVersion: string }
    expect(defaults.defaultProfileVersion).toBe('m-net@0.3.0')

    // 设置 CN 为默认
    await app.handle(
      new Request('http://localhost/api/v0/networks/profile-defaults', {
        method: 'PUT',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          profileVersion: 'm-net-cn@0.3.0',
          reason: 'integration test: set CN default',
          idempotencyKey: crypto.randomUUID()
        })
      })
    )

    // 验证默认已更新
    const updatedRes = await app.handle(
      new Request('http://localhost/api/v0/networks/profile-defaults', {
        headers: bearerHeaders(token)
      })
    )
    const updated = (await updatedRes.json()) as { defaultProfileVersion: string }
    expect(updated.defaultProfileVersion).toBe('m-net-cn@0.3.0')
  })

  // ──── 2. 批量迁移 plan → apply → rollback 流程 ──────────────────────

  it('batch migration is rollback-capable', async () => {
    const store = createInMemoryProfileStore()
    const app = createTestApp(store, createInMemorySuspendedOperationStore())
    const token = await mintTestToken('admin')

    // 预先创建一些网络状态
    const networks = [
      { id: `net-${crypto.randomUUID()}`, version: 'm-net-cn@0.1.0', status: 'disabled' },
      { id: `net-${crypto.randomUUID()}`, version: 'm-net-cn@0.1.0', status: 'disabled' }
    ] as const

    for (const n of networks) {
      await store.setNetworkState(n.id, { profileVersion: n.version, status: n.status })
    }

    // Plan migration
    const planRes = await app.handle(
      new Request('http://localhost/api/v0/networks/profile-switches/plan', {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          targetProfileVersion: 'm-net-cn@0.3.0',
          batchSize: 2,
          reason: 'integration test: fleet migration',
          idempotencyKey: crypto.randomUUID()
        })
      })
    )
    expect(planRes.status).toBe(200)
    const planBody = (await planRes.json()) as {
      operationId: string
      candidateCount: number
      batches: Array<{ batchId: number; networkIds: string[] }>
      globalSwitchState: string
    }
    expect(planBody.candidateCount).toBe(2)
    expect(planBody.batches.length).toBeGreaterThanOrEqual(1)
    expect(planBody.globalSwitchState).toBe('planned')

    // Apply batch
    const applyRes = await app.handle(
      new Request(
        `http://localhost/api/v0/networks/profile-switches/${planBody.operationId}/apply`,
        {
          method: 'POST',
          headers: bearerHeaders(token),
          body: JSON.stringify({})
        }
      )
    )
    expect(applyRes.status).toBe(200)
    const applyBody = (await applyRes.json()) as {
      operationId: string
      results: Array<{
        networkId: string
        status: string
        previousProfileVersion: string
        targetProfileVersion: string
      }>
    }

    // 验证所有网络都被应用了
    for (const result of applyBody.results) {
      expect(result.status).toBe('applied')
      expect(result.targetProfileVersion).toBe('m-net-cn@0.3.0')
      expect(result.previousProfileVersion).toBe('m-net-cn@0.1.0')
    }

    // 验证迁移后网络状态
    for (const n of networks) {
      const state = await store.getNetworkState(n.id)
      expect(state?.profileVersion).toBe('m-net-cn@0.3.0')
    }

    // Rollback
    const rollbackRes = await app.handle(
      new Request(
        `http://localhost/api/v0/networks/profile-switches/${planBody.operationId}/rollback`,
        {
          method: 'POST',
          headers: bearerHeaders(token),
          body: JSON.stringify({ reason: 'integration test: rollback' })
        }
      )
    )
    expect(rollbackRes.status).toBe(200)
    const rollbackBody = (await rollbackRes.json()) as {
      operationId: string
      rollbackResults: Array<{ networkId: string; status: string }>
      globalSwitchState: string
    }
    expect(rollbackBody.globalSwitchState).toBe('rolled_back')

    // 验证回滚后网络状态恢复
    for (const n of networks) {
      const state = await store.getNetworkState(n.id)
      expect(state?.profileVersion).toBe('m-net-cn@0.1.0')
    }

    // 验证所有回滚结果
    for (const result of rollbackBody.rollbackResults) {
      expect(result.status).toBe('rolled_back')
    }
  })

  // ──── 3. 批量迁移可恢复 ────────────────────────────────────────────

  it('batch migration is resumable', async () => {
    const store = createInMemoryProfileStore()
    const app = createTestApp(store, createInMemorySuspendedOperationStore())
    const token = await mintTestToken('admin')

    // 创建网络
    const netA = `net-a-${crypto.randomUUID()}`
    const netB = `net-b-${crypto.randomUUID()}`

    await store.setNetworkState(netA, { profileVersion: 'm-net-cn@0.1.0', status: 'disabled' })
    await store.setNetworkState(netB, { profileVersion: 'm-net-cn@0.1.0', status: 'disabled' })

    // Plan with batchSize=1
    const planRes = await app.handle(
      new Request('http://localhost/api/v0/networks/profile-switches/plan', {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          targetProfileVersion: 'm-net-cn@0.3.0',
          batchSize: 1,
          reason: 'integration test: resumable migration',
          idempotencyKey: crypto.randomUUID()
        })
      })
    )
    expect(planRes.status).toBe(200)
    const planBody = (await planRes.json()) as {
      operationId: string
      batches: Array<{ batchId: number; networkIds: string[] }>
    }
    expect(planBody.batches.length).toBe(2) // batchSize=1 means 2 batches

    // Apply first batch
    await app.handle(
      new Request(
        `http://localhost/api/v0/networks/profile-switches/${planBody.operationId}/apply`,
        {
          method: 'POST',
          headers: bearerHeaders(token),
          body: JSON.stringify({})
        }
      )
    )

    // Resume next batch
    const resumeRes = await app.handle(
      new Request(
        `http://localhost/api/v0/networks/profile-switches/${planBody.operationId}/resume`,
        {
          method: 'POST',
          headers: bearerHeaders(token),
          body: JSON.stringify({})
        }
      )
    )
    expect(resumeRes.status).toBe(200)
    const resumeBody = (await resumeRes.json()) as {
      nextBatchId: number
      remainingBatches: number
      globalSwitchState: string
    }
    expect(resumeBody.remainingBatches).toBe(0)
    // Both networks should be on CN now
    const stateA = await store.getNetworkState(netA)
    const stateB = await store.getNetworkState(netB)
    expect(stateA?.profileVersion).toBe('m-net-cn@0.3.0')
    expect(stateB?.profileVersion).toBe('m-net-cn@0.3.0')
  })

  // ──── 4. 部分失败场景 ──────────────────────────────────────────────

  it('resume skips already-applied networks', async () => {
    const store = createInMemoryProfileStore()
    const app = createTestApp(store, createInMemorySuspendedOperationStore())
    const token = await mintTestToken('admin')

    const netX = `net-x-${crypto.randomUUID()}`
    const netY = `net-y-${crypto.randomUUID()}`

    await store.setNetworkState(netX, { profileVersion: 'm-net-cn@0.1.0', status: 'disabled' })
    await store.setNetworkState(netY, { profileVersion: 'm-net-cn@0.1.0', status: 'disabled' })

    // Plan
    const planRes = await app.handle(
      new Request('http://localhost/api/v0/networks/profile-switches/plan', {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          targetProfileVersion: 'm-net-cn@0.3.0',
          batchSize: 2,
          reason: 'test skip already-applied',
          idempotencyKey: crypto.randomUUID()
        })
      })
    )
    const planBody = (await planRes.json()) as { operationId: string }

    // Manually update netX to already be on target
    await store.setNetworkState(netX, { profileVersion: 'm-net-cn@0.3.0', status: 'enabled' })

    // Apply - should skip netX, apply netY
    const applyRes = await app.handle(
      new Request(
        `http://localhost/api/v0/networks/profile-switches/${planBody.operationId}/apply`,
        {
          method: 'POST',
          headers: bearerHeaders(token),
          body: JSON.stringify({})
        }
      )
    )
    expect(applyRes.status).toBe(200)
    const applyBody = (await applyRes.json()) as {
      results: Array<{ networkId: string; status: string }>
    }

    const netXResult = applyBody.results.find(r => r.networkId === netX)
    const netYResult = applyBody.results.find(r => r.networkId === netY)
    expect(netXResult?.status).toBe('skipped')
    expect(netYResult?.status).toBe('applied')
  })

  // ──── 5. 回滚恢复先前 Profile 状态 ─────────────────────────────────

  it('rollback restores prior profile state', async () => {
    const store = createInMemoryProfileStore()
    const app = createTestApp(store, createInMemorySuspendedOperationStore())
    const token = await mintTestToken('admin')

    const networks = [
      { id: `rb-${crypto.randomUUID()}`, version: 'm-net-cn@0.1.0', status: 'disabled' },
      { id: `rb-${crypto.randomUUID()}`, version: 'm-net-cn@0.1.0', status: 'disabled' }
    ] as const

    for (const n of networks) {
      await store.setNetworkState(n.id, { profileVersion: n.version, status: n.status })
    }

    // Plan + Apply
    const planRes = await app.handle(
      new Request('http://localhost/api/v0/networks/profile-switches/plan', {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          targetProfileVersion: 'm-net-cn@0.3.0',
          batchSize: 2,
          reason: 'test rollback restore',
          idempotencyKey: crypto.randomUUID()
        })
      })
    )
    const planBody = (await planRes.json()) as { operationId: string }

    await app.handle(
      new Request(
        `http://localhost/api/v0/networks/profile-switches/${planBody.operationId}/apply`,
        {
          method: 'POST',
          headers: bearerHeaders(token),
          body: JSON.stringify({})
        }
      )
    )

    // Rollback
    await app.handle(
      new Request(
        `http://localhost/api/v0/networks/profile-switches/${planBody.operationId}/rollback`,
        {
          method: 'POST',
          headers: bearerHeaders(token),
          body: JSON.stringify({ reason: 'restore test' })
        }
      )
    )

    // All networks should be back on default
    for (const n of networks) {
      const state = await store.getNetworkState(n.id)
      expect(state?.profileVersion).toBe('m-net-cn@0.1.0')
    }
  })
})
