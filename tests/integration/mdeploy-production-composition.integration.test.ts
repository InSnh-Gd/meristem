import { describe, expect, test } from 'bun:test'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { ok } from '../../packages/common/src/result.ts'
import { loadRuntimeDeploymentConfigOrThrow } from '../../packages/config/src/index.ts'
import { createDb, createSqlClient } from '../../packages/db/src/client.ts'
import {
  mdeployAgents,
  mdeployEventIntents,
  mdeployEvidence,
  mdeployLastSuccessful,
  mdeployOperations,
  mdeployVerifiedEnvelopes
} from '../../packages/db/src/schema.ts'
import type {
  MDeployAgentEnrollmentV01FromSchema,
  MDeploySignedEnvelopeV01FromSchema
} from '../../packages/contracts/src/index.ts'
import type { SecretManager } from '../../packages/secrets/src/index.ts'
import { reconcileMDeployAgent } from '../../services/m-deploy/src/agent-workflow.ts'
import type {
  MDeployHostAdapters,
  ProductionMDeployOptions
} from '../../services/m-deploy/src/production.ts'
import { createProductionMDeployComposition } from '../../services/m-deploy/src/production.ts'
import { mDeployEnvelopeVerificationBytes } from '../../services/m-deploy/src/envelope-verification.ts'

const pgAvailable = await (async () => {
  try {
    const client = createSqlClient()
    await client`select 1`
    await client.end()
    return true
  } catch {
    return false
  }
})()

const now = '2026-07-13T00:05:00.000Z'

function signedFixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const fingerprint = createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64url')
  const controllerTrust = {
    issuer: 'm-deploy-controller',
    audience: 'mdeploy-agent',
    publicKeyFingerprint: fingerprint,
    expiresAt: '2026-07-14T00:00:00.000Z'
  }
  const digest = { algorithm: 'sha256' as const, value: `sha256:${crypto.randomUUID()}` }
  const unsigned: MDeploySignedEnvelopeV01FromSchema = {
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
      services: [],
      generatedAt: now
    },
    signature: { algorithm: 'ed25519', value: 'pending', payloadDigest: digest },
    signer: { kind: 'mdeploy-controller', identity: 'm-deploy-controller' },
    issuedAt: now,
    expiresAt: '2026-07-13T00:20:00.000Z',
    verification: { verified: false, verifiedAt: now, verifier: 'pending' }
  }
  const envelope: MDeploySignedEnvelopeV01FromSchema = {
    ...unsigned,
    signature: {
      ...unsigned.signature,
      value: sign(
        null,
        mDeployEnvelopeVerificationBytes(unsigned, controllerTrust),
        privateKey
      ).toString('base64url')
    }
  }
  return { publicKeyPem, fingerprint, controllerTrust, envelope }
}

describe('integration: M-Deploy production composition recovery', () => {
  test.skipIf(!pgAvailable)(
    'recreates composition, retries pending publication, and never reapplies runtime',
    async () => {
      await import('../../packages/db/src/migrate.ts')
      const fixture = signedFixture()
      const operationId = `operation-${crypto.randomUUID()}`
      const agentId = `agent-${crypto.randomUUID()}`
      let runtimeApplyCount = 0
      let successPublishAttempts = 0
      let failSuccessPublish = true

      const secretManager: SecretManager = {
        async read() {
          return ok(fixture.publicKeyPem)
        },
        async list() {
          return ok([])
        },
        async write() {
          return ok(undefined)
        }
      }
      const host: MDeployHostAdapters = {
        git: {
          async fetchSignedEnvelope() {
            return ok(fixture.envelope)
          }
        },
        agentIdentity: {
          async verifyEnrollment() {
            return ok(undefined)
          }
        },
        runtime: {
          async apply() {
            runtimeApplyCount++
            return ok(undefined)
          },
          async rollback() {
            return ok(undefined)
          }
        },
        controller: {
          async isAvailable() {
            return true
          }
        }
      }
      const fetchImpl = Object.assign(
        async (input: string | URL | Request, init?: RequestInit) => {
          const url = String(input)
          if (url.endsWith('/internal/v0/deployment-evidence')) {
            const body = init?.body ? JSON.parse(String(init.body)) : {}
            return Response.json({
              storageRef: {
                uri: `m-log://evidence/${operationId}`,
                digest: body.digest,
                redactionStatus: 'redacted'
              }
            })
          }
          if (url.endsWith('/internal/v0/publish')) {
            const body = init?.body ? JSON.parse(String(init.body)) : {}
            if (body.subject === 'mdeploy.apply.succeeded.v0') {
              successPublishAttempts++
              if (failSuccessPublish) {
                return Response.json(
                  { error: { code: 'event.unavailable', message: 'event bus unavailable' } },
                  { status: 503 }
                )
              }
            }
            return Response.json({ eventId: crypto.randomUUID() })
          }
          if (url.endsWith('/internal/v0/timeline') || url.endsWith('/internal/v0/full')) {
            return Response.json({ entry: { id: crypto.randomUUID() } })
          }
          return Response.json({ error: { code: 'unexpected', message: url } }, { status: 500 })
        },
        { preconnect: fetch.preconnect }
      )
      const runtimeConfig = await loadRuntimeDeploymentConfigOrThrow({
        env: { MERISTEM_V02_DEPLOYMENT_CONFIG: 'config/dev-deployment.json' }
      })
      const options: ProductionMDeployOptions = {
        host,
        controllerTrust: {
          publicKeyRef: { provider: 'dev-env', keyPath: 'mdeploy/controller/public-key' },
          issuer: fixture.controllerTrust.issuer,
          audience: fixture.controllerTrust.audience,
          publicKeyFingerprint: fixture.fingerprint
        },
        runtimeConfig,
        secretManager,
        fetchImpl,
        now: () => now,
        env: { MERISTEM_JWT_SECRET: 'test-jwt-secret' }
      }
      const enrollment: MDeployAgentEnrollmentV01FromSchema = {
        schemaVersion: 'mdeploy.agent-enrollment@0.1.0',
        agentId,
        hostId: `host-${agentId}`,
        capabilities: [{ runtimeDriver: 'podman', version: '5.0.0', features: ['quadlet'] }],
        controllerTrust: fixture.controllerTrust,
        enrolledAt: now
      }
      const first = await createProductionMDeployComposition(options)
      try {
        expect(await first.deps.store.upsertAgent({ enrollment })).toMatchObject({ ok: true })
        expect(
          await first.deps.store.admitOperation({
            operation: {
              operationId,
              kind: 'apply',
              proposalId: `proposal-${operationId}`,
              agentId,
              envelope: fixture.envelope,
              desiredStateDigest: fixture.envelope.payload.source.digest,
              actor: 'security-admin',
              policyDecisionId: `decision-${operationId}`,
              quorumProofId: `proof-${operationId}`,
              auditId: `audit-${operationId}`,
              correlationId: `corr-${operationId}`,
              status: 'queued',
              publicationStatus: 'pending',
              createdAt: now
            },
            evidence: [],
            eventIntents: []
          })
        ).toMatchObject({ ok: true })

        expect(await reconcileMDeployAgent(first.deps, agentId)).toMatchObject({
          ok: true,
          value: { applyStatus: 'succeeded', publicationStatus: 'pending' }
        })
        expect(runtimeApplyCount).toBe(1)
      } finally {
        await first.close()
      }

      failSuccessPublish = false
      const recreated = await createProductionMDeployComposition(options)
      try {
        expect(await reconcileMDeployAgent(recreated.deps, agentId)).toMatchObject({
          ok: false,
          error: { code: 'deploy.operation_not_found' }
        })
        expect(await recreated.deps.store.getOperation(operationId)).toMatchObject({
          ok: true,
          value: {
            status: 'succeeded',
            publicationStatus: 'published',
            quorumProofId: `proof-${operationId}`
          }
        })
        expect(runtimeApplyCount).toBe(1)
        expect(successPublishAttempts).toBe(2)
      } finally {
        await recreated.close()
        const { db, client } = createDb()
        await db.delete(mdeployEvidence).where(eq(mdeployEvidence.operationId, operationId))
        await db.delete(mdeployEventIntents).where(eq(mdeployEventIntents.operationId, operationId))
        await db.delete(mdeployOperations).where(eq(mdeployOperations.id, operationId))
        await db.delete(mdeployAgents).where(eq(mdeployAgents.id, agentId))
        await db.delete(mdeployLastSuccessful).where(eq(mdeployLastSuccessful.agentId, agentId))
        await db
          .delete(mdeployVerifiedEnvelopes)
          .where(
            eq(
              mdeployVerifiedEnvelopes.digestKey,
              `${fixture.envelope.payload.source.digest.algorithm}:${fixture.envelope.payload.source.digest.value}`
            )
          )
        await client.end()
      }
    }
  )

  test.skipIf(pgAvailable)(
    'skipped: PostgreSQL unavailable, run docker compose up -d postgres',
    () => {
      expect(pgAvailable).toBe(false)
    }
  )
})
