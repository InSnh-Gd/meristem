import { describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { createDb, createSqlClient } from '../../packages/db/src/client.ts'
import {
  mdeployEventIntents,
  mdeployEvidence,
  mdeployOperations
} from '../../packages/db/src/schema.ts'
import type { MDeployEventIntent, MDeployOperation } from '../../services/m-deploy/src/deps.ts'
import { createPostgresMDeployStore } from '../../services/m-deploy/src/postgres-store.ts'

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

describe('integration: M-Deploy PostgreSQL store', () => {
  test.skipIf(!pgAvailable)(
    'recovers atomic operation, evidence, and pending intent state',
    async () => {
      await import('../../packages/db/src/migrate.ts')
      const { db, client } = createDb()
      const operationId = `deploy-${crypto.randomUUID()}`
      const now = '2026-07-13T00:05:00.000Z'
      const operation: MDeployOperation = {
        operationId,
        kind: 'apply',
        proposalId: 'proposal-durable',
        agentId: 'agent-durable',
        envelope: { signed: true },
        desiredStateDigest: { algorithm: 'sha256', value: 'sha256:durable' },
        actor: 'security-admin',
        policyDecisionId: 'decision-durable',
        quorumProofId: 'proof-durable',
        auditId: 'audit-durable',
        correlationId: 'corr-durable',
        status: 'queued',
        publicationStatus: 'pending',
        createdAt: now
      }
      const intent: MDeployEventIntent = {
        intentId: `intent-${operationId}`,
        operationId,
        subject: 'mdeploy.apply.started.v0',
        payload: { operationId },
        status: 'pending',
        createdAt: now
      }

      try {
        const first = createPostgresMDeployStore(db)
        const admitted = await first.admitOperation({
          operation,
          evidence: [
            {
              schemaVersion: 'mdeploy.evidence-metadata@0.1.0',
              operationId,
              correlationId: operation.correlationId,
              auditId: operation.auditId,
              evidenceType: 'signature_verification',
              timestamp: now,
              storageRef: {
                uri: `m-log://evidence/${operationId}`,
                digest: operation.desiredStateDigest,
                redactionStatus: 'redacted'
              }
            }
          ],
          eventIntents: [intent]
        })
        expect(admitted).toMatchObject({ ok: true, value: { quorumProofId: 'proof-durable' } })

        const recreated = createPostgresMDeployStore(db)
        expect(await recreated.getOperation(operationId)).toMatchObject({
          ok: true,
          value: { status: 'queued', quorumProofId: 'proof-durable' }
        })
        expect(await recreated.listEvidence()).toMatchObject({
          ok: true,
          value: [{ operationId, evidenceType: 'signature_verification' }]
        })
        expect(await recreated.listPendingEventIntents(operationId)).toMatchObject({
          ok: true,
          value: [{ intentId: intent.intentId, status: 'pending' }]
        })
      } finally {
        await db.delete(mdeployEvidence).where(eq(mdeployEvidence.operationId, operationId))
        await db.delete(mdeployEventIntents).where(eq(mdeployEventIntents.operationId, operationId))
        await db.delete(mdeployOperations).where(eq(mdeployOperations.id, operationId))
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
