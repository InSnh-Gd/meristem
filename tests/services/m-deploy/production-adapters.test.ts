import { describe, expect, it } from 'bun:test'
import { ok } from '../../../packages/common/src/result.ts'
import type { SharedAuthVerifier } from '../../../packages/auth/src/index.ts'
import type { SecretManager } from '../../../packages/secrets/src/index.ts'
import { createProductionMDeployBoundaryAdapters } from '../../../services/m-deploy/src/production-adapters.ts'

const authVerifier: SharedAuthVerifier = {
  async verify() {
    return {
      ok: true,
      session: {
        provider: 'local-dev',
        actor: { id: 'security-admin', displayName: 'security-admin' },
        issuer: 'meristem-core',
        audience: 'meristem-api',
        groups: [],
        permissions: []
      }
    }
  },
  async checkReadiness() {
    return { ok: true }
  }
}

const secretManager: SecretManager = {
  async read() {
    return ok('secret-value')
  },
  async list() {
    return ok([])
  },
  async write() {
    return ok(undefined)
  }
}

function unavailableAdapters() {
  const fetchImpl = Object.assign(
    async () => {
      throw new Error('dependency offline')
    },
    { preconnect: fetch.preconnect }
  )
  return createProductionMDeployBoundaryAdapters({
    urls: {
      policy: 'http://m-policy.internal',
      log: 'http://m-log.internal',
      eventbus: 'http://m-eventbus.internal'
    },
    authVerifier,
    secretManager,
    fetchImpl,
    now: () => '2026-07-13T00:05:00.000Z'
  })
}

describe('M-Deploy production boundary failures', () => {
  it('returns typed fail-closed errors for unavailable policy, Audit, evidence, and EventBus', async () => {
    const adapters = unavailableAdapters()

    expect(
      await adapters.policy.authorize({
        actor: 'security-admin',
        action: 'deploy:desired-state-apply',
        resource: 'deploy-proposal:proposal-1',
        correlationId: 'corr-policy'
      })
    ).toMatchObject({ ok: false, error: { code: 'policy.unavailable' } })
    expect(
      await adapters.log.writeAudit({
        actor: 'security-admin',
        action: 'deploy.apply',
        resource: 'deploy-proposal:proposal-1',
        policyDecisionId: 'decision-1',
        correlationId: 'corr-audit',
        result: 'allow'
      })
    ).toMatchObject({ ok: false, error: { code: 'audit.unavailable' } })
    expect(
      await adapters.log.writeEvidence({
        operationId: 'operation-1',
        correlationId: 'corr-evidence',
        auditId: 'audit-1',
        evidenceType: 'runtime_apply',
        digest: { algorithm: 'sha256', value: 'sha256:evidence' }
      })
    ).toMatchObject({ ok: false, error: { code: 'evidence.unavailable' } })
    expect(await adapters.events.publish('mdeploy.apply.succeeded.v0', {})).toMatchObject({
      ok: false,
      error: { code: 'event.unavailable' }
    })
  })
})
