import { describe, expect, it } from 'bun:test'
import { createCoreApp } from '../../apps/core/src/app.ts'
import { createInMemoryCoreDeps } from '../../apps/core/src/testing.ts'
import type {
  ApplySwitchResponse,
  CoreDeps,
  GlobalDefaultsReaderPort,
  GlobalDefaultsWriterPort,
  PlanSwitchResponse,
  ProfileDefaultsResponse,
  ProfileSwitchWriterPort,
  ResumeSwitchResponse,
  RollbackSwitchResponse,
  SetProfileDefaultsResponse
} from '../../apps/core/src/types.ts'
import { err, ok } from '../../packages/common/src/result.ts'
import type { ActorId } from '../../packages/contracts/src/index.ts'

function post(path: string, token?: string, body?: unknown, correlationId?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  if (correlationId) headers['x-correlation-id'] = correlationId
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
}

function put(path: string, token?: string, body?: unknown, correlationId?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  if (correlationId) headers['x-correlation-id'] = correlationId
  return new Request(`http://localhost${path}`, {
    method: 'PUT',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
}

function get(path: string, token?: string, correlationId?: string) {
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (correlationId) headers['x-correlation-id'] = correlationId
  return new Request(`http://localhost${path}`, { headers })
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status)
  const body = (await response.json()) as { error: { code: string } }
  expect(body.error.code).toBe(code)
}

type Calls = Array<{
  op: string
  context: { actor: string; bearerToken: string; correlationId: string }
}>

function createPorts(calls: Calls): {
  reader: GlobalDefaultsReaderPort
  writer: GlobalDefaultsWriterPort
  switchWriter: ProfileSwitchWriterPort
} {
  const defaults: ProfileDefaultsResponse = {
    defaultProfileVersion: 'm-net@0.3.0',
    globalSwitchState: 'idle',
    updatedAt: '2026-06-17T00:00:00.000Z'
  }
  const setResponse: SetProfileDefaultsResponse = {
    operationId: 'op-default-set-1',
    policyDecisionId: 'pd-1',
    auditId: 'audit-1',
    defaultProfileVersion: 'm-net-cn@0.3.0'
  }
  const planResponse: PlanSwitchResponse = {
    operationId: 'switch-op-1',
    candidateCount: 2,
    candidates: ['net-1', 'net-2'],
    batches: [{ batchId: 1, networkIds: ['net-1', 'net-2'] }],
    globalSwitchState: 'planned'
  }
  const switchStatusResponse = {
    operationId: 'switch-op-1',
    targetProfileVersion: 'm-net-cn@0.3.0',
    reason: 'auto migration',
    batchSize: 10,
    candidateCount: 2,
    batches: [{ batchId: 1, networkIds: ['net-1', 'net-2'] }],
    completedBatchIds: [],
    currentBatchId: null,
    results: [],
    globalSwitchState: 'planned' as const,
    createdAt: '2026-06-18T00:00:00.000Z',
    updatedAt: '2026-06-18T00:00:00.000Z'
  }
  const applyResponse: ApplySwitchResponse = {
    operationId: 'switch-op-1',
    batchId: 1,
    results: [
      {
        networkId: 'net-1',
        previousProfileVersion: 'm-net-cn@0.1.0',
        targetProfileVersion: 'm-net-cn@0.3.0',
        status: 'applied',
        auditId: 'audit-apply-1',
        correlationId: 'corr-apply-1'
      }
    ],
    globalSwitchState: 'applied'
  }
  const resumeResponse: ResumeSwitchResponse = {
    operationId: 'switch-op-1',
    nextBatchId: null,
    remainingBatches: 0,
    globalSwitchState: 'applied'
  }
  const rollbackResponse: RollbackSwitchResponse = {
    operationId: 'switch-op-1',
    rollbackResults: [
      {
        networkId: 'net-1',
        previousProfileVersion: 'm-net-cn@0.3.0',
        targetProfileVersion: 'm-net-cn@0.1.0',
        status: 'rolled_back',
        correlationId: 'corr-rollback-1'
      }
    ],
    globalSwitchState: 'rolled_back'
  }

  return {
    reader: {
      requiredPermission: 'network:profile-read',
      async getDefaults(context) {
        calls.push({ op: 'getDefaults', context })
        return ok(defaults)
      }
    },
    writer: {
      requiredPermission: 'network:profile-enable',
      async setDefaults(_body, context) {
        calls.push({ op: 'setDefaults', context })
        return ok(setResponse)
      }
    },
    switchWriter: {
      readPermission: 'network:profile-read',
      planPermission: 'network:profile-enable',
      applyPermission: 'network:profile-enable',
      resumePermission: 'network:profile-enable',
      rollbackPermission: 'network:profile-enable',
      async get(_operationId, context) {
        calls.push({ op: 'get', context })
        return ok(switchStatusResponse)
      },
      async plan(_body, context) {
        calls.push({ op: 'plan', context })
        return ok(planResponse)
      },
      async apply(_operationId, context) {
        calls.push({ op: 'apply', context })
        return ok(applyResponse)
      },
      async resume(_operationId, context) {
        calls.push({ op: 'resume', context })
        return ok(resumeResponse)
      },
      async rollback(_operationId, _body, context) {
        calls.push({ op: 'rollback', context })
        return ok(rollbackResponse)
      }
    }
  }
}

function createApp(actor: ActorId = 'admin', withPorts = true) {
  const calls: Calls = []
  const deps = createInMemoryCoreDeps({ actor }) as CoreDeps
  if (withPorts) {
    const ports = createPorts(calls)
    deps.globalDefaultsReader = ports.reader
    deps.globalDefaultsWriter = ports.writer
    deps.profileSwitchWriter = ports.switchWriter
  }
  return { app: createCoreApp(deps), calls, deps }
}

describe('Core global defaults facade contract', () => {
  it('returns 503 on every route when the facade ports are not wired', async () => {
    const { app } = createApp('admin', false)
    await expectError(
      await app.handle(get('/api/v0/networks/profile-defaults')),
      503,
      'feature.unavailable'
    )
    await expectError(
      await app.handle(
        put('/api/v0/networks/profile-defaults', 'admin-token', {
          profileVersion: 'm-net-cn@0.1.0',
          reason: 'test',
          idempotencyKey: 'idem-1'
        })
      ),
      503,
      'feature.unavailable'
    )
    await expectError(
      await app.handle(get('/api/v0/networks/profile-switches/op-1', 'admin-token')),
      503,
      'feature.unavailable'
    )
    await expectError(
      await app.handle(
        post('/api/v0/networks/profile-switches/plan', 'admin-token', {
          targetProfileVersion: 'm-net-cn@0.1.0',
          reason: 'test',
          idempotencyKey: 'idem-2'
        })
      ),
      503,
      'feature.unavailable'
    )
    await expectError(
      await app.handle(post('/api/v0/networks/profile-switches/op-1/apply', 'admin-token', {})),
      503,
      'feature.unavailable'
    )
    await expectError(
      await app.handle(post('/api/v0/networks/profile-switches/op-1/resume', 'admin-token', {})),
      503,
      'feature.unavailable'
    )
    await expectError(
      await app.handle(post('/api/v0/networks/profile-switches/op-1/rollback', 'admin-token', {})),
      503,
      'feature.unavailable'
    )
  })

  it('forwards actor, bearer token, and correlation id through all wired routes', async () => {
    const correlationId = 'corr-global-facade-1'
    const { app, calls } = createApp('admin')

    const getRes = await app.handle(
      get('/api/v0/networks/profile-defaults', 'admin-token', correlationId)
    )
    expect(getRes.status).toBe(200)
    const getBody = (await getRes.json()) as ProfileDefaultsResponse
    expect(getBody.defaultProfileVersion).toBe('m-net@0.3.0')

    const putRes = await app.handle(
      put(
        '/api/v0/networks/profile-defaults',
        'admin-token',
        { profileVersion: 'm-net-cn@0.3.0', reason: 'set default', idempotencyKey: 'idem-put-1' },
        correlationId
      )
    )
    expect(putRes.status).toBe(200)

    const planRes = await app.handle(
      post(
        '/api/v0/networks/profile-switches/plan',
        'admin-token',
        {
          targetProfileVersion: 'm-net-cn@0.3.0',
          batchSize: 2,
          reason: 'plan',
          idempotencyKey: 'idem-plan-1'
        },
        correlationId
      )
    )
    expect(planRes.status).toBe(200)

    const getSwitchRes = await app.handle(
      get('/api/v0/networks/profile-switches/switch-op-1', 'admin-token', correlationId)
    )
    expect(getSwitchRes.status).toBe(200)

    const applyRes = await app.handle(
      post('/api/v0/networks/profile-switches/switch-op-1/apply', 'admin-token', {}, correlationId)
    )
    expect(applyRes.status).toBe(200)

    const resumeRes = await app.handle(
      post('/api/v0/networks/profile-switches/switch-op-1/resume', 'admin-token', {}, correlationId)
    )
    expect(resumeRes.status).toBe(200)

    const rollbackRes = await app.handle(
      post(
        '/api/v0/networks/profile-switches/switch-op-1/rollback',
        'admin-token',
        {},
        correlationId
      )
    )
    expect(rollbackRes.status).toBe(200)

    expect(calls.map(call => call.op)).toEqual([
      'getDefaults',
      'setDefaults',
      'plan',
      'get',
      'apply',
      'resume',
      'rollback'
    ])
    for (const call of calls) {
      expect(call.context.actor).toBe('admin')
      expect(call.context.bearerToken).toBe('admin-token')
      expect(call.context.correlationId).toBe(correlationId)
    }
  })

  it('fails closed on authorization before calling wired ports', async () => {
    const { app, calls } = createApp('viewer')
    const response = await app.handle(get('/api/v0/networks/profile-defaults', 'viewer-token'))
    await expectError(response, 403, 'policy.denied')
    expect(calls).toEqual([])
  })

  it('maps downstream service errors through the stable Core status mapper', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' }) as CoreDeps
    deps.globalDefaultsReader = {
      requiredPermission: 'network:profile-read',
      async getDefaults() {
        return err({ code: 'mnet.unavailable', message: 'down' })
      }
    }
    deps.globalDefaultsWriter = {
      requiredPermission: 'network:profile-enable',
      async setDefaults() {
        return err({ code: 'policy.denied', message: 'nope' })
      }
    }
    deps.profileSwitchWriter = {
      readPermission: 'network:profile-read',
      planPermission: 'network:profile-enable',
      applyPermission: 'network:profile-enable',
      resumePermission: 'network:profile-enable',
      rollbackPermission: 'network:profile-enable',
      async get() {
        return err({ code: 'network.not_found', message: 'missing' })
      },
      async plan() {
        return err({ code: 'network.not_found', message: 'missing' })
      },
      async apply() {
        return err({ code: 'network.conflict', message: 'conflict' })
      },
      async resume() {
        return err({ code: 'mnet.unavailable', message: 'down' })
      },
      async rollback() {
        return err({ code: 'network.not_found', message: 'missing' })
      }
    }

    const app = createCoreApp(deps)
    await expectError(
      await app.handle(get('/api/v0/networks/profile-defaults', 'admin-token')),
      503,
      'mnet.unavailable'
    )
    await expectError(
      await app.handle(
        put('/api/v0/networks/profile-defaults', 'admin-token', {
          profileVersion: 'm-net-cn@0.3.0',
          reason: 'set default',
          idempotencyKey: 'idem-error'
        })
      ),
      403,
      'policy.denied'
    )
    await expectError(
      await app.handle(
        post('/api/v0/networks/profile-switches/plan', 'admin-token', {
          targetProfileVersion: 'm-net-cn@0.3.0',
          reason: 'plan',
          idempotencyKey: 'idem-plan-error'
        })
      ),
      404,
      'network.not_found'
    )
    await expectError(
      await app.handle(
        post('/api/v0/networks/profile-switches/switch-op-1/apply', 'admin-token', {})
      ),
      409,
      'network.conflict'
    )
    await expectError(
      await app.handle(
        post('/api/v0/networks/profile-switches/switch-op-1/resume', 'admin-token', {})
      ),
      503,
      'mnet.unavailable'
    )
    await expectError(
      await app.handle(
        post('/api/v0/networks/profile-switches/switch-op-1/rollback', 'admin-token', {})
      ),
      404,
      'network.not_found'
    )
  })
})
