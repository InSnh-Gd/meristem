import { describe, expect, it } from 'bun:test'
import { createCoreApp } from '../../apps/core/src/app.ts'
import { createInMemoryCoreDeps } from '../../apps/core/src/testing.ts'
import type { CoreDeps, MDeployFacadePort } from '../../apps/core/src/types.ts'
import { err, ok } from '../../packages/common/src/result.ts'
import type {
  ActorId,
  MDeployApprovalV01FromSchema,
  MDeployApplyOperationResponseFromSchema,
  MDeployDesiredStateSummaryV01FromSchema,
  MDeployOperationV01FromSchema,
  MDeployProposalV01FromSchema,
  MDeployRollbackOperationResponseFromSchema
} from '../../packages/contracts/src/index.ts'

function get(path: string, token?: string, correlationId?: string) {
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (correlationId) headers['x-correlation-id'] = correlationId
  return new Request(`http://localhost${path}`, { headers })
}

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

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status)
  const body = (await response.json()) as { error: { code: string } }
  expect(body.error.code).toBe(code)
}

const validProposalBody = {
  sourceRef: {
    repositoryUrl: 'https://git.example.com/org/meristem.git',
    branch: 'refs/heads/main',
    commit: '0123456789abcdef0123456789abcdef01234567',
    path: 'deploy/staging',
    digest: { algorithm: 'sha256', value: 'ab'.repeat(32) },
    syncedAt: '2026-07-01T00:00:00.000Z'
  },
  diffSummary: { added: 1, changed: 0, removed: 0, summary: 'bump core' }
}

const sha256Digest = { algorithm: 'sha256', value: 'cd'.repeat(32) } as const

const summaryFixture: MDeployDesiredStateSummaryV01FromSchema = {
  latestDigest: sha256Digest,
  stale: false,
  controllerAvailable: true
}

const proposalFixture: MDeployProposalV01FromSchema = {
  schemaVersion: 'mdeploy.proposal@0.1.0',
  proposalId: 'prop-1',
  sourceRef: {
    repositoryUrl: 'https://git.example.com/org/meristem.git',
    branch: 'refs/heads/main',
    commit: '0123456789abcdef0123456789abcdef01234567',
    path: 'deploy/staging',
    digest: { algorithm: 'sha256', value: 'ab'.repeat(32) },
    syncedAt: '2026-07-01T00:00:00.000Z'
  },
  diffSummary: { added: 1, changed: 0, removed: 0, summary: 'bump core' },
  actor: 'admin',
  policyDecisionId: 'pd-1',
  approvalStatus: 'pending',
  createdAt: '2026-07-01T00:00:00.000Z',
  correlationId: 'corr-proposal'
}

function approvalFixture(result: 'approve' | 'reject'): MDeployApprovalV01FromSchema {
  return {
    schemaVersion: 'mdeploy.approval@0.1.0',
    approvalId: 'approval-1',
    proposalId: 'prop-1',
    approver: 'security-admin',
    timestamp: '2026-07-01T00:00:00.000Z',
    result,
    policyDecisionId: 'pd-2',
    correlationId: 'corr-approval'
  }
}

const operationFixture: MDeployOperationV01FromSchema = {
  operationId: 'op-apply-1',
  kind: 'apply',
  proposalId: 'prop-1',
  agentId: 'agent-1',
  envelope: { schemaVersion: 'mdeploy.signed-envelope@0.1.0', payload: {} },
  desiredStateDigest: { algorithm: 'sha256', value: 'ab'.repeat(32) },
  actor: 'security-admin',
  policyDecisionId: 'pd-3',
  quorumProofId: 'qp-1',
  auditId: 'audit-1',
  correlationId: 'corr-op',
  status: 'queued',
  publicationStatus: 'pending',
  createdAt: '2026-07-01T00:00:00.000Z'
}

const applyResponseFixture: MDeployApplyOperationResponseFromSchema = {
  operation: { ...operationFixture, applyStatus: 'queued' }
}

const rollbackResponseFixture: MDeployRollbackOperationResponseFromSchema = {
  operation: { ...operationFixture, operationId: 'op-rollback-1', kind: 'rollback' }
}

type Calls = Array<{
  op: string
  context: { actor: string; bearerToken: string; correlationId: string }
  body?: unknown
  proposalId?: string
}>

function createPort(calls: Calls): MDeployFacadePort {
  return {
    async desiredState(context) {
      calls.push({ op: 'desiredState', context })
      return ok(summaryFixture)
    },
    async propose(body, context) {
      calls.push({ op: 'propose', context, body })
      return ok({ proposal: proposalFixture })
    },
    async proposal(proposalId, context) {
      calls.push({ op: 'proposal', context, proposalId })
      if (proposalId === 'missing') return ok(null)
      return ok({ proposal: proposalFixture })
    },
    async approve(proposalId, body, context) {
      calls.push({ op: 'approve', context, body, proposalId })
      const result =
        typeof body === 'object' && body !== null && 'result' in body && body.result === 'reject'
          ? 'reject'
          : 'approve'
      return ok({ approval: approvalFixture(result) })
    },
    async apply(body, context) {
      calls.push({ op: 'apply', context, body })
      return ok(applyResponseFixture)
    },
    async rollback(body, context) {
      calls.push({ op: 'rollback', context, body })
      return ok(rollbackResponseFixture)
    },
    async drift(context) {
      calls.push({ op: 'drift', context })
      return ok({ reports: [] })
    },
    async driftCheck(context) {
      calls.push({ op: 'driftCheck', context })
      return ok({ requested: true as const, correlationId: context.correlationId })
    },
    async evidence(context) {
      calls.push({ op: 'evidence', context })
      return ok({ evidence: [] })
    },
    async agents(context) {
      calls.push({ op: 'agents', context })
      return ok({ agents: [] })
    }
  }
}

function createApp(actor: ActorId = 'admin', withPort = true) {
  const calls: Calls = []
  const deps = createInMemoryCoreDeps({ actor }) as CoreDeps
  if (withPort) deps.mDeploy = createPort(calls)
  return { app: createCoreApp(deps), calls }
}

describe('Core deploy facade contract', () => {
  it('returns 503 on every route when the M-Deploy port is not wired', async () => {
    const { app } = createApp('security-admin', false)
    await expectError(
      await app.handle(get('/api/v0/deploy/desired-state', 'admin-token')),
      503,
      'feature.unavailable'
    )
    await expectError(
      await app.handle(post('/api/v0/deploy/proposals', 'admin-token', validProposalBody)),
      503,
      'feature.unavailable'
    )
    await expectError(
      await app.handle(post('/api/v0/deploy/apply', 'admin-token', { proposalId: 'p', agentId: 'a' })),
      503,
      'feature.unavailable'
    )
    await expectError(
      await app.handle(post('/api/v0/deploy/rollback', 'admin-token', {
        agentId: 'a',
        targetDigest: { algorithm: 'sha256', value: 'ab'.repeat(32) }
      })),
      503,
      'feature.unavailable'
    )
    await expectError(
      await app.handle(get('/api/v0/deploy/agents', 'admin-token')),
      503,
      'feature.unavailable'
    )
  })

  it('passes through desired-state with actor, bearer token and correlation id', async () => {
    const { app, calls } = createApp('admin')
    const response = await app.handle(get('/api/v0/deploy/desired-state', 'admin-token', 'corr-1'))
    expect(response.status).toBe(200)
    expect((await response.json()) as unknown).toEqual(summaryFixture)
    expect(calls).toEqual([
      {
        op: 'desiredState',
        context: { actor: 'admin', bearerToken: 'admin-token', correlationId: 'corr-1' }
      }
    ])
  })

  it('rejects propose with invalid body before forwarding', async () => {
    const { app, calls } = createApp('admin')
    await expectError(
      await app.handle(post('/api/v0/deploy/proposals', 'admin-token', { sourceRef: {} })),
      400,
      'VALIDATION'
    )
    expect(calls).toEqual([])
  })

  it('forwards propose with the proposal body unchanged', async () => {
    const { app, calls } = createApp('admin')
    const response = await app.handle(
      post('/api/v0/deploy/proposals', 'admin-token', validProposalBody, 'corr-2')
    )
    expect(response.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      op: 'propose',
      body: validProposalBody,
      context: { actor: 'admin', bearerToken: 'admin-token', correlationId: 'corr-2' }
    })
  })

  it('returns 404 when the downstream proposal is missing', async () => {
    const { app } = createApp('admin')
    await expectError(
      await app.handle(get('/api/v0/deploy/proposals/missing', 'admin-token')),
      404,
      'deploy.proposal_not_found'
    )
  })

  it('denies approve to admin and allows security-admin', async () => {
    const adminApp = createApp('admin').app
    await expectError(
      await adminApp.handle(
        post('/api/v0/deploy/proposals/prop-1/approve', 'admin-token', { result: 'approve' })
      ),
      403,
      'policy.denied'
    )

    const { app: securityApp, calls } = createApp('security-admin')
    const response = await securityApp.handle(
      post('/api/v0/deploy/proposals/prop-1/approve', 'security-admin-token', { result: 'approve' })
    )
    expect(response.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      op: 'approve',
      proposalId: 'prop-1',
      context: { actor: 'security-admin', bearerToken: 'security-admin-token' }
    })
  })

  it('denies apply and rollback to admin and allows security-admin', async () => {
    const adminApp = createApp('admin').app
    await expectError(
      await adminApp.handle(
        post('/api/v0/deploy/apply', 'admin-token', { proposalId: 'prop-1', agentId: 'agent-1' })
      ),
      403,
      'policy.denied'
    )
    await expectError(
      await adminApp.handle(post('/api/v0/deploy/rollback', 'admin-token', {
        agentId: 'agent-1',
        targetDigest: { algorithm: 'sha256', value: 'ab'.repeat(32) }
      })),
      403,
      'policy.denied'
    )

    const { app: securityApp, calls } = createApp('security-admin')
    const applyResponse = await securityApp.handle(
      post('/api/v0/deploy/apply', 'security-admin-token', {
        proposalId: 'prop-1',
        agentId: 'agent-1'
      })
    )
    expect(applyResponse.status).toBe(200)
    const rollbackResponse = await securityApp.handle(
      post('/api/v0/deploy/rollback', 'security-admin-token', {
        agentId: 'agent-1',
        targetDigest: { algorithm: 'sha256', value: 'ab'.repeat(32) }
      })
    )
    expect(rollbackResponse.status).toBe(200)
    expect(calls.map(call => call.op)).toEqual(['apply', 'rollback'])
  })

  it('returns expired token authentication failures before forwarding apply', async () => {
    const { app, calls } = createApp('security-admin')
    const issueResponse = await app.handle(
      post('/api/v0/identity/tokens', 'security-admin-token', {
        actor: 'security-admin',
        ttl: '0ms',
        purpose: 'deploy-expired-token-test'
      })
    )
    expect(issueResponse.status).toBe(201)
    const { token } = (await issueResponse.json()) as { token: string }

    await expectError(
      await app.handle(
        post('/api/v0/deploy/apply', token, { proposalId: 'prop-1', agentId: 'agent-1' })
      ),
      401,
      'expired_token'
    )
    expect(calls).toEqual([])
  })

  it('maps downstream service errors into the unified error envelope', async () => {
    const calls: Calls = []
    const deps = createInMemoryCoreDeps({ actor: 'admin' }) as CoreDeps
    const port = createPort(calls)
    deps.mDeploy = {
      ...port,
      async drift(_context) {
        return err({ code: 'deploy.controller_degraded', message: 'controller unreachable' })
      }
    }
    const app = createCoreApp(deps)
    await expectError(
      await app.handle(get('/api/v0/deploy/drift', 'admin-token')),
      503,
      'deploy.controller_degraded'
    )
  })
})
