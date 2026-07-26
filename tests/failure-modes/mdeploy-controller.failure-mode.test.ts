import { describe, expect, it } from 'bun:test'
import {
  createInMemoryMDeployDeps,
  createMDeployApp,
  runtimeTestControllerFingerprint
} from '../../services/m-deploy/src/index.ts'

const digest = { algorithm: 'sha256', value: 'sha256:desired-state-001' }

function field(value: unknown, name: string): string {
  if (typeof value !== 'object' || value === null) throw new Error(`expected ${name}`)
  const candidate = Reflect.get(value, name)
  if (typeof candidate !== 'string') throw new Error(`expected ${name}`)
  return candidate
}

function property(value: unknown, name: string): unknown {
  if (typeof value !== 'object' || value === null) throw new Error(`expected ${name}`)
  return Reflect.get(value, name)
}

async function postJson(
  app: ReturnType<typeof createMDeployApp>,
  path: string,
  token: string,
  body: unknown
) {
  return app.handle(
    new Request(`http://mdeploy.internal${path}`, {
      method: 'POST',
      headers: {
        authorization: token,
        'content-type': 'application/json',
        'x-correlation-id': 'corr-safe'
      },
      body: JSON.stringify(body)
    })
  )
}

describe('M-Deploy controller failure modes', () => {
  it('keeps last-known reporting but fails closed for a new agent reconcile while the controller is disconnected', async () => {
    const priorToken = process.env.MERISTEM_INTERNAL_TOKEN
    process.env.MERISTEM_INTERNAL_TOKEN = 'mdeploy-failure-token'

    try {
      const deps = createInMemoryMDeployDeps({
        existingPolicyApprovers: ['security-admin-2']
      })
      const app = createMDeployApp(deps)
      const internalHeaders = {
        'content-type': 'application/json',
        'x-meristem-internal-token': 'mdeploy-failure-token'
      }
      await app.handle(
        new Request('http://mdeploy.internal/internal/v0/deploy/agents/enroll', {
          method: 'POST',
          headers: internalHeaders,
          body: JSON.stringify({
            schemaVersion: 'mdeploy.agent-enrollment@0.1.0',
            agentId: 'agent-1',
            hostId: 'host-1',
            capabilities: [{ runtimeDriver: 'podman', version: '5.0.0', features: ['quadlet'] }],
            controllerTrust: {
              issuer: 'm-deploy-controller',
              audience: 'mdeploy-agent',
              publicKeyFingerprint: runtimeTestControllerFingerprint(),
              expiresAt: '2026-07-14T00:00:00.000Z'
            },
            enrolledAt: '2026-07-13T00:00:00.000Z'
          })
        })
      )
      const proposalResponse = await postJson(app, '/api/v0/deploy/proposals', 'Bearer admin', {
        sourceRef: {
          repositoryUrl: 'https://git.example/meristem/desired-state.git',
          branch: 'main',
          commit: '0123456789abcdef0123456789abcdef01234567',
          path: 'deploy/prod',
          digest,
          syncedAt: '2026-07-13T00:00:00.000Z'
        },
        diffSummary: { added: 1, changed: 1, removed: 0, summary: 'immutable image update' }
      })
      const proposalId = field(property(await proposalResponse.json(), 'proposal'), 'proposalId')
      await postJson(
        app,
        `/api/v0/deploy/proposals/${proposalId}/approve`,
        'Bearer security-admin',
        { result: 'approve' }
      )
      await postJson(app, '/api/v0/deploy/apply', 'Bearer security-admin', {
        proposalId,
        agentId: 'agent-1'
      })
      const initialReconcile = await app.handle(
        new Request('http://mdeploy.internal/internal/v0/deploy/agents/agent-1/reconcile', {
          method: 'POST',
          headers: internalHeaders
        })
      )
      expect(initialReconcile.status).toBe(200)

      deps.__testing.setControllerAvailable(false)

      const desiredState = await app.handle(
        new Request('http://mdeploy.internal/api/v0/deploy/desired-state', {
          headers: { authorization: 'Bearer operator', 'x-correlation-id': 'corr-safe-read' }
        })
      )
      expect(desiredState.status).toBe(200)
      expect(await desiredState.json()).toMatchObject({
        controllerAvailable: false,
        lastSuccessfulDigest: digest
      })

      const disconnectedReconcile = await app.handle(
        new Request('http://mdeploy.internal/internal/v0/deploy/agents/agent-1/reconcile', {
          method: 'POST',
          headers: internalHeaders
        })
      )
      expect(disconnectedReconcile.status).toBe(503)
      expect(await disconnectedReconcile.json()).toMatchObject({
        error: { code: 'deploy.controller_unavailable' }
      })
      expect(deps.__testing.runtimeApplyCount()).toBe(1)
    } finally {
      if (priorToken === undefined) delete process.env.MERISTEM_INTERNAL_TOKEN
      else process.env.MERISTEM_INTERNAL_TOKEN = priorToken
    }
  })

  it('requires a separate policy and audit chain before an agent pulls a verified rollback pointer', async () => {
    const priorToken = process.env.MERISTEM_INTERNAL_TOKEN
    process.env.MERISTEM_INTERNAL_TOKEN = 'mdeploy-rollback-token'

    try {
      const deps = createInMemoryMDeployDeps({
        existingPolicyApprovers: ['security-admin-2']
      })
      const app = createMDeployApp(deps)
      const internalHeaders = {
        'content-type': 'application/json',
        'x-meristem-internal-token': 'mdeploy-rollback-token'
      }
      await app.handle(
        new Request('http://mdeploy.internal/internal/v0/deploy/agents/enroll', {
          method: 'POST',
          headers: internalHeaders,
          body: JSON.stringify({
            schemaVersion: 'mdeploy.agent-enrollment@0.1.0',
            agentId: 'agent-rollback',
            hostId: 'host-rollback',
            capabilities: [{ runtimeDriver: 'podman', version: '5.0.0', features: ['quadlet'] }],
            controllerTrust: {
              issuer: 'm-deploy-controller',
              audience: 'mdeploy-agent',
              publicKeyFingerprint: runtimeTestControllerFingerprint(),
              expiresAt: '2026-07-14T00:00:00.000Z'
            },
            enrolledAt: '2026-07-13T00:00:00.000Z'
          })
        })
      )
      const proposed = await postJson(app, '/api/v0/deploy/proposals', 'Bearer admin', {
        sourceRef: {
          repositoryUrl: 'https://git.example/meristem/desired-state.git',
          branch: 'main',
          commit: '0123456789abcdef0123456789abcdef01234567',
          path: 'deploy/prod',
          digest,
          syncedAt: '2026-07-13T00:00:00.000Z'
        },
        diffSummary: { added: 1, changed: 1, removed: 0, summary: 'immutable image update' }
      })
      const proposalId = field(property(await proposed.json(), 'proposal'), 'proposalId')
      await postJson(
        app,
        `/api/v0/deploy/proposals/${proposalId}/approve`,
        'Bearer security-admin',
        { result: 'approve' }
      )
      await postJson(app, '/api/v0/deploy/apply', 'Bearer security-admin', {
        proposalId,
        agentId: 'agent-rollback'
      })
      await app.handle(
        new Request('http://mdeploy.internal/internal/v0/deploy/agents/agent-rollback/reconcile', {
          method: 'POST',
          headers: internalHeaders
        })
      )

      const rollback = await postJson(app, '/api/v0/deploy/rollback', 'Bearer security-admin', {
        agentId: 'agent-rollback',
        targetDigest: digest
      })
      expect(rollback.status).toBe(200)
      const rollbackBody = await rollback.json()
      expect(rollbackBody).toMatchObject({ operation: { kind: 'rollback', status: 'queued' } })

      const reconciled = await app.handle(
        new Request('http://mdeploy.internal/internal/v0/deploy/agents/agent-rollback/reconcile', {
          method: 'POST',
          headers: internalHeaders
        })
      )
      expect(reconciled.status).toBe(200)
      expect(await reconciled.json()).toMatchObject({ rollback: { status: 'succeeded' } })
      expect(deps.__testing.auditActions()).toContain('deploy.rollback')
      expect(deps.__testing.evidenceTypes()).toContain('rollback')
    } finally {
      if (priorToken === undefined) delete process.env.MERISTEM_INTERNAL_TOKEN
      else process.env.MERISTEM_INTERNAL_TOKEN = priorToken
    }
  })

  it('rejects an unsigned queued envelope locally before resolving secrets or invoking the runtime', async () => {
    const priorToken = process.env.MERISTEM_INTERNAL_TOKEN
    process.env.MERISTEM_INTERNAL_TOKEN = 'mdeploy-invalid-envelope-token'

    try {
      const deps = createInMemoryMDeployDeps({
        agentEnvelopeOverride: { schemaVersion: 'mdeploy.desired-state@0.1.0' },
        existingPolicyApprovers: ['security-admin-2']
      })
      const app = createMDeployApp(deps)
      const internalHeaders = {
        'content-type': 'application/json',
        'x-meristem-internal-token': 'mdeploy-invalid-envelope-token'
      }
      await app.handle(
        new Request('http://mdeploy.internal/internal/v0/deploy/agents/enroll', {
          method: 'POST',
          headers: internalHeaders,
          body: JSON.stringify({
            schemaVersion: 'mdeploy.agent-enrollment@0.1.0',
            agentId: 'agent-invalid',
            hostId: 'host-invalid',
            capabilities: [{ runtimeDriver: 'podman', version: '5.0.0', features: ['quadlet'] }],
            controllerTrust: {
              issuer: 'm-deploy-controller',
              audience: 'mdeploy-agent',
              publicKeyFingerprint: runtimeTestControllerFingerprint(),
              expiresAt: '2026-07-14T00:00:00.000Z'
            },
            enrolledAt: '2026-07-13T00:00:00.000Z'
          })
        })
      )
      const proposed = await postJson(app, '/api/v0/deploy/proposals', 'Bearer admin', {
        sourceRef: {
          repositoryUrl: 'https://git.example/meristem/desired-state.git',
          branch: 'main',
          commit: '0123456789abcdef0123456789abcdef01234567',
          path: 'deploy/prod',
          digest,
          syncedAt: '2026-07-13T00:00:00.000Z'
        },
        diffSummary: { added: 1, changed: 1, removed: 0, summary: 'immutable image update' }
      })
      const proposalId = field(property(await proposed.json(), 'proposal'), 'proposalId')
      await postJson(
        app,
        `/api/v0/deploy/proposals/${proposalId}/approve`,
        'Bearer security-admin',
        { result: 'approve' }
      )
      await postJson(app, '/api/v0/deploy/apply', 'Bearer security-admin', {
        proposalId,
        agentId: 'agent-invalid'
      })

      const reconcile = await app.handle(
        new Request('http://mdeploy.internal/internal/v0/deploy/agents/agent-invalid/reconcile', {
          method: 'POST',
          headers: internalHeaders
        })
      )
      expect(reconcile.status).toBe(409)
      expect(await reconcile.json()).toMatchObject({
        error: { code: 'unsigned_desired_state' }
      })
      expect(deps.__testing.secretResolutionCount()).toBe(0)
      expect(deps.__testing.runtimeApplyCount()).toBe(0)
    } finally {
      if (priorToken === undefined) delete process.env.MERISTEM_INTERNAL_TOKEN
      else process.env.MERISTEM_INTERNAL_TOKEN = priorToken
    }
  })

  it('rejects an unsigned Git envelope at the controller before it creates an apply operation', async () => {
    const priorToken = process.env.MERISTEM_INTERNAL_TOKEN
    process.env.MERISTEM_INTERNAL_TOKEN = 'mdeploy-controller-invalid-token'

    try {
      const deps = createInMemoryMDeployDeps({
        gitEnvelopeOverride: { schemaVersion: 'mdeploy.desired-state@0.1.0' },
        existingPolicyApprovers: ['security-admin-2']
      })
      const app = createMDeployApp(deps)
      await app.handle(
        new Request('http://mdeploy.internal/internal/v0/deploy/agents/enroll', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-meristem-internal-token': 'mdeploy-controller-invalid-token'
          },
          body: JSON.stringify({
            schemaVersion: 'mdeploy.agent-enrollment@0.1.0',
            agentId: 'agent-controller-invalid',
            hostId: 'host-controller-invalid',
            capabilities: [{ runtimeDriver: 'podman', version: '5.0.0', features: ['quadlet'] }],
            controllerTrust: {
              issuer: 'm-deploy-controller',
              audience: 'mdeploy-agent',
              publicKeyFingerprint: runtimeTestControllerFingerprint(),
              expiresAt: '2026-07-14T00:00:00.000Z'
            },
            enrolledAt: '2026-07-13T00:00:00.000Z'
          })
        })
      )
      const proposed = await postJson(app, '/api/v0/deploy/proposals', 'Bearer admin', {
        sourceRef: {
          repositoryUrl: 'https://git.example/meristem/desired-state.git',
          branch: 'main',
          commit: '0123456789abcdef0123456789abcdef01234567',
          path: 'deploy/prod',
          digest,
          syncedAt: '2026-07-13T00:00:00.000Z'
        },
        diffSummary: { added: 1, changed: 1, removed: 0, summary: 'immutable image update' }
      })
      const proposalId = field(property(await proposed.json(), 'proposal'), 'proposalId')
      await postJson(
        app,
        `/api/v0/deploy/proposals/${proposalId}/approve`,
        'Bearer security-admin',
        { result: 'approve' }
      )
      const apply = await postJson(app, '/api/v0/deploy/apply', 'Bearer security-admin', {
        proposalId,
        agentId: 'agent-controller-invalid'
      })
      expect(apply.status).toBe(400)
      expect(await apply.json()).toMatchObject({ error: { code: 'unsigned_desired_state' } })
      expect(deps.__testing.runtimeApplyCount()).toBe(0)
      expect(deps.__testing.evidenceTypes()).toEqual([])
    } finally {
      if (priorToken === undefined) delete process.env.MERISTEM_INTERNAL_TOKEN
      else process.env.MERISTEM_INTERNAL_TOKEN = priorToken
    }
  })

  it('fails closed before proposal persistence when policy denies or Audit is unavailable', async () => {
    const body = {
      sourceRef: {
        repositoryUrl: 'https://git.example/meristem/desired-state.git',
        branch: 'main',
        commit: '0123456789abcdef0123456789abcdef01234567',
        path: 'deploy/prod',
        digest,
        syncedAt: '2026-07-13T00:00:00.000Z'
      },
      diffSummary: { added: 1, changed: 1, removed: 0, summary: 'immutable image update' }
    }
    const deniedDeps = createInMemoryMDeployDeps({ forcePolicyResult: 'deny' })
    const denied = await postJson(
      createMDeployApp(deniedDeps),
      '/api/v0/deploy/proposals',
      'Bearer admin',
      body
    )
    expect(denied.status).toBe(403)
    expect(deniedDeps.__testing.auditActions()).toEqual([])

    const auditUnavailableDeps = createInMemoryMDeployDeps({ auditAvailable: false })
    const auditUnavailable = await postJson(
      createMDeployApp(auditUnavailableDeps),
      '/api/v0/deploy/proposals',
      'Bearer admin',
      body
    )
    expect(auditUnavailable.status).toBe(503)
    expect(auditUnavailableDeps.__testing.auditActions()).toEqual([])
  })
})
