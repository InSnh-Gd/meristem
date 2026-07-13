import { and, asc, desc, eq } from 'drizzle-orm'
import { err, ok } from '../../../packages/common/src/result.ts'
import type { MeristemDb } from '../../../packages/db/src/client.ts'
import {
  mdeployAgents,
  mdeployApprovals,
  mdeployDriftReports,
  mdeployEventIntents,
  mdeployEvidence,
  mdeployLastSuccessful,
  mdeployOperations,
  mdeployProposals,
  mdeployVerifiedEnvelopes
} from '../../../packages/db/src/schema.ts'
import type {
  MDeployAgentRecord,
  MDeployError,
  MDeployEventIntent,
  MDeployOperation,
  MDeployStore
} from './deps.ts'

function digestKey(digest: MDeployOperation['desiredStateDigest']): string {
  return `${digest.algorithm}:${digest.value}`
}

function storageError(error: unknown): MDeployError {
  return {
    code: 'storage.unavailable',
    message: 'M-Deploy PostgreSQL storage is unavailable',
    detail: error instanceof Error ? error.message : String(error)
  }
}

function withStatus(
  operation: MDeployOperation,
  status: MDeployOperation['status'],
  completedAt?: string
): MDeployOperation {
  return {
    ...operation,
    status,
    ...(completedAt === undefined ? {} : { completedAt })
  }
}

/** PostgreSQL is M-Deploy's authoritative state and outbox store; grouped writes use one Drizzle transaction. */
export function createPostgresMDeployStore(db: MeristemDb): MDeployStore {
  return {
    async createProposal(proposal) {
      try {
        const now = new Date(proposal.createdAt)
        await db.insert(mdeployProposals).values({
          id: proposal.proposalId,
          approvalStatus: proposal.approvalStatus,
          proposal,
          createdAt: now,
          updatedAt: now
        })
        return ok(proposal)
      } catch (error) {
        return err(storageError(error))
      }
    },

    async getProposal(id) {
      try {
        const [row] = await db
          .select({ proposal: mdeployProposals.proposal })
          .from(mdeployProposals)
          .where(eq(mdeployProposals.id, id))
          .limit(1)
        return ok(row?.proposal ?? null)
      } catch (error) {
        return err(storageError(error))
      }
    },

    async updateProposalStatus(id, approvalStatus) {
      try {
        const [row] = await db
          .select({ proposal: mdeployProposals.proposal })
          .from(mdeployProposals)
          .where(eq(mdeployProposals.id, id))
          .limit(1)
        if (!row) return ok(null)
        const proposal = { ...row.proposal, approvalStatus }
        await db
          .update(mdeployProposals)
          .set({ proposal, approvalStatus, updatedAt: new Date() })
          .where(eq(mdeployProposals.id, id))
        return ok(proposal)
      } catch (error) {
        return err(storageError(error))
      }
    },

    async createApproval(approval) {
      try {
        await db.insert(mdeployApprovals).values({
          id: approval.approvalId,
          proposalId: approval.proposalId,
          approval,
          createdAt: new Date(approval.timestamp)
        })
        return ok(approval)
      } catch (error) {
        return err(storageError(error))
      }
    },

    async createOperation(operation) {
      try {
        const createdAt = new Date(operation.createdAt)
        await db.insert(mdeployOperations).values({
          id: operation.operationId,
          agentId: operation.agentId,
          status: operation.status,
          publicationStatus: operation.publicationStatus,
          operation,
          createdAt,
          updatedAt: createdAt
        })
        return ok(operation)
      } catch (error) {
        return err(storageError(error))
      }
    },

    async admitOperation(input) {
      try {
        const createdAt = new Date(input.operation.createdAt)
        await db.transaction(async tx => {
          await tx.insert(mdeployOperations).values({
            id: input.operation.operationId,
            agentId: input.operation.agentId,
            status: input.operation.status,
            publicationStatus: input.operation.publicationStatus,
            operation: input.operation,
            createdAt,
            updatedAt: createdAt
          })
          if (input.evidence.length > 0) {
            await tx.insert(mdeployEvidence).values(
              input.evidence.map(metadata => ({
                operationId: metadata.operationId,
                evidenceType: metadata.evidenceType,
                metadata,
                createdAt: new Date(metadata.timestamp)
              }))
            )
          }
          if (input.eventIntents.length > 0) {
            await tx.insert(mdeployEventIntents).values(
              input.eventIntents.map(intent => ({
                id: intent.intentId,
                operationId: intent.operationId,
                status: intent.status,
                intent,
                createdAt: new Date(intent.createdAt),
                updatedAt: new Date(intent.createdAt)
              }))
            )
          }
        })
        return ok(input.operation)
      } catch (error) {
        return err(storageError(error))
      }
    },

    async getOperation(id) {
      try {
        const [row] = await db
          .select({ operation: mdeployOperations.operation })
          .from(mdeployOperations)
          .where(eq(mdeployOperations.id, id))
          .limit(1)
        return ok(row?.operation ?? null)
      } catch (error) {
        return err(storageError(error))
      }
    },

    async nextQueuedOperation(agentId) {
      try {
        const [row] = await db
          .select({ operation: mdeployOperations.operation })
          .from(mdeployOperations)
          .where(
            and(eq(mdeployOperations.agentId, agentId), eq(mdeployOperations.status, 'queued'))
          )
          .orderBy(asc(mdeployOperations.createdAt))
          .limit(1)
        return ok(row?.operation ?? null)
      } catch (error) {
        return err(storageError(error))
      }
    },

    async transitionOperation(operationId, status, completedAt) {
      try {
        return await db.transaction(async tx => {
          const [row] = await tx
            .select({ operation: mdeployOperations.operation })
            .from(mdeployOperations)
            .where(eq(mdeployOperations.id, operationId))
            .limit(1)
          if (!row) return ok(null)
          const operation = withStatus(row.operation, status, completedAt)
          await tx
            .update(mdeployOperations)
            .set({ status, operation, updatedAt: new Date() })
            .where(eq(mdeployOperations.id, operationId))
          return ok(operation)
        })
      } catch (error) {
        return err(storageError(error))
      }
    },

    async completeOperation(input) {
      try {
        return await db.transaction(async tx => {
          const [row] = await tx
            .select({ operation: mdeployOperations.operation })
            .from(mdeployOperations)
            .where(eq(mdeployOperations.id, input.operationId))
            .limit(1)
          if (!row) return ok(null)
          const operation: MDeployOperation = {
            ...row.operation,
            status: 'succeeded',
            publicationStatus: 'pending',
            completedAt: input.completedAt
          }
          await tx
            .update(mdeployOperations)
            .set({
              status: operation.status,
              publicationStatus: operation.publicationStatus,
              operation,
              updatedAt: new Date(input.completedAt)
            })
            .where(eq(mdeployOperations.id, input.operationId))
          if (input.evidence.length > 0) {
            await tx.insert(mdeployEvidence).values(
              input.evidence.map(metadata => ({
                operationId: metadata.operationId,
                evidenceType: metadata.evidenceType,
                metadata,
                createdAt: new Date(metadata.timestamp)
              }))
            )
          }
          if (input.eventIntents.length > 0) {
            await tx.insert(mdeployEventIntents).values(
              input.eventIntents.map(intent => ({
                id: intent.intentId,
                operationId: intent.operationId,
                status: intent.status,
                intent,
                createdAt: new Date(intent.createdAt),
                updatedAt: new Date(intent.createdAt)
              }))
            )
          }
          const envelopeRow = {
            envelope: input.lastSuccessfulEnvelope,
            updatedAt: new Date(input.completedAt)
          }
          await tx
            .insert(mdeployLastSuccessful)
            .values({ agentId: operation.agentId, ...envelopeRow })
            .onConflictDoUpdate({ target: mdeployLastSuccessful.agentId, set: envelopeRow })
          await tx
            .insert(mdeployVerifiedEnvelopes)
            .values({
              digestKey: digestKey(input.lastSuccessfulEnvelope.payload.source.digest),
              ...envelopeRow
            })
            .onConflictDoUpdate({ target: mdeployVerifiedEnvelopes.digestKey, set: envelopeRow })
          return ok(operation)
        })
      } catch (error) {
        return err(storageError(error))
      }
    },

    async listPendingEventIntents(operationId) {
      try {
        const where = operationId
          ? and(
              eq(mdeployEventIntents.status, 'pending'),
              eq(mdeployEventIntents.operationId, operationId)
            )
          : eq(mdeployEventIntents.status, 'pending')
        const rows = await db
          .select({ intent: mdeployEventIntents.intent })
          .from(mdeployEventIntents)
          .where(where)
          .orderBy(asc(mdeployEventIntents.createdAt))
        return ok(rows.map(row => row.intent))
      } catch (error) {
        return err(storageError(error))
      }
    },

    async markEventIntentPublished(intentId, publishedAt) {
      try {
        return await db.transaction(async tx => {
          const [row] = await tx
            .select({ intent: mdeployEventIntents.intent })
            .from(mdeployEventIntents)
            .where(eq(mdeployEventIntents.id, intentId))
            .limit(1)
          if (!row) return ok(null)
          const intent: MDeployEventIntent = { ...row.intent, status: 'published', publishedAt }
          await tx
            .update(mdeployEventIntents)
            .set({ status: 'published', intent, updatedAt: new Date(publishedAt) })
            .where(eq(mdeployEventIntents.id, intentId))
          const pending = await tx
            .select({ id: mdeployEventIntents.id })
            .from(mdeployEventIntents)
            .where(
              and(
                eq(mdeployEventIntents.operationId, intent.operationId),
                eq(mdeployEventIntents.status, 'pending')
              )
            )
            .limit(1)
          if (pending.length === 0) {
            const [operationRow] = await tx
              .select({ operation: mdeployOperations.operation })
              .from(mdeployOperations)
              .where(eq(mdeployOperations.id, intent.operationId))
              .limit(1)
            if (operationRow) {
              const operation: MDeployOperation = {
                ...operationRow.operation,
                publicationStatus: 'published'
              }
              await tx
                .update(mdeployOperations)
                .set({ publicationStatus: 'published', operation, updatedAt: new Date(publishedAt) })
                .where(eq(mdeployOperations.id, intent.operationId))
            }
          }
          return ok(intent)
        })
      } catch (error) {
        return err(storageError(error))
      }
    },

    async recordEventIntentFailure(intentId, errorCode) {
      try {
        const [row] = await db
          .select({ intent: mdeployEventIntents.intent })
          .from(mdeployEventIntents)
          .where(eq(mdeployEventIntents.id, intentId))
          .limit(1)
        if (!row) return ok(null)
        const intent: MDeployEventIntent = { ...row.intent, status: 'pending', lastError: errorCode }
        await db
          .update(mdeployEventIntents)
          .set({ status: 'pending', intent, updatedAt: new Date() })
          .where(eq(mdeployEventIntents.id, intentId))
        return ok(intent)
      } catch (error) {
        return err(storageError(error))
      }
    },

    async upsertAgent(agent) {
      try {
        const row = { record: agent, updatedAt: new Date() }
        await db
          .insert(mdeployAgents)
          .values({ id: agent.enrollment.agentId, ...row })
          .onConflictDoUpdate({ target: mdeployAgents.id, set: row })
        return ok(agent)
      } catch (error) {
        return err(storageError(error))
      }
    },

    async getAgent(agentId) {
      try {
        const [row] = await db
          .select({ record: mdeployAgents.record })
          .from(mdeployAgents)
          .where(eq(mdeployAgents.id, agentId))
          .limit(1)
        return ok(row?.record ?? null)
      } catch (error) {
        return err(storageError(error))
      }
    },

    async listAgents() {
      try {
        const rows = await db.select({ record: mdeployAgents.record }).from(mdeployAgents)
        return ok(rows.map(row => row.record))
      } catch (error) {
        return err(storageError(error))
      }
    },

    async recordDrift(report) {
      try {
        await db.insert(mdeployDriftReports).values({
          id: report.reportId,
          report,
          createdAt: new Date(report.timestamp)
        })
        return ok(report)
      } catch (error) {
        return err(storageError(error))
      }
    },

    async listDrift() {
      try {
        const rows = await db
          .select({ report: mdeployDriftReports.report })
          .from(mdeployDriftReports)
          .orderBy(asc(mdeployDriftReports.createdAt))
        return ok(rows.map(row => row.report))
      } catch (error) {
        return err(storageError(error))
      }
    },

    async addEvidence(metadata) {
      try {
        await db
          .insert(mdeployEvidence)
          .values({
            operationId: metadata.operationId,
            evidenceType: metadata.evidenceType,
            metadata,
            createdAt: new Date(metadata.timestamp)
          })
          .onConflictDoUpdate({
            target: [mdeployEvidence.operationId, mdeployEvidence.evidenceType],
            set: { metadata, createdAt: new Date(metadata.timestamp) }
          })
        return ok(metadata)
      } catch (error) {
        return err(storageError(error))
      }
    },

    async listEvidence() {
      try {
        const rows = await db
          .select({ metadata: mdeployEvidence.metadata })
          .from(mdeployEvidence)
          .orderBy(asc(mdeployEvidence.createdAt))
        return ok(rows.map(row => row.metadata))
      } catch (error) {
        return err(storageError(error))
      }
    },

    async setLastSuccessful(agentId, envelope) {
      try {
        const row = { envelope, updatedAt: new Date() }
        await db.transaction(async tx => {
          await tx
            .insert(mdeployLastSuccessful)
            .values({ agentId, ...row })
            .onConflictDoUpdate({ target: mdeployLastSuccessful.agentId, set: row })
          await tx
            .insert(mdeployVerifiedEnvelopes)
            .values({ digestKey: digestKey(envelope.payload.source.digest), ...row })
            .onConflictDoUpdate({ target: mdeployVerifiedEnvelopes.digestKey, set: row })
        })
        return ok(undefined)
      } catch (error) {
        return err(storageError(error))
      }
    },

    async getLastSuccessful(agentId) {
      try {
        const [row] = await db
          .select({ envelope: mdeployLastSuccessful.envelope })
          .from(mdeployLastSuccessful)
          .where(eq(mdeployLastSuccessful.agentId, agentId))
          .limit(1)
        return ok(row?.envelope ?? null)
      } catch (error) {
        return err(storageError(error))
      }
    },

    async desiredStateSummary(controllerAvailable) {
      try {
        const [latest] = await db
          .select({ operation: mdeployOperations.operation })
          .from(mdeployOperations)
          .orderBy(desc(mdeployOperations.createdAt))
          .limit(1)
        const [successful] = await db
          .select({ envelope: mdeployLastSuccessful.envelope })
          .from(mdeployLastSuccessful)
          .orderBy(desc(mdeployLastSuccessful.updatedAt))
          .limit(1)
        return ok({
          ...(latest ? { latestDigest: latest.operation.desiredStateDigest } : {}),
          ...(successful
            ? { lastSuccessfulDigest: successful.envelope.payload.source.digest }
            : {}),
          stale: !controllerAvailable,
          controllerAvailable
        })
      } catch (error) {
        return err(storageError(error))
      }
    },

    async findVerifiedEnvelope(digest) {
      try {
        const [row] = await db
          .select({ envelope: mdeployVerifiedEnvelopes.envelope })
          .from(mdeployVerifiedEnvelopes)
          .where(eq(mdeployVerifiedEnvelopes.digestKey, digestKey(digest)))
          .limit(1)
        return ok(row?.envelope ?? null)
      } catch (error) {
        return err(storageError(error))
      }
    }
  }
}

export type PostgresMDeployStore = ReturnType<typeof createPostgresMDeployStore>
export type { MDeployAgentRecord }
