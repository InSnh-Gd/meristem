import { describe, expect, test } from 'bun:test'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { ok } from '../../packages/common/src/result.ts'
import { loadRuntimeDeploymentConfigOrThrow } from '../../packages/config/src/index.ts'
import type { MDeploySignedEnvelopeV01FromSchema } from '../../packages/contracts/src/index.ts'
import { createDb, createSqlClient } from '../../packages/db/src/client.ts'
import {
  mdeployAgents,
  mdeployEventIntents,
  mdeployEvidence,
  mdeployOperations
} from '../../packages/db/src/schema.ts'
import type { SecretManager } from '../../packages/secrets/src/index.ts'
import { reconcileMDeployAgent } from '../../services/m-deploy/src/agent-workflow.ts'
import {
  createProductionMDeployComposition,
  type MDeployHostAdapters,
  type ProductionMDeployOptions
} from '../../services/m-deploy/src/production.ts'

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

describe('integration: M-Deploy blocked rejection recovery', () => {
  test.skipIf(!pgAvailable)(
    'persists blocked state and attributable Audit across composition recreation',
    async () => {
      await import('../../packages/db/src/migrate.ts')
      const now = '2026-07-13T00:05:00.000Z'
      const operationId = `operation-blocked-${crypto.randomUUID()}`
      const agentId = `agent-blocked-${crypto.randomUUID()}`
      const { publicKey } = generateKeyPairSync('ed25519')
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
      const forgedEnvelope: MDeploySignedEnvelopeV01FromSchema = {
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
        signature: { algorithm: 'ed25519', value: 'Zm9yZ2Vk', payloadDigest: digest },
        signer: { kind: 'mdeploy-controller', identity: 'm-deploy-controller' },
        issuedAt: now,
        expiresAt: '2026-07-13T00:20:00.000Z',
        verification: { verified: true, verifiedAt: now, verifier: 'payload-claim' }
      }
      const auditWrites: unknown[] = []
      let runtimeApplyCount = 0
      const secretManager: SecretManager = {
        async read() {
          return ok(publicKeyPem)
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
            return ok(forgedEnvelope)
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
          if (url.endsWith('/internal/v0/audit')) {
            auditWrites.push(init?.body ? JSON.parse(String(init.body)) : null)
            return Response.json({ entry: { id: `audit-blocked-${operationId}` } })
          }
          if (url.endsWith('/internal/v0/full')) {
            return Response.json({ entry: { id: crypto.randomUUID() } })
          }
          return Response.json({ eventId: crypto.randomUUID() })
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
          issuer: controllerTrust.issuer,
          audience: controllerTrust.audience,
          publicKeyFingerprint: fingerprint
        },
        runtimeConfig,
        secretManager,
        fetchImpl,
        now: () => now,
        env: { MERISTEM_JWT_SECRET: 'test-jwt-secret' }
      }
      const first = await createProductionMDeployComposition(options)
      try {
        expect(
          await first.deps.store.upsertAgent({
            enrollment: {
              schemaVersion: 'mdeploy.agent-enrollment@0.1.0',
              agentId,
              hostId: `host-${agentId}`,
              capabilities: [{ runtimeDriver: 'podman', version: '5.0.0', features: ['quadlet'] }],
              controllerTrust,
              enrolledAt: now
            }
          })
        ).toMatchObject({ ok: true })
        expect(
          await first.deps.store.admitOperation({
            operation: {
              operationId,
              kind: 'apply',
              proposalId: `proposal-${operationId}`,
              agentId,
              envelope: forgedEnvelope,
              desiredStateDigest: digest,
              actor: 'security-admin',
              policyDecisionId: `decision-${operationId}`,
              quorumProofId: `proof-${operationId}`,
              auditId: `audit-schedule-${operationId}`,
              correlationId: `corr-${operationId}`,
              status: 'queued',
              publicationStatus: 'published',
              createdAt: now
            },
            evidence: [],
            eventIntents: []
          })
        ).toMatchObject({ ok: true })

        expect(await reconcileMDeployAgent(first.deps, agentId)).toMatchObject({
          ok: false,
          error: { code: 'signature_verification_failed' }
        })
        expect(runtimeApplyCount).toBe(0)
        expect(auditWrites).toEqual([
          expect.objectContaining({
            action: 'deploy.agent.verification.blocked',
            result: 'blocked',
            correlationId: `corr-${operationId}`
          })
        ])
      } finally {
        await first.close()
      }

      const recreated = await createProductionMDeployComposition(options)
      try {
        expect(await recreated.deps.store.getOperation(operationId)).toMatchObject({
          ok: true,
          value: { status: 'blocked', quorumProofId: `proof-${operationId}` }
        })
        expect(runtimeApplyCount).toBe(0)
      } finally {
        await recreated.close()
        const { db, client } = createDb()
        await db.delete(mdeployEvidence).where(eq(mdeployEvidence.operationId, operationId))
        await db.delete(mdeployEventIntents).where(eq(mdeployEventIntents.operationId, operationId))
        await db.delete(mdeployOperations).where(eq(mdeployOperations.id, operationId))
        await db.delete(mdeployAgents).where(eq(mdeployAgents.id, agentId))
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
