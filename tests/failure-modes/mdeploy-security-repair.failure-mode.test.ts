import { describe, expect, it } from 'bun:test'
import { err } from '../../packages/common/src/result.ts'
import type { ActorId } from '../../packages/contracts/src/index.ts'
import {
  createInMemoryMDeployDeps,
  createMDeployApp,
  runtimeTestControllerFingerprint
} from '../../services/m-deploy/src/index.ts'

const digest = { algorithm: 'sha256', value: 'sha256:desired-state-001' } as const
const now = '2026-07-13T00:05:00.000Z'

function forgedEnvelope() {
  return {
    schemaVersion: 'mdeploy.signed-envelope@0.1.0',
    payload: {
      schemaVersion: 'mdeploy.desired-state@0.1.0',
      source: {
        repositoryUrl: 'https://git.example/meristem/desired-state.git',
        branch: 'main',
        commit: '0123456789abcdef0123456789abcdef01234567',
        path: 'deploy/prod',
        digest,
        syncedAt: now
      },
      runtime: { driver: 'podman', iacDriver: 'opentofu', targetScope: ['production'] },
      topology: {
        topologyId: 'production-vm-topology',
        revision: 'topology-1',
        nodes: [{ nodeId: 'node-1', hostId: 'host-1', role: 'worker', runtimeDriver: 'podman' }]
      },
      services: [
        {
          serviceId: 'm-ui',
          image: { image: 'registry.example/meristem/m-ui', digest },
          config: {
            OIDC_CLIENT_SECRET: {
              kind: 'secretRef',
              secretRef: {
                provider: 'vault-kv-v2',
                keyPath: 'secret/data/mdeploy/oidc',
                version: 1
              }
            }
          },
          secretRefs: [{ provider: 'vault-kv-v2', keyPath: 'secret/data/mdeploy/oidc', version: 1 }]
        }
      ],
      generatedAt: now
    },
    signature: {
      algorithm: 'ed25519',
      value: 'attacker-controlled-nonempty-signature',
      payloadDigest: digest
    },
    signer: { kind: 'mdeploy-controller', identity: 'm-deploy-controller' },
    issuedAt: now,
    expiresAt: '2026-07-13T00:20:00.000Z',
    verification: { verified: true, verifiedAt: now, verifier: 'attacker-controlled-verifier' }
  }
}

async function enrollAgent(
  app: ReturnType<typeof createMDeployApp>,
  internalToken: string,
  agentId: string
) {
  return app.handle(
    new Request('http://mdeploy.internal/internal/v0/deploy/agents/enroll', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-meristem-internal-token': internalToken
      },
      body: JSON.stringify({
        schemaVersion: 'mdeploy.agent-enrollment@0.1.0',
        agentId,
        hostId: `host-${agentId}`,
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
}

async function scheduleApprovedApply(app: ReturnType<typeof createMDeployApp>, agentId: string) {
  const proposed = await app.handle(
    new Request('http://mdeploy.internal/api/v0/deploy/proposals', {
      method: 'POST',
      headers: {
        authorization: 'Bearer admin',
        'content-type': 'application/json',
        'x-correlation-id': 'corr-trust-repair'
      },
      body: JSON.stringify({
        sourceRef: {
          repositoryUrl: 'https://git.example/meristem/desired-state.git',
          branch: 'main',
          commit: '0123456789abcdef0123456789abcdef01234567',
          path: 'deploy/prod',
          digest,
          syncedAt: '2026-07-13T00:00:00.000Z'
        },
        diffSummary: { added: 1, changed: 1, removed: 0, summary: 'trust repair test' }
      })
    })
  )
  const proposedBody = await proposed.json()
  if (typeof proposedBody !== 'object' || proposedBody === null) throw new Error('missing proposal')
  const proposal = Reflect.get(proposedBody, 'proposal')
  if (typeof proposal !== 'object' || proposal === null) throw new Error('missing proposal')
  const proposalId = Reflect.get(proposal, 'proposalId')
  if (typeof proposalId !== 'string') throw new Error('missing proposal id')

  await app.handle(
    new Request(`http://mdeploy.internal/api/v0/deploy/proposals/${proposalId}/approve`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer security-admin',
        'content-type': 'application/json',
        'x-correlation-id': 'corr-trust-repair'
      },
      body: JSON.stringify({ result: 'approve' })
    })
  )

  return app.handle(
    new Request('http://mdeploy.internal/api/v0/deploy/apply', {
      method: 'POST',
      headers: {
        authorization: 'Bearer security-admin',
        'content-type': 'application/json',
        'x-correlation-id': 'corr-trust-repair'
      },
      body: JSON.stringify({ proposalId, agentId })
    })
  )
}

async function createProposal(
  app: ReturnType<typeof createMDeployApp>,
  actor: 'admin' | 'security-admin'
): Promise<string> {
  const proposed = await app.handle(
    new Request('http://mdeploy.internal/api/v0/deploy/proposals', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${actor}`,
        'content-type': 'application/json',
        'x-correlation-id': 'corr-quorum-repair'
      },
      body: JSON.stringify({
        sourceRef: {
          repositoryUrl: 'https://git.example/meristem/desired-state.git',
          branch: 'main',
          commit: '0123456789abcdef0123456789abcdef01234567',
          path: 'deploy/prod',
          digest,
          syncedAt: '2026-07-13T00:00:00.000Z'
        },
        diffSummary: { added: 1, changed: 1, removed: 0, summary: 'quorum repair test' }
      })
    })
  )
  const body = await proposed.json()
  if (typeof body !== 'object' || body === null) throw new Error('missing proposal')
  const proposal = Reflect.get(body, 'proposal')
  if (typeof proposal !== 'object' || proposal === null) throw new Error('missing proposal')
  const proposalId = Reflect.get(proposal, 'proposalId')
  if (typeof proposalId !== 'string') throw new Error('missing proposal id')
  return proposalId
}

async function approveProposal(
  app: ReturnType<typeof createMDeployApp>,
  proposalId: string,
  actor: ActorId
) {
  return app.handle(
    new Request(`http://mdeploy.internal/api/v0/deploy/proposals/${proposalId}/approve`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${actor}`,
        'content-type': 'application/json',
        'x-correlation-id': 'corr-quorum-repair'
      },
      body: JSON.stringify({ result: 'approve' })
    })
  )
}

async function applyProposal(
  app: ReturnType<typeof createMDeployApp>,
  proposalId: string,
  agentId: string
) {
  return app.handle(
    new Request('http://mdeploy.internal/api/v0/deploy/apply', {
      method: 'POST',
      headers: {
        authorization: 'Bearer security-admin',
        'content-type': 'application/json',
        'x-correlation-id': 'corr-quorum-repair'
      },
      body: JSON.stringify({ proposalId, agentId })
    })
  )
}

describe('M-Deploy rejected-review security regressions', () => {
  it('rejects a forged Git envelope even when payload verification claims success', async () => {
    const priorToken = process.env.MERISTEM_INTERNAL_TOKEN
    process.env.MERISTEM_INTERNAL_TOKEN = 'mdeploy-controller-forgery-token'
    try {
      const deps = createInMemoryMDeployDeps({
        gitEnvelopeOverride: forgedEnvelope(),
        existingPolicyApprovers: ['security-admin-2']
      })
      const app = createMDeployApp(deps)
      expect(
        (await enrollAgent(app, 'mdeploy-controller-forgery-token', 'agent-forged-git')).status
      ).toBe(200)

      const apply = await scheduleApprovedApply(app, 'agent-forged-git')

      expect(apply.status).toBe(400)
      expect(await apply.json()).toMatchObject({ error: { code: 'signature_verification_failed' } })
      expect(deps.__testing.secretResolutionCount()).toBe(0)
      expect(deps.__testing.runtimeApplyCount()).toBe(0)
    } finally {
      if (priorToken === undefined) delete process.env.MERISTEM_INTERNAL_TOKEN
      else process.env.MERISTEM_INTERNAL_TOKEN = priorToken
    }
  })

  it('re-verifies a queued envelope against enrolled trust before secrets or runtime', async () => {
    const priorToken = process.env.MERISTEM_INTERNAL_TOKEN
    process.env.MERISTEM_INTERNAL_TOKEN = 'mdeploy-agent-forgery-token'
    try {
      const deps = createInMemoryMDeployDeps({
        agentEnvelopeOverride: forgedEnvelope(),
        existingPolicyApprovers: ['security-admin-2']
      })
      const app = createMDeployApp(deps)
      expect(
        (await enrollAgent(app, 'mdeploy-agent-forgery-token', 'agent-forged-queue')).status
      ).toBe(200)
      expect((await scheduleApprovedApply(app, 'agent-forged-queue')).status).toBe(200)

      const reconcile = await app.handle(
        new Request(
          'http://mdeploy.internal/internal/v0/deploy/agents/agent-forged-queue/reconcile',
          {
            method: 'POST',
            headers: { 'x-meristem-internal-token': 'mdeploy-agent-forgery-token' }
          }
        )
      )

      expect(reconcile.status).toBe(409)
      expect(await reconcile.json()).toMatchObject({
        error: { code: 'signature_verification_failed' }
      })
      expect(deps.__testing.secretResolutionCount()).toBe(0)
      expect(deps.__testing.runtimeApplyCount()).toBe(0)
    } finally {
      if (priorToken === undefined) delete process.env.MERISTEM_INTERNAL_TOKEN
      else process.env.MERISTEM_INTERNAL_TOKEN = priorToken
    }
  })

  it('persists the apply operation before dispatching its started event', async () => {
    const priorToken = process.env.MERISTEM_INTERNAL_TOKEN
    process.env.MERISTEM_INTERNAL_TOKEN = 'mdeploy-order-token'
    try {
      const deps = createInMemoryMDeployDeps({
        existingPolicyApprovers: ['security-admin-2']
      })
      const order: string[] = []
      const admitOperation = deps.store.admitOperation
      deps.store.admitOperation = async input => {
        order.push('persist-operation')
        return admitOperation(input)
      }
      const publish = deps.events.publish
      deps.events.publish = async (subject, payload) => {
        if (subject === 'mdeploy.apply.started.v0') order.push('publish-started')
        return publish(subject, payload)
      }
      const app = createMDeployApp(deps)
      expect((await enrollAgent(app, 'mdeploy-order-token', 'agent-order')).status).toBe(200)

      expect((await scheduleApprovedApply(app, 'agent-order')).status).toBe(200)

      expect(order).toEqual(['persist-operation', 'publish-started'])
    } finally {
      if (priorToken === undefined) delete process.env.MERISTEM_INTERNAL_TOKEN
      else process.env.MERISTEM_INTERNAL_TOKEN = priorToken
    }
  })

  it('returns runtime success with pending publication when success-event dispatch fails', async () => {
    const priorToken = process.env.MERISTEM_INTERNAL_TOKEN
    process.env.MERISTEM_INTERNAL_TOKEN = 'mdeploy-publication-token'
    try {
      const deps = createInMemoryMDeployDeps({
        existingPolicyApprovers: ['security-admin-2']
      })
      const publish = deps.events.publish
      let failedSuccessDispatch = false
      let successDispatchCount = 0
      deps.events.publish = async (subject, payload) => {
        if (subject !== 'mdeploy.apply.succeeded.v0') return publish(subject, payload)
        successDispatchCount++
        if (!failedSuccessDispatch) {
          failedSuccessDispatch = true
          return err({ code: 'event.unavailable', message: 'event publisher unavailable' })
        }
        return publish(subject, payload)
      }
      const app = createMDeployApp(deps)
      expect(
        (await enrollAgent(app, 'mdeploy-publication-token', 'agent-publication')).status
      ).toBe(200)
      expect((await scheduleApprovedApply(app, 'agent-publication')).status).toBe(200)

      const reconcile = await app.handle(
        new Request(
          'http://mdeploy.internal/internal/v0/deploy/agents/agent-publication/reconcile',
          {
            method: 'POST',
            headers: { 'x-meristem-internal-token': 'mdeploy-publication-token' }
          }
        )
      )

      expect(reconcile.status).toBe(200)
      const reconcileBody = await reconcile.json()
      expect(reconcileBody).toMatchObject({
        reconcile: { applyStatus: 'succeeded', publicationStatus: 'pending' }
      })
      if (typeof reconcileBody !== 'object' || reconcileBody === null)
        throw new Error('missing reconcile body')
      const reconcileResult = Reflect.get(reconcileBody, 'reconcile')
      if (typeof reconcileResult !== 'object' || reconcileResult === null)
        throw new Error('missing reconcile result')
      const operationId = Reflect.get(reconcileResult, 'operationId')
      if (typeof operationId !== 'string') throw new Error('missing operation id')

      const retry = await app.handle(
        new Request(
          'http://mdeploy.internal/internal/v0/deploy/agents/agent-publication/reconcile',
          {
            method: 'POST',
            headers: { 'x-meristem-internal-token': 'mdeploy-publication-token' }
          }
        )
      )
      expect(retry.status).toBe(404)
      const recovered = await deps.store.getOperation(operationId)
      expect(recovered).toMatchObject({
        ok: true,
        value: { status: 'succeeded', publicationStatus: 'published' }
      })
      expect(successDispatchCount).toBe(2)
      expect(deps.__testing.runtimeApplyCount()).toBe(1)
      expect(deps.__testing.operationStatuses()).toContain('succeeded')
    } finally {
      if (priorToken === undefined) delete process.env.MERISTEM_INTERNAL_TOKEN
      else process.env.MERISTEM_INTERNAL_TOKEN = priorToken
    }
  })

  it('rejects self approval for a production deployment proposal', async () => {
    const deps = createInMemoryMDeployDeps()
    const app = createMDeployApp(deps)
    const proposalId = await createProposal(app, 'security-admin')

    const approval = await approveProposal(app, proposalId, 'security-admin')

    expect(approval.status).toBe(403)
    expect(await approval.json()).toMatchObject({ error: { code: 'policy.self_approval_denied' } })
  })

  it('keeps production apply blocked after only one eligible approval', async () => {
    const priorToken = process.env.MERISTEM_INTERNAL_TOKEN
    process.env.MERISTEM_INTERNAL_TOKEN = 'mdeploy-one-approval-token'
    try {
      const deps = createInMemoryMDeployDeps()
      const app = createMDeployApp(deps)
      expect(
        (await enrollAgent(app, 'mdeploy-one-approval-token', 'agent-one-approval')).status
      ).toBe(200)
      const proposalId = await createProposal(app, 'admin')
      expect((await approveProposal(app, proposalId, 'security-admin')).status).toBe(200)

      const apply = await applyProposal(app, proposalId, 'agent-one-approval')

      expect(apply.status).toBe(403)
      expect(await apply.json()).toMatchObject({ error: { code: 'policy.quorum_not_satisfied' } })
    } finally {
      if (priorToken === undefined) delete process.env.MERISTEM_INTERNAL_TOKEN
      else process.env.MERISTEM_INTERNAL_TOKEN = priorToken
    }
  })

  it('accepts production apply after two distinct eligible policy approvers', async () => {
    const priorToken = process.env.MERISTEM_INTERNAL_TOKEN
    process.env.MERISTEM_INTERNAL_TOKEN = 'mdeploy-two-approval-token'
    try {
      const deps = createInMemoryMDeployDeps()
      const app = createMDeployApp(deps)
      expect(
        (await enrollAgent(app, 'mdeploy-two-approval-token', 'agent-two-approval')).status
      ).toBe(200)
      const proposalId = await createProposal(app, 'admin')
      expect((await approveProposal(app, proposalId, 'security-admin')).status).toBe(200)
      expect((await approveProposal(app, proposalId, 'security-admin-2')).status).toBe(200)

      const apply = await applyProposal(app, proposalId, 'agent-two-approval')

      expect(apply.status).toBe(200)
      expect(await apply.json()).toMatchObject({ operation: { status: 'queued' } })
    } finally {
      if (priorToken === undefined) delete process.env.MERISTEM_INTERNAL_TOKEN
      else process.env.MERISTEM_INTERNAL_TOKEN = priorToken
    }
  })

  it('fails closed with the blocked-transition error for an untrusted queued envelope', async () => {
    const priorToken = process.env.MERISTEM_INTERNAL_TOKEN
    process.env.MERISTEM_INTERNAL_TOKEN = 'mdeploy-blocked-write-token'
    try {
      const deps = createInMemoryMDeployDeps({
        agentEnvelopeOverride: forgedEnvelope(),
        existingPolicyApprovers: ['security-admin-2']
      })
      const app = createMDeployApp(deps)
      expect(
        (await enrollAgent(app, 'mdeploy-blocked-write-token', 'agent-blocked-write')).status
      ).toBe(200)
      expect((await scheduleApprovedApply(app, 'agent-blocked-write')).status).toBe(200)
      const transitionOperation = deps.store.transitionOperation
      deps.store.transitionOperation = async (operationId, status, completedAt) =>
        status === 'blocked'
          ? err({ code: 'store.blocked_write_failed', message: 'blocked transition failed' })
          : transitionOperation(operationId, status, completedAt)

      const reconcile = await app.handle(
        new Request(
          'http://mdeploy.internal/internal/v0/deploy/agents/agent-blocked-write/reconcile',
          {
            method: 'POST',
            headers: { 'x-meristem-internal-token': 'mdeploy-blocked-write-token' }
          }
        )
      )

      expect(await reconcile.json()).toMatchObject({
        error: { code: 'store.blocked_write_failed' }
      })
      expect(deps.__testing.runtimeApplyCount()).toBe(0)
    } finally {
      if (priorToken === undefined) delete process.env.MERISTEM_INTERNAL_TOKEN
      else process.env.MERISTEM_INTERNAL_TOKEN = priorToken
    }
  })

  it('fails closed with the Audit error after durably blocking a capability rejection', async () => {
    const priorToken = process.env.MERISTEM_INTERNAL_TOKEN
    process.env.MERISTEM_INTERNAL_TOKEN = 'mdeploy-capability-audit-token'
    try {
      const deps = createInMemoryMDeployDeps({
        existingPolicyApprovers: ['security-admin-2']
      })
      const app = createMDeployApp(deps)
      expect(
        (await enrollAgent(app, 'mdeploy-capability-audit-token', 'agent-capability-audit')).status
      ).toBe(200)
      expect((await scheduleApprovedApply(app, 'agent-capability-audit')).status).toBe(200)
      const enrolled = await deps.store.getAgent('agent-capability-audit')
      if (!enrolled.ok || !enrolled.value) throw new Error('missing enrolled agent')
      await deps.store.upsertAgent({
        ...enrolled.value,
        enrollment: { ...enrolled.value.enrollment, capabilities: [] }
      })
      deps.log.writeAudit = async () =>
        err({ code: 'audit.agent_blocked_write_failed', message: 'agent Audit write failed' })

      const reconcile = await app.handle(
        new Request(
          'http://mdeploy.internal/internal/v0/deploy/agents/agent-capability-audit/reconcile',
          {
            method: 'POST',
            headers: { 'x-meristem-internal-token': 'mdeploy-capability-audit-token' }
          }
        )
      )

      expect(await reconcile.json()).toMatchObject({
        error: { code: 'audit.agent_blocked_write_failed' }
      })
      expect(deps.__testing.operationStatuses()).toContain('blocked')
      expect(deps.__testing.runtimeApplyCount()).toBe(0)
    } finally {
      if (priorToken === undefined) delete process.env.MERISTEM_INTERNAL_TOKEN
      else process.env.MERISTEM_INTERNAL_TOKEN = priorToken
    }
  })

  it('durably blocks and audits secret resolution rejection before runtime', async () => {
    const priorToken = process.env.MERISTEM_INTERNAL_TOKEN
    process.env.MERISTEM_INTERNAL_TOKEN = 'mdeploy-secret-block-token'
    try {
      const deps = createInMemoryMDeployDeps({
        existingPolicyApprovers: ['security-admin-2'],
        secretAvailable: false
      })
      const app = createMDeployApp(deps)
      expect(
        (await enrollAgent(app, 'mdeploy-secret-block-token', 'agent-secret-block')).status
      ).toBe(200)
      expect((await scheduleApprovedApply(app, 'agent-secret-block')).status).toBe(200)

      const reconcile = await app.handle(
        new Request(
          'http://mdeploy.internal/internal/v0/deploy/agents/agent-secret-block/reconcile',
          {
            method: 'POST',
            headers: { 'x-meristem-internal-token': 'mdeploy-secret-block-token' }
          }
        )
      )

      expect(await reconcile.json()).toMatchObject({ error: { code: 'provider_unavailable' } })
      expect(deps.__testing.operationStatuses()).toContain('blocked')
      expect(deps.__testing.auditActions()).toContain('deploy.agent.secret.blocked')
      expect(deps.__testing.runtimeApplyCount()).toBe(0)
    } finally {
      if (priorToken === undefined) delete process.env.MERISTEM_INTERNAL_TOKEN
      else process.env.MERISTEM_INTERNAL_TOKEN = priorToken
    }
  })
})
