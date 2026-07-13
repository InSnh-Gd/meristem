import type { Result } from '../../../packages/common/src/result.ts'
import type {
  ActorId,
  MDeployAgentEnrollmentV01FromSchema,
  MDeployAgentHeartbeatV01FromSchema,
  MDeployApprovalStatusFromSchema,
  MDeployApprovalV01FromSchema,
  MDeployControllerTrustMaterialV01FromSchema,
  MDeployDigestFromSchema,
  MDeployDriftReportV01FromSchema,
  MDeployEvidenceMetadataV01FromSchema,
  MDeployEvidenceTypeFromSchema,
  MDeployGitSourceRefV01FromSchema,
  MDeployProposalV01FromSchema,
  MDeploySignatureV01FromSchema,
  MDeploySignedEnvelopeV01FromSchema,
  MDeploySignerIdentityV01FromSchema,
  MDeployStorageRefV01FromSchema,
  Permission,
  PolicyResult,
  SecretRefFromSchema
} from '../../../packages/contracts/src/index.ts'

export type MDeployError = {
  code: string
  message: string
  detail?: string
}

export type MDeployPermission = Extract<Permission, `deploy:${string}`>

export type MDeployPublicContext = {
  actor: ActorId
  correlationId: string
}

export type MDeployAgentRecord = {
  enrollment: MDeployAgentEnrollmentV01FromSchema
  heartbeat?: MDeployAgentHeartbeatV01FromSchema
}

export type MDeployOperationKind = 'apply' | 'rollback'

export type MDeployOperationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked'
export type MDeployPublicationStatus = 'pending' | 'published'

export type MDeployProductionApplyQuorumProof = {
  proofId: string
  proposalId: string
  approvers: readonly [string, string]
  issuedAt: string
}

export type MDeployEventIntent = {
  intentId: string
  operationId: string
  subject: string
  payload: unknown
  status: MDeployPublicationStatus
  createdAt: string
  publishedAt?: string
  lastError?: string
}

export type MDeployOperation = {
  operationId: string
  kind: MDeployOperationKind
  proposalId?: string
  agentId: string
  // 持久化或传输层数据在 agent 边界前保持 unknown，防止类型声明绕过本地签名校验。
  envelope: unknown
  desiredStateDigest: MDeployDigestFromSchema
  actor: ActorId
  policyDecisionId: string
  quorumProofId?: string
  auditId: string
  correlationId: string
  status: MDeployOperationStatus
  publicationStatus: MDeployPublicationStatus
  createdAt: string
  previousDigest?: MDeployDigestFromSchema
  completedAt?: string
}

export type MDeployDesiredStateSummary = {
  latestDigest?: MDeployDigestFromSchema
  lastSuccessfulDigest?: MDeployDigestFromSchema
  syncedAt?: string
  stale: boolean
  controllerAvailable: boolean
}

export type MDeployStore = {
  createProposal(
    proposal: MDeployProposalV01FromSchema
  ): Promise<Result<MDeployProposalV01FromSchema, MDeployError>>
  getProposal(id: string): Promise<Result<MDeployProposalV01FromSchema | null, MDeployError>>
  updateProposalStatus(
    id: string,
    approvalStatus: MDeployApprovalStatusFromSchema
  ): Promise<Result<MDeployProposalV01FromSchema | null, MDeployError>>
  createApproval(
    approval: MDeployApprovalV01FromSchema
  ): Promise<Result<MDeployApprovalV01FromSchema, MDeployError>>
  createOperation(operation: MDeployOperation): Promise<Result<MDeployOperation, MDeployError>>
  admitOperation(input: {
    operation: MDeployOperation
    evidence: readonly MDeployEvidenceMetadataV01FromSchema[]
    eventIntents: readonly MDeployEventIntent[]
  }): Promise<Result<MDeployOperation, MDeployError>>
  getOperation(id: string): Promise<Result<MDeployOperation | null, MDeployError>>
  nextQueuedOperation(agentId: string): Promise<Result<MDeployOperation | null, MDeployError>>
  transitionOperation(
    operationId: string,
    status: MDeployOperationStatus,
    completedAt?: string
  ): Promise<Result<MDeployOperation | null, MDeployError>>
  completeOperation(input: {
    operationId: string
    completedAt: string
    evidence: readonly MDeployEvidenceMetadataV01FromSchema[]
    eventIntents: readonly MDeployEventIntent[]
    lastSuccessfulEnvelope: MDeploySignedEnvelopeV01FromSchema
  }): Promise<Result<MDeployOperation | null, MDeployError>>
  listPendingEventIntents(
    operationId?: string
  ): Promise<Result<readonly MDeployEventIntent[], MDeployError>>
  markEventIntentPublished(
    intentId: string,
    publishedAt: string
  ): Promise<Result<MDeployEventIntent | null, MDeployError>>
  recordEventIntentFailure(
    intentId: string,
    errorCode: string
  ): Promise<Result<MDeployEventIntent | null, MDeployError>>
  upsertAgent(agent: MDeployAgentRecord): Promise<Result<MDeployAgentRecord, MDeployError>>
  getAgent(agentId: string): Promise<Result<MDeployAgentRecord | null, MDeployError>>
  listAgents(): Promise<Result<readonly MDeployAgentRecord[], MDeployError>>
  recordDrift(
    report: MDeployDriftReportV01FromSchema
  ): Promise<Result<MDeployDriftReportV01FromSchema, MDeployError>>
  listDrift(): Promise<Result<readonly MDeployDriftReportV01FromSchema[], MDeployError>>
  addEvidence(
    evidence: MDeployEvidenceMetadataV01FromSchema
  ): Promise<Result<MDeployEvidenceMetadataV01FromSchema, MDeployError>>
  listEvidence(): Promise<Result<readonly MDeployEvidenceMetadataV01FromSchema[], MDeployError>>
  setLastSuccessful(
    agentId: string,
    envelope: MDeploySignedEnvelopeV01FromSchema
  ): Promise<Result<void, MDeployError>>
  getLastSuccessful(
    agentId: string
  ): Promise<Result<MDeploySignedEnvelopeV01FromSchema | null, MDeployError>>
  desiredStateSummary(
    controllerAvailable: boolean
  ): Promise<Result<MDeployDesiredStateSummary, MDeployError>>
  findVerifiedEnvelope(
    digest: MDeployDigestFromSchema
  ): Promise<Result<MDeploySignedEnvelopeV01FromSchema | null, MDeployError>>
}

export type MDeployDeps = {
  auth: {
    verify(bearerToken: string): Promise<Result<{ actor: ActorId }, MDeployError>>
  }
  policy: {
    authorize(input: {
      actor: ActorId
      action: MDeployPermission
      resource: string
      correlationId: string
    }): Promise<Result<{ decisionId: string; result: PolicyResult }, MDeployError>>
    recordApproval(input: {
      actor: ActorId
      proposal: MDeployProposalV01FromSchema
      result: 'approve' | 'reject'
      correlationId: string
    }): Promise<
      Result<
        {
          approval: MDeployApprovalV01FromSchema
          proposalStatus: MDeployApprovalStatusFromSchema
        },
        MDeployError
      >
    >
    proveProductionApplyQuorum(input: {
      proposal: MDeployProposalV01FromSchema
      correlationId: string
    }): Promise<Result<MDeployProductionApplyQuorumProof, MDeployError>>
  }
  log: {
    writeAudit(input: {
      actor: ActorId
      action: string
      resource: string
      policyDecisionId: string
      quorumProofId?: string
      correlationId: string
      result: string
    }): Promise<Result<{ auditId: string }, MDeployError>>
    writeTimeline(input: {
      summary: string
      subject: string
      correlationId: string
    }): Promise<Result<void, MDeployError>>
    writeFull(input: {
      level: 'warn' | 'error'
      message: string
      correlationId: string
      errorCode: string
    }): Promise<Result<void, MDeployError>>
    writeEvidence(input: {
      operationId: string
      correlationId: string
      auditId: string
      evidenceType: MDeployEvidenceTypeFromSchema
      digest: MDeployDigestFromSchema
    }): Promise<Result<MDeployStorageRefV01FromSchema, MDeployError>>
  }
  events: {
    publish(subject: string, payload: unknown): Promise<Result<void, MDeployError>>
  }
  git: {
    fetchSignedEnvelope(
      source: MDeployGitSourceRefV01FromSchema
    ): Promise<Result<unknown, MDeployError>>
  }
  agentIdentity: {
    verifyEnrollment(
      enrollment: MDeployAgentEnrollmentV01FromSchema
    ): Promise<Result<void, MDeployError>>
  }
  envelopeVerifier: {
    verify(input: {
      signedBytes: Uint8Array
      signature: MDeploySignatureV01FromSchema
      signer: MDeploySignerIdentityV01FromSchema
      controllerTrust: MDeployControllerTrustMaterialV01FromSchema
    }): Promise<Result<void, MDeployError>>
  }
  secretProvider: {
    resolve(
      ref: SecretRefFromSchema
    ): Promise<Result<{ redactedRef: string; version?: number; auditId: string }, MDeployError>>
  }
  runtime: {
    apply(input: {
      agent: MDeployAgentRecord
      envelope: MDeploySignedEnvelopeV01FromSchema
      correlationId: string
    }): Promise<Result<void, MDeployError>>
    rollback(input: {
      agent: MDeployAgentRecord
      envelope: MDeploySignedEnvelopeV01FromSchema
      correlationId: string
    }): Promise<Result<void, MDeployError>>
  }
  controller: {
    isAvailable(): Promise<boolean>
  }
  store: MDeployStore
  now(): string
  snapshotTtlMs: number
}
