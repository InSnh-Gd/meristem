import { ok } from '../../../packages/common/src/result.ts'
import type {
  MDeployApprovalStatusFromSchema,
  MDeployApprovalV01FromSchema,
  MDeployDigestFromSchema,
  MDeployDriftReportV01FromSchema,
  MDeployEvidenceMetadataV01FromSchema,
  MDeployProposalV01FromSchema,
  MDeploySignedEnvelopeV01FromSchema
} from '../../../packages/contracts/src/index.ts'
import type {
  MDeployAgentRecord,
  MDeployEventIntent,
  MDeployOperation,
  MDeployOperationStatus
} from './deps.ts'

/** 将 digest 收敛为按内容寻址的 map key。 */
export function digestKey(digest: MDeployDigestFromSchema): string {
  return `${digest.algorithm}:${digest.value}`
}

/**
 * 内存 M-Deploy store 的共享状态。由 `createInMemoryMDeployDeps` 构造后传入 store 工厂，
 * 使 store 端口实现从测试装配主体（testing.ts）中分离，便于维护与单测复用。
 */
export type InMemoryMDeployStoreState = {
  proposals: Map<string, MDeployProposalV01FromSchema>
  approvals: Map<string, MDeployApprovalV01FromSchema>
  operations: Map<string, MDeployOperation>
  agents: Map<string, MDeployAgentRecord>
  drift: Map<string, MDeployDriftReportV01FromSchema>
  evidence: Map<string, MDeployEvidenceMetadataV01FromSchema>
  eventIntents: Map<string, MDeployEventIntent>
  verifiedEnvelopes: Map<string, MDeploySignedEnvelopeV01FromSchema>
  lastSuccessful: Map<string, MDeploySignedEnvelopeV01FromSchema>
  statuses: MDeployOperationStatus[]
  agentEnvelopeOverride?: unknown
}

/** 构造 `MDeployDeps['store']` 的内存实现，读写共享状态。 */
export function createInMemoryMDeployStore(state: InMemoryMDeployStoreState) {
  const {
    proposals,
    approvals,
    operations,
    agents,
    drift,
    evidence,
    eventIntents,
    verifiedEnvelopes,
    lastSuccessful,
    statuses
  } = state

  return {
    async createProposal(proposal: MDeployProposalV01FromSchema) {
      proposals.set(proposal.proposalId, proposal)
      return ok(proposal)
    },
    async getProposal(id: string) {
      return ok(proposals.get(id) ?? null)
    },
    async updateProposalStatus(id: string, approvalStatus: MDeployApprovalStatusFromSchema) {
      const existing = proposals.get(id)
      if (!existing) return ok(null)
      const updated = { ...existing, approvalStatus }
      proposals.set(id, updated)
      return ok(updated)
    },
    async createApproval(approval: MDeployApprovalV01FromSchema) {
      approvals.set(approval.approvalId, approval)
      return ok(approval)
    },
    async createOperation(operation: MDeployOperation) {
      operations.set(operation.operationId, operation)
      return ok(operation)
    },
    async admitOperation(input: {
      operation: MDeployOperation
      evidence: readonly MDeployEvidenceMetadataV01FromSchema[]
      eventIntents: readonly MDeployEventIntent[]
    }) {
      operations.set(input.operation.operationId, input.operation)
      for (const metadata of input.evidence) {
        evidence.set(`${metadata.operationId}:${metadata.evidenceType}`, metadata)
      }
      for (const intent of input.eventIntents) eventIntents.set(intent.intentId, intent)
      return ok(input.operation)
    },
    async getOperation(operationId: string) {
      return ok(operations.get(operationId) ?? null)
    },
    async nextQueuedOperation(agentId: string) {
      const queued = [...operations.values()].find(
        operation => operation.agentId === agentId && operation.status === 'queued'
      )
      return ok(
        queued
          ? {
              ...queued,
              ...(state.agentEnvelopeOverride === undefined
                ? {}
                : { envelope: state.agentEnvelopeOverride })
            }
          : null
      )
    },
    async transitionOperation(
      operationId: string,
      status: MDeployOperationStatus,
      completedAt?: string
    ) {
      const existing = operations.get(operationId)
      if (!existing) return ok(null)
      const updated = { ...existing, status, ...(completedAt ? { completedAt } : {}) }
      operations.set(operationId, updated)
      statuses.push(status)
      return ok(updated)
    },
    async completeOperation(input: {
      operationId: string
      completedAt: string
      evidence: readonly MDeployEvidenceMetadataV01FromSchema[]
      eventIntents: readonly MDeployEventIntent[]
      lastSuccessfulEnvelope: MDeploySignedEnvelopeV01FromSchema
    }) {
      const existing = operations.get(input.operationId)
      if (!existing) return ok(null)
      const updated: MDeployOperation = {
        ...existing,
        status: 'succeeded',
        publicationStatus: 'pending',
        completedAt: input.completedAt
      }
      operations.set(input.operationId, updated)
      statuses.push('succeeded')
      for (const metadata of input.evidence) {
        evidence.set(`${metadata.operationId}:${metadata.evidenceType}`, metadata)
      }
      for (const intent of input.eventIntents) eventIntents.set(intent.intentId, intent)
      lastSuccessful.set(existing.agentId, input.lastSuccessfulEnvelope)
      verifiedEnvelopes.set(
        digestKey(input.lastSuccessfulEnvelope.payload.source.digest),
        input.lastSuccessfulEnvelope
      )
      return ok(updated)
    },
    async listPendingEventIntents(operationId?: string) {
      return ok(
        [...eventIntents.values()].filter(
          intent =>
            intent.status === 'pending' &&
            (operationId === undefined || intent.operationId === operationId)
        )
      )
    },
    async markEventIntentPublished(intentId: string, publishedAt: string) {
      const existing = eventIntents.get(intentId)
      if (!existing) return ok(null)
      const updated: MDeployEventIntent = { ...existing, status: 'published', publishedAt }
      eventIntents.set(intentId, updated)
      const operation = operations.get(existing.operationId)
      if (operation) {
        const hasPending = [...eventIntents.values()].some(
          intent => intent.operationId === operation.operationId && intent.status === 'pending'
        )
        operations.set(operation.operationId, {
          ...operation,
          publicationStatus: hasPending ? 'pending' : 'published'
        })
      }
      return ok(updated)
    },
    async recordEventIntentFailure(intentId: string, errorCode: string) {
      const existing = eventIntents.get(intentId)
      if (!existing) return ok(null)
      const updated: MDeployEventIntent = { ...existing, status: 'pending', lastError: errorCode }
      eventIntents.set(intentId, updated)
      return ok(updated)
    },
    async upsertAgent(agent: MDeployAgentRecord) {
      agents.set(agent.enrollment.agentId, agent)
      return ok(agent)
    },
    async getAgent(agentId: string) {
      return ok(agents.get(agentId) ?? null)
    },
    async listAgents() {
      return ok([...agents.values()])
    },
    async recordDrift(report: MDeployDriftReportV01FromSchema) {
      drift.set(report.reportId, report)
      return ok(report)
    },
    async listDrift() {
      return ok([...drift.values()])
    },
    async addEvidence(metadata: MDeployEvidenceMetadataV01FromSchema) {
      evidence.set(`${metadata.operationId}:${metadata.evidenceType}`, metadata)
      return ok(metadata)
    },
    async listEvidence() {
      return ok([...evidence.values()])
    },
    async setLastSuccessful(agentId: string, signedEnvelope: MDeploySignedEnvelopeV01FromSchema) {
      lastSuccessful.set(agentId, signedEnvelope)
      verifiedEnvelopes.set(digestKey(signedEnvelope.payload.source.digest), signedEnvelope)
      return ok(undefined)
    },
    async getLastSuccessful(agentId: string) {
      return ok(lastSuccessful.get(agentId) ?? null)
    },
    async desiredStateSummary(controllerAvailable: boolean) {
      const latest = [...operations.values()].at(-1)
      const successful = [...lastSuccessful.values()].at(-1)
      return ok({
        ...(latest ? { latestDigest: latest.desiredStateDigest } : {}),
        ...(successful ? { lastSuccessfulDigest: successful.payload.source.digest } : {}),
        stale: !controllerAvailable,
        controllerAvailable
      })
    },
    async findVerifiedEnvelope(digest: MDeployDigestFromSchema) {
      return ok(verifiedEnvelopes.get(digestKey(digest)) ?? null)
    }
  }
}
