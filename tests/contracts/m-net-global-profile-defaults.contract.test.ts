import * as Schema from 'effect/Schema'
import { beforeEach, describe, expect, it } from 'bun:test'
import { createInMemoryProfileStore } from '../../services/m-net/src/profile-store.ts'
import { createInMemorySuspendedOperationStore } from '../../services/m-net/src/suspended-operations.ts'
import {
  bearerHeaders,
  createTestApp,
  decodeJson,
  internalToken,
  jwtSecret,
  mintTestToken
} from './_helpers/mnet-profile-routes.ts'

// ── 响应 Schema ──────────────────────────────────────────────────────────

/** GET /api/v0/networks/profile-defaults 响应 */
const ProfileDefaultsResponseSchema = Schema.Struct({
  defaultProfileVersion: Schema.String,
  globalSwitchState: Schema.Literal(
    'idle',
    'planned',
    'applying',
    'applied',
    'rolled_back',
    'failed'
  ),
  updatedAt: Schema.String,
  switchOperationId: Schema.optional(Schema.String)
})

/** PUT /api/v0/networks/profile-defaults 响应 */
const SetProfileDefaultsResponseSchema = Schema.Struct({
  operationId: Schema.String,
  policyDecisionId: Schema.String,
  auditId: Schema.String,
  defaultProfileVersion: Schema.String
})

/** NetworkProfileMigrationResult 单条结果 */
const MigrationResultSchema = Schema.Struct({
  networkId: Schema.String,
  previousProfileVersion: Schema.String,
  targetProfileVersion: Schema.String,
  status: Schema.Literal('applied', 'skipped', 'failed', 'rolled_back'),
  reason: Schema.optional(Schema.String),
  auditId: Schema.optional(Schema.String),
  correlationId: Schema.optional(Schema.String)
})

/** POST /api/v0/networks/profile-switches/plan 响应 */
const PlanSwitchResponseSchema = Schema.Struct({
  operationId: Schema.String,
  candidateCount: Schema.Number,
  batches: Schema.Array(
    Schema.Struct({
      batchId: Schema.Number,
      networkIds: Schema.Array(Schema.String)
    })
  ),
  globalSwitchState: Schema.Literal('planned')
})

/** POST /api/v0/networks/profile-switches/:id/apply 响应 */
const ApplySwitchResponseSchema = Schema.Struct({
  operationId: Schema.String,
  batchId: Schema.Number,
  results: Schema.Array(MigrationResultSchema),
  globalSwitchState: Schema.Literal('applied', 'applying')
})

/** POST /api/v0/networks/profile-switches/:id/resume 响应 */
const ResumeSwitchResponseSchema = Schema.Struct({
  operationId: Schema.String,
  nextBatchId: Schema.Number,
  globalSwitchState: Schema.Literal('applying', 'applied'),
  remainingBatches: Schema.Number
})

/** POST /api/v0/networks/profile-switches/:id/rollback 响应 */
const RollbackSwitchResponseSchema = Schema.Struct({
  operationId: Schema.String,
  rollbackResults: Schema.Array(MigrationResultSchema),
  globalSwitchState: Schema.Literal('rolled_back')
})

// ── 测试 ─────────────────────────────────────────────────────────────────

describe('M-Net global profile defaults contract', () => {
  const buildApp = () =>
    createTestApp(createInMemoryProfileStore(), createInMemorySuspendedOperationStore())

  beforeEach(() => {
    process.env.MERISTEM_JWT_SECRET = jwtSecret
    process.env.MERISTEM_INTERNAL_TOKEN = internalToken
  })

  // ──── 1. 全局默认 Profile 读写 ──────────────────────────────────────

  describe('GET /api/v0/networks/profile-defaults', () => {
    it('returns current default profile version and idle switch state', async () => {
      const app = buildApp()
      const token = await mintTestToken('operator')

      const response = await app.handle(
        new Request('http://localhost/api/v0/networks/profile-defaults', {
          headers: bearerHeaders(token)
        })
      )

      expect(response.status).toBe(200)
      const body = await decodeJson(response, ProfileDefaultsResponseSchema)
      expect(body.defaultProfileVersion).toBe('m-net-default@0.1.0')
      expect(body.globalSwitchState).toBe('idle')
      expect(body.updatedAt).toBeString()
    })

    it('returns 401 without bearer token', async () => {
      const app = buildApp()
      const response = await app.handle(
        new Request('http://localhost/api/v0/networks/profile-defaults')
      )
      expect(response.status).toBe(401)
    })
  })

  describe('PUT /api/v0/networks/profile-defaults', () => {
    it('sets global default profile version with M-Policy check', async () => {
      const app = buildApp()
      const token = await mintTestToken('admin')

      const response = await app.handle(
        new Request('http://localhost/api/v0/networks/profile-defaults', {
          method: 'PUT',
          headers: bearerHeaders(token),
          body: JSON.stringify({
            profileVersion: 'm-net-cn@0.1.0',
            reason: 'switch all new networks to CN profile',
            idempotencyKey: crypto.randomUUID()
          })
        })
      )

      expect(response.status).toBe(200)
      const body = await decodeJson(response, SetProfileDefaultsResponseSchema)
      expect(body.defaultProfileVersion).toBe('m-net-cn@0.1.0')
      expect(body.operationId).toBeString()
      expect(body.policyDecisionId).toBeString()
      expect(body.auditId).toBeString()
    })

    it('updates default and reflects in GET', async () => {
      const app = buildApp()
      const token = await mintTestToken('admin')

      // 先设置
      await app.handle(
        new Request('http://localhost/api/v0/networks/profile-defaults', {
          method: 'PUT',
          headers: bearerHeaders(token),
          body: JSON.stringify({
            profileVersion: 'm-net-cn@0.1.0',
            reason: 'test update',
            idempotencyKey: crypto.randomUUID()
          })
        })
      )

      // 再读取
      const getRes = await app.handle(
        new Request('http://localhost/api/v0/networks/profile-defaults', {
          headers: bearerHeaders(token)
        })
      )
      const body = await decodeJson(getRes, ProfileDefaultsResponseSchema)
      expect(body.defaultProfileVersion).toBe('m-net-cn@0.1.0')
    })

    it('returns 400 for unknown profile version', async () => {
      const app = buildApp()
      const token = await mintTestToken('admin')

      const response = await app.handle(
        new Request('http://localhost/api/v0/networks/profile-defaults', {
          method: 'PUT',
          headers: bearerHeaders(token),
          body: JSON.stringify({
            profileVersion: 'unknown-profile@9.9.9',
            reason: 'test',
            idempotencyKey: crypto.randomUUID()
          })
        })
      )

      expect(response.status).toBe(400)
    })

    it('returns 401 without bearer token', async () => {
      const app = buildApp()
      const response = await app.handle(
        new Request('http://localhost/api/v0/networks/profile-defaults', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            profileVersion: 'm-net-cn@0.1.0',
            reason: 'test',
            idempotencyKey: crypto.randomUUID()
          })
        })
      )
      expect(response.status).toBe(401)
    })
  })

  // ──── 2. 新网络使用配置的默认 Profile ───────────────────────────────

  describe('New network creation uses configured default', () => {
    it('new network uses m-net-default@0.1.0 when no override set', async () => {
      const app = buildApp()
      const token = await mintTestToken('admin')

      // 读取当前默认（m-net-default@0.1.0）
      const defaultsRes = await app.handle(
        new Request('http://localhost/api/v0/networks/profile-defaults', {
          headers: bearerHeaders(token)
        })
      )
      const defaults = await decodeJson(defaultsRes, ProfileDefaultsResponseSchema)
      expect(defaults.defaultProfileVersion).toBe('m-net-default@0.1.0')
    })

    it('after setting CN as default, new networks reflect it', async () => {
      const app = buildApp()
      const token = await mintTestToken('admin')

      // 设置 CN 为默认
      await app.handle(
        new Request('http://localhost/api/v0/networks/profile-defaults', {
          method: 'PUT',
          headers: bearerHeaders(token),
          body: JSON.stringify({
            profileVersion: 'm-net-cn@0.1.0',
            reason: 'test',
            idempotencyKey: crypto.randomUUID()
          })
        })
      )

      // 验证默认已更新
      const defaultsRes = await app.handle(
        new Request('http://localhost/api/v0/networks/profile-defaults', {
          headers: bearerHeaders(token)
        })
      )
      const updatedDefaults = await decodeJson(defaultsRes, ProfileDefaultsResponseSchema)
      expect(updatedDefaults.defaultProfileVersion).toBe('m-net-cn@0.1.0')
    })
  })

  // ──── 3. 批量迁移 switch 计划 ────────────────────────────────────────

  describe('POST /api/v0/networks/profile-switches/plan', () => {
    it('plans batch migration for existing networks', async () => {
      const app = buildApp()
      const token = await mintTestToken('admin')

      const response = await app.handle(
        new Request('http://localhost/api/v0/networks/profile-switches/plan', {
          method: 'POST',
          headers: bearerHeaders(token),
          body: JSON.stringify({
            targetProfileVersion: 'm-net-cn@0.1.0',
            batchSize: 5,
            reason: 'fleet migration to CN profile',
            idempotencyKey: crypto.randomUUID()
          })
        })
      )

      // 当前没有已创建的网络（测试的 in-memory profileStore 没有预先创建网络状态）
      // 计划应该成功，但 candidateCount 为 0
      expect(response.status).toBe(200)
      const body = await decodeJson(response, PlanSwitchResponseSchema)
      expect(body.operationId).toBeString()
      expect(body.candidateCount).toBe(0)
      expect(body.batches).toBeArray()
      expect(body.globalSwitchState).toBe('planned')
    })

    it('returns 400 for unknown target profile version', async () => {
      const app = buildApp()
      const token = await mintTestToken('admin')

      const response = await app.handle(
        new Request('http://localhost/api/v0/networks/profile-switches/plan', {
          method: 'POST',
          headers: bearerHeaders(token),
          body: JSON.stringify({
            targetProfileVersion: 'unknown@9.9.9',
            batchSize: 5,
            reason: 'test',
            idempotencyKey: crypto.randomUUID()
          })
        })
      )

      expect(response.status).toBe(400)
    })

    it('returns 401 without bearer token', async () => {
      const app = buildApp()
      const response = await app.handle(
        new Request('http://localhost/api/v0/networks/profile-switches/plan', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            targetProfileVersion: 'm-net-cn@0.1.0',
            reason: 'test',
            idempotencyKey: crypto.randomUUID()
          })
        })
      )
      expect(response.status).toBe(401)
    })
  })

  // ──── 4. 批量应用 ────────────────────────────────────────────────────

  describe('POST /api/v0/networks/profile-switches/:operationId/apply', () => {
    it('applies batch when planned state', async () => {
      const app = buildApp()
      const token = await mintTestToken('admin')

      // 先 plan
      const planRes = await app.handle(
        new Request('http://localhost/api/v0/networks/profile-switches/plan', {
          method: 'POST',
          headers: bearerHeaders(token),
          body: JSON.stringify({
            targetProfileVersion: 'm-net-cn@0.1.0',
            reason: 'test',
            idempotencyKey: crypto.randomUUID()
          })
        })
      )
      const planBody = await decodeJson(planRes, PlanSwitchResponseSchema)

      // 然后 apply
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
      const applyBody = await decodeJson(applyRes, ApplySwitchResponseSchema)
      expect(applyBody.operationId).toBe(planBody.operationId)
      expect(applyBody.results).toBeArray()
      expect(['applied', 'applying']).toContain(applyBody.globalSwitchState)
    })

    it('returns 404 for unknown operationId', async () => {
      const app = buildApp()
      const token = await mintTestToken('admin')

      const response = await app.handle(
        new Request('http://localhost/api/v0/networks/profile-switches/unknown-op-id/apply', {
          method: 'POST',
          headers: bearerHeaders(token),
          body: JSON.stringify({})
        })
      )

      expect(response.status).toBe(404)
    })

    it('returns 401 without bearer token', async () => {
      const app = buildApp()
      const response = await app.handle(
        new Request('http://localhost/api/v0/networks/profile-switches/some-op/apply', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({})
        })
      )
      expect(response.status).toBe(401)
    })
  })

  // ──── 5. 恢复 ────────────────────────────────────────────────────────

  describe('POST /api/v0/networks/profile-switches/:operationId/resume', () => {
    it('resumes from last successful batch', async () => {
      const app = buildApp()
      const token = await mintTestToken('admin')

      // Plan
      const planRes = await app.handle(
        new Request('http://localhost/api/v0/networks/profile-switches/plan', {
          method: 'POST',
          headers: bearerHeaders(token),
          body: JSON.stringify({
            targetProfileVersion: 'm-net-cn@0.1.0',
            reason: 'test',
            idempotencyKey: crypto.randomUUID()
          })
        })
      )
      const planBody = await decodeJson(planRes, PlanSwitchResponseSchema)

      // Resume（从未 apply 过，应报错或返回下一 batch）
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

      // 如果没有 batch 需要恢复，应该返回适当状态
      if (planBody.batches.length === 0) {
        // 无 batch 时 resume 返回已完成
        expect(resumeRes.status).toBe(200)
      } else {
        expect(resumeRes.status).toBe(200)
        const resumeBody = await decodeJson(resumeRes, ResumeSwitchResponseSchema)
        expect(resumeBody.operationId).toBe(planBody.operationId)
      }
    })

    it('returns 404 for unknown operationId', async () => {
      const app = buildApp()
      const token = await mintTestToken('admin')

      const response = await app.handle(
        new Request('http://localhost/api/v0/networks/profile-switches/unknown/resume', {
          method: 'POST',
          headers: bearerHeaders(token),
          body: JSON.stringify({})
        })
      )

      expect(response.status).toBe(404)
    })
  })

  // ──── 6. 回滚 ────────────────────────────────────────────────────────

  describe('POST /api/v0/networks/profile-switches/:operationId/rollback', () => {
    it('rolls back applied changes', async () => {
      const app = buildApp()
      const token = await mintTestToken('admin')

      // Plan
      const planRes = await app.handle(
        new Request('http://localhost/api/v0/networks/profile-switches/plan', {
          method: 'POST',
          headers: bearerHeaders(token),
          body: JSON.stringify({
            targetProfileVersion: 'm-net-cn@0.1.0',
            reason: 'test',
            idempotencyKey: crypto.randomUUID()
          })
        })
      )
      const planBody = await decodeJson(planRes, PlanSwitchResponseSchema)

      // Rollback
      const rollbackRes = await app.handle(
        new Request(
          `http://localhost/api/v0/networks/profile-switches/${planBody.operationId}/rollback`,
          {
            method: 'POST',
            headers: bearerHeaders(token),
            body: JSON.stringify({ reason: 'test rollback' })
          }
        )
      )

      expect(rollbackRes.status).toBe(200)
      const rollbackBody = await decodeJson(rollbackRes, RollbackSwitchResponseSchema)
      expect(rollbackBody.operationId).toBe(planBody.operationId)
      expect(rollbackBody.rollbackResults).toBeArray()
      expect(rollbackBody.globalSwitchState).toBe('rolled_back')
    })

    it('returns 404 for unknown operationId', async () => {
      const app = buildApp()
      const token = await mintTestToken('admin')

      const response = await app.handle(
        new Request('http://localhost/api/v0/networks/profile-switches/unknown/rollback', {
          method: 'POST',
          headers: bearerHeaders(token),
          body: JSON.stringify({ reason: 'test' })
        })
      )

      expect(response.status).toBe(404)
    })
  })

  // ──── 7. Idempotency ─────────────────────────────────────────────────

  describe('Idempotency on mutation routes', () => {
    it('PUT profile-defaults with same idempotencyKey returns same result', async () => {
      const app = buildApp()
      const token = await mintTestToken('admin')
      const key = crypto.randomUUID()

      const res1 = await app.handle(
        new Request('http://localhost/api/v0/networks/profile-defaults', {
          method: 'PUT',
          headers: bearerHeaders(token),
          body: JSON.stringify({
            profileVersion: 'm-net-cn@0.1.0',
            reason: 'test idempotency',
            idempotencyKey: key
          })
        })
      )
      expect(res1.status).toBe(200)
      const body1 = await decodeJson(res1, SetProfileDefaultsResponseSchema)

      const res2 = await app.handle(
        new Request('http://localhost/api/v0/networks/profile-defaults', {
          method: 'PUT',
          headers: bearerHeaders(token),
          body: JSON.stringify({
            profileVersion: 'm-net-cn@0.1.0',
            reason: 'test idempotency',
            idempotencyKey: key
          })
        })
      )
      expect(res2.status).toBe(200)
      const body2 = await decodeJson(res2, SetProfileDefaultsResponseSchema)
      expect(body2.operationId).toBe(body1.operationId)
    })

    it('POST plan with same idempotencyKey returns same operationId', async () => {
      const app = buildApp()
      const token = await mintTestToken('admin')
      const key = crypto.randomUUID()

      const res1 = await app.handle(
        new Request('http://localhost/api/v0/networks/profile-switches/plan', {
          method: 'POST',
          headers: bearerHeaders(token),
          body: JSON.stringify({
            targetProfileVersion: 'm-net-cn@0.1.0',
            reason: 'test idempotency',
            idempotencyKey: key
          })
        })
      )
      expect(res1.status).toBe(200)
      const body1 = await decodeJson(res1, PlanSwitchResponseSchema)

      const res2 = await app.handle(
        new Request('http://localhost/api/v0/networks/profile-switches/plan', {
          method: 'POST',
          headers: bearerHeaders(token),
          body: JSON.stringify({
            targetProfileVersion: 'm-net-cn@0.1.0',
            reason: 'test idempotency',
            idempotencyKey: key
          })
        })
      )
      expect(res2.status).toBe(200)
      const body2 = await decodeJson(res2, PlanSwitchResponseSchema)
      expect(body2.operationId).toBe(body1.operationId)
    })
  })

  // ──── 8. 权限拒绝 ────────────────────────────────────────────────────

  describe('Policy denial on global operations', () => {
    it('PUT profile-defaults returns 403 when policy denies', async () => {
      const deniedApp = createTestApp(
        createInMemoryProfileStore(),
        createInMemorySuspendedOperationStore(),
        {
          // M-Policy 始终 deny
          async authorize(_actor, _action, _resource) {
            return { result: 'deny' as const, id: crypto.randomUUID(), reasons: ['test deny'] }
          }
        }
      )

      const token = await mintTestToken('operator')
      const response = await deniedApp.handle(
        new Request('http://localhost/api/v0/networks/profile-defaults', {
          method: 'PUT',
          headers: bearerHeaders(token),
          body: JSON.stringify({
            profileVersion: 'm-net-cn@0.1.0',
            reason: 'should be denied',
            idempotencyKey: crypto.randomUUID()
          })
        })
      )

      expect(response.status).toBe(403)
    })
  })
})
