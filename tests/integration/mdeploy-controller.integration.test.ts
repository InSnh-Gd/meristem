import { describe, expect, it } from 'bun:test'
import {
  createInMemoryMDeployDeps,
  createMDeployApp,
  runtimeTestControllerFingerprint
} from '../../services/m-deploy/src/index.ts'

const digest = { algorithm: 'sha256', value: 'sha256:desired-state-001' }

function readString(value: unknown, field: string): string {
  if (typeof value !== 'object' || value === null) throw new Error(`expected ${field}`)
  const candidate = Reflect.get(value, field)
  if (typeof candidate !== 'string') throw new Error(`expected ${field}`)
  return candidate
}

function property(value: unknown, field: string): unknown {
  if (typeof value !== 'object' || value === null) throw new Error(`expected ${field}`)
  return Reflect.get(value, field)
}

describe('M-Deploy controller and agent pull-reconcile', () => {
  it('schedules an approved Git proposal and lets an enrolled agent reconcile it with evidence', async () => {
    const priorToken = process.env.MERISTEM_INTERNAL_TOKEN
    process.env.MERISTEM_INTERNAL_TOKEN = 'mdeploy-integration-token'

    try {
      const deps = createInMemoryMDeployDeps({
        existingPolicyApprovers: ['security-admin-2']
      })
      const app = createMDeployApp(deps)

      const enrollment = await app.handle(
        new Request('http://mdeploy.internal/internal/v0/deploy/agents/enroll', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-meristem-internal-token': 'mdeploy-integration-token'
          },
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
      expect(enrollment.status).toBe(200)

      const proposed = await app.handle(
        new Request('http://mdeploy.internal/api/v0/deploy/proposals', {
          method: 'POST',
          headers: {
            authorization: 'Bearer admin',
            'content-type': 'application/json',
            'x-correlation-id': 'corr-proposal'
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
            diffSummary: { added: 1, changed: 1, removed: 0, summary: 'update immutable image' }
          })
        })
      )
      expect(proposed.status).toBe(200)
      const proposedBody = await proposed.json()
      const proposal = property(proposedBody, 'proposal')
      const proposalId = readString(proposal, 'proposalId')

      const approved = await app.handle(
        new Request(`http://mdeploy.internal/api/v0/deploy/proposals/${proposalId}/approve`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer security-admin',
            'content-type': 'application/json',
            'x-correlation-id': 'corr-proposal'
          },
          body: JSON.stringify({ result: 'approve' })
        })
      )
      expect(approved.status).toBe(200)

      const scheduled = await app.handle(
        new Request('http://mdeploy.internal/api/v0/deploy/apply', {
          method: 'POST',
          headers: {
            authorization: 'Bearer security-admin',
            'content-type': 'application/json',
            'x-correlation-id': 'corr-apply'
          },
          body: JSON.stringify({ proposalId, agentId: 'agent-1' })
        })
      )
      expect(scheduled.status).toBe(200)
      expect(await scheduled.json()).toMatchObject({ operation: { applyStatus: 'queued' } })

      const reconciled = await app.handle(
        new Request('http://mdeploy.internal/internal/v0/deploy/agents/agent-1/reconcile', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-meristem-internal-token': 'mdeploy-integration-token'
          }
        })
      )
      expect(reconciled.status).toBe(200)
      expect(await reconciled.json()).toMatchObject({
        reconcile: { applyStatus: 'succeeded', desiredStateDigest: digest }
      })
      expect(deps.__testing.runtimeApplyCount()).toBe(1)
      expect(deps.__testing.evidenceTypes()).toEqual(['signature_verification', 'runtime_apply'])
      expect(deps.__testing.auditActions()).toEqual([
        'deploy.propose',
        'deploy.approve',
        'deploy.apply'
      ])
    } finally {
      if (priorToken === undefined) {
        delete process.env.MERISTEM_INTERNAL_TOKEN
      } else {
        process.env.MERISTEM_INTERNAL_TOKEN = priorToken
      }
    }
  })

  it('records enrolled-agent heartbeat and drift through internal routes with redacted evidence metadata', async () => {
    const priorToken = process.env.MERISTEM_INTERNAL_TOKEN
    process.env.MERISTEM_INTERNAL_TOKEN = 'mdeploy-observation-token'

    try {
      const deps = createInMemoryMDeployDeps()
      const app = createMDeployApp(deps)
      const internalHeaders = {
        'content-type': 'application/json',
        'x-meristem-internal-token': 'mdeploy-observation-token'
      }
      const enrollment = await app.handle(
        new Request('http://mdeploy.internal/internal/v0/deploy/agents/enroll', {
          method: 'POST',
          headers: internalHeaders,
          body: JSON.stringify({
            schemaVersion: 'mdeploy.agent-enrollment@0.1.0',
            agentId: 'agent-observation',
            hostId: 'host-observation',
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
      expect(enrollment.status).toBe(200)

      const heartbeat = await app.handle(
        new Request(
          'http://mdeploy.internal/internal/v0/deploy/agents/agent-observation/heartbeat',
          {
            method: 'POST',
            headers: internalHeaders,
            body: JSON.stringify({
              schemaVersion: 'mdeploy.agent-heartbeat@0.1.0',
              agentId: 'agent-observation',
              timestamp: '2026-07-13T00:05:00.000Z',
              lastAppliedDigest: digest,
              driftStatus: 'suspected',
              health: 'degraded',
              connectionStatus: 'connected',
              runtimeDrivers: ['podman'],
              correlationId: 'corr-observation'
            })
          }
        )
      )
      expect(heartbeat.status).toBe(200)

      const drift = await app.handle(
        new Request('http://mdeploy.internal/internal/v0/deploy/drift', {
          method: 'POST',
          headers: { ...internalHeaders, 'x-correlation-id': 'corr-observation' },
          body: JSON.stringify({
            schemaVersion: 'mdeploy.drift-report@0.1.0',
            reportId: 'drift-observation',
            agentId: 'agent-observation',
            expectedState: { digest, source: 'git' },
            actualState: {
              digest: { algorithm: 'sha256', value: 'sha256:runtime-drift' },
              source: 'runtime'
            },
            driftType: 'runtime_state',
            severity: 'high',
            timestamp: '2026-07-13T00:06:00.000Z'
          })
        })
      )
      expect(drift.status).toBe(200)

      const agents = await app.handle(
        new Request('http://mdeploy.internal/api/v0/deploy/agents', {
          headers: { authorization: 'Bearer operator', 'x-correlation-id': 'corr-read' }
        })
      )
      expect(agents.status).toBe(200)
      expect(await agents.json()).toMatchObject({
        agents: [{ heartbeat: { health: 'degraded', driftStatus: 'suspected' } }]
      })

      const evidence = await app.handle(
        new Request('http://mdeploy.internal/api/v0/deploy/evidence', {
          headers: { authorization: 'Bearer operator', 'x-correlation-id': 'corr-read' }
        })
      )
      expect(evidence.status).toBe(200)
      expect(await evidence.json()).toMatchObject({
        evidence: [{ evidenceType: 'drift_report', storageRef: { redactionStatus: 'redacted' } }]
      })
    } finally {
      if (priorToken === undefined) delete process.env.MERISTEM_INTERNAL_TOKEN
      else process.env.MERISTEM_INTERNAL_TOKEN = priorToken
    }
  })
})
