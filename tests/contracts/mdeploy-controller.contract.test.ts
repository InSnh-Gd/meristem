import { describe, expect, it } from 'bun:test'
import { createInMemoryMDeployDeps, createMDeployApp } from '../../services/m-deploy/src/index.ts'

describe('M-Deploy controller route contracts', () => {
  it('rejects an invalid public proposal body through the versioned TypeBox boundary', async () => {
    const app = createMDeployApp(createInMemoryMDeployDeps())

    const response = await app.handle(
      new Request('http://mdeploy.internal/api/v0/deploy/proposals', {
        method: 'POST',
        headers: { authorization: 'Bearer admin', 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceRef: { repositoryUrl: 'https://git.example/desired-state.git' },
          diffSummary: { added: 1, changed: 0, removed: 0, summary: 'incomplete source' }
        })
      })
    )

    expect(response.status).toBe(422)
  })

  it('rejects an unauthenticated loopback enrollment call with the shared internal error envelope', async () => {
    const app = createMDeployApp(createInMemoryMDeployDeps())

    const response = await app.handle(
      new Request('http://mdeploy.internal/internal/v0/deploy/agents/enroll', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 'mdeploy.agent-enrollment@0.1.0',
          agentId: 'agent-contract',
          hostId: 'host-contract',
          capabilities: [{ runtimeDriver: 'podman', version: '5.0.0', features: ['quadlet'] }],
          controllerTrust: {
            issuer: 'm-deploy-controller',
            audience: 'mdeploy-agent',
            publicKeyFingerprint: 'controller-fingerprint',
            expiresAt: '2026-07-14T00:00:00.000Z'
          },
          enrolledAt: '2026-07-13T00:00:00.000Z'
        })
      })
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: { code: 'internal.unauthorized' } })
  })
})
