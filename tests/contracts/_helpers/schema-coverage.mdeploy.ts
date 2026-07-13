import type { EventContract } from './schema-coverage.ts'
import { Contracts } from './schema-coverage.ts'

const digest = { algorithm: 'sha256', value: 'sha256:desired-state-001' }
const sourceRef = {
  repositoryUrl: 'https://git.example/meristem/desired-state.git',
  branch: 'main',
  commit: '0123456789abcdef0123456789abcdef01234567',
  path: 'deploy/prod',
  digest,
  syncedAt: '2026-07-13T00:00:00.000Z'
}
const storageRef = {
  uri: 's3://meristem-evidence/operation.json',
  digest,
  redactionStatus: 'redacted'
}

export const mDeployEventContracts: EventContract[] = [
  {
    subject: 'mdeploy.proposal.created.v0',
    schema: Contracts.MDeployProposalCreatedPayloadSchema,
    fixture: {
      schemaVersion: 'mdeploy.proposal@0.1.0',
      proposalId: 'proposal-1',
      sourceRef,
      diffSummary: { added: 1, changed: 1, removed: 0, summary: 'immutable image update' },
      actor: 'admin',
      policyDecisionId: 'policy-proposal',
      approvalStatus: 'pending',
      createdAt: '2026-07-13T00:00:00.000Z',
      correlationId: 'corr-proposal'
    }
  },
  {
    subject: 'mdeploy.approval.recorded.v0',
    schema: Contracts.MDeployApprovalRecordedPayloadSchema,
    fixture: {
      schemaVersion: 'mdeploy.approval@0.1.0',
      approvalId: 'approval-1',
      proposalId: 'proposal-1',
      approver: 'security-admin',
      timestamp: '2026-07-13T00:01:00.000Z',
      result: 'approve',
      policyDecisionId: 'policy-approval',
      correlationId: 'corr-proposal'
    }
  },
  {
    subject: 'mdeploy.apply.started.v0',
    schema: Contracts.MDeployApplyStartedPayloadSchema,
    fixture: {
      schemaVersion: 'mdeploy.reconcile-result@0.1.0',
      operationId: 'apply-1',
      agentId: 'agent-1',
      desiredStateDigest: digest,
      applyStatus: 'queued',
      publicationStatus: 'published',
      evidenceRefs: []
    }
  },
  {
    subject: 'mdeploy.apply.succeeded.v0',
    schema: Contracts.MDeployApplySucceededPayloadSchema,
    fixture: {
      schemaVersion: 'mdeploy.reconcile-result@0.1.0',
      operationId: 'apply-1',
      agentId: 'agent-1',
      desiredStateDigest: digest,
      applyStatus: 'succeeded',
      publicationStatus: 'published',
      evidenceRefs: [storageRef],
      completedAt: '2026-07-13T00:05:00.000Z'
    }
  },
  {
    subject: 'mdeploy.rollback.started.v0',
    schema: Contracts.MDeployRollbackStartedPayloadSchema,
    fixture: {
      schemaVersion: 'mdeploy.rollback-result@0.1.0',
      operationId: 'rollback-1',
      previousDigest: digest,
      restoredDigest: digest,
      status: 'running',
      publicationStatus: 'published',
      evidenceRefs: []
    }
  },
  {
    subject: 'mdeploy.rollback.succeeded.v0',
    schema: Contracts.MDeployRollbackSucceededPayloadSchema,
    fixture: {
      schemaVersion: 'mdeploy.rollback-result@0.1.0',
      operationId: 'rollback-1',
      previousDigest: digest,
      restoredDigest: digest,
      status: 'succeeded',
      publicationStatus: 'published',
      evidenceRefs: [storageRef],
      completedAt: '2026-07-13T00:06:00.000Z'
    }
  },
  {
    subject: 'mdeploy.drift.detected.v0',
    schema: Contracts.MDeployDriftDetectedPayloadSchema,
    fixture: {
      schemaVersion: 'mdeploy.drift-report@0.1.0',
      reportId: 'drift-1',
      agentId: 'agent-1',
      expectedState: { digest, source: 'git' },
      actualState: {
        digest: { algorithm: 'sha256', value: 'sha256:runtime-drift' },
        source: 'runtime'
      },
      driftType: 'runtime_state',
      severity: 'high',
      timestamp: '2026-07-13T00:06:00.000Z'
    }
  },
  {
    subject: 'mdeploy.agent.heartbeat.v0',
    schema: Contracts.MDeployAgentHeartbeatPayloadSchema,
    fixture: {
      schemaVersion: 'mdeploy.agent-heartbeat@0.1.0',
      agentId: 'agent-1',
      timestamp: '2026-07-13T00:05:00.000Z',
      lastAppliedDigest: digest,
      driftStatus: 'none',
      health: 'healthy',
      connectionStatus: 'connected',
      runtimeDrivers: ['podman'],
      correlationId: 'corr-agent'
    }
  },
  {
    subject: 'mdeploy.evidence.emitted.v0',
    schema: Contracts.MDeployEvidenceEmittedPayloadSchema,
    fixture: {
      schemaVersion: 'mdeploy.evidence-metadata@0.1.0',
      operationId: 'apply-1',
      correlationId: 'corr-apply',
      auditId: 'audit-apply',
      evidenceType: 'runtime_apply',
      timestamp: '2026-07-13T00:05:00.000Z',
      storageRef
    }
  }
]
