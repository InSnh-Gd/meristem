import type {
  ActorId,
  MNetClosedLoopAuditEvidenceFromSchema,
  MNetClosedLoopEventSubjectFromSchema,
  MNetClosedLoopPublicationFromSchema,
  MNetEvidenceBundleFromSchema,
  MNetHistoricalProfileVersionFromSchema,
  MNetPendingJoinRequestFromSchema,
  MNetPolicyEvidenceFromSchema,
  MNetProfileV03VersionFromSchema,
  MNetworkMember,
  NetworkSummary,
  Permission,
  RedactedSecretRefFromSchema
} from '../../../../packages/contracts/src/index.ts'
import type { DataPlaneStores } from '../data-plane/data-plane-store-types.ts'
import type { MNetClosedLoopStore } from './closed-loop-store.ts'

export type PolicyDecision = {
  result: 'allow' | 'deny' | 'require_manual_review' | 'require_multi_approval'
  id: string
  reasons: string[]
}

export type ClosedLoopFailure = {
  kind: 'failure'
  status: 400 | 403 | 404 | 409 | 503
  error: { code: string; message: string }
  recovery: 'no_side_effect' | 'compensated' | 'retry_pending' | 'manual_intervention_required'
}

export type ClosedLoopMutationOutcome<T> = {
  kind: 'mutation'
  contractVersion: 'mnet-closed-loop-mutation@0.1.0'
  value: T
  publication: MNetClosedLoopPublicationFromSchema
}

export type CredentialIssuerResult =
  | { ok: true; credentialRef: RedactedSecretRefFromSchema }
  | { ok: false; code: string; message: string }

export type MNetClosedLoopDeps = {
  store: MNetClosedLoopStore
  dataPlane: DataPlaneStores
  now?: () => Date
  id?: (prefix: string) => string
  policy: {
    authorize(actor: ActorId, action: Permission, resource: string): Promise<PolicyDecision>
  }
  log: {
    writeAudit(
      actor: ActorId,
      action: string,
      resource: string,
      result: string,
      correlationId?: string,
      payload?: unknown
    ): Promise<void>
    writeTimeline(summary: string, subject?: string, correlationId?: string): Promise<void>
    writeFull(
      level: string,
      message: string,
      correlationId?: string,
      payload?: unknown
    ): Promise<void>
  }
  events: {
    publish(
      subject: MNetClosedLoopEventSubjectFromSchema,
      type: string,
      payload: unknown,
      correlationId?: string
    ): Promise<void>
  }
  credentials: {
    issue(input: {
      credentialId: string
      networkId: string
      nodeId: string
      value: string
    }): Promise<CredentialIssuerResult>
    rotate(input: {
      credentialId: string
      networkId: string
      nodeId: string
      value: string
    }): Promise<CredentialIssuerResult>
    revoke(input: {
      credentialId: string
      credentialRef: RedactedSecretRefFromSchema
    }): Promise<{ ok: true } | { ok: false; code: string; message: string }>
  }
  network: {
    listNetworks(): Promise<
      | { ok: true; value: NetworkSummary[] }
      | { ok: false; error: { code: string; message: string } }
    >
    listMembers(input: {
      networkId: string
    }): Promise<
      | { ok: true; value: MNetworkMember[] }
      | { ok: false; error: { code: string; message: string } }
    >
  }
  migration: {
    apply(input: {
      networkId: string
      sourceProfileVersion: MNetHistoricalProfileVersionFromSchema
      targetProfileVersion: MNetProfileV03VersionFromSchema
      actor: ActorId
      reason: string
      migrationId: string
    }): Promise<{ ok: true; appliedNetworkIds: string[] } | { ok: false; message: string }>
    rollback(input: {
      networkId: string
      sourceProfileVersion: MNetHistoricalProfileVersionFromSchema
      targetProfileVersion: MNetProfileV03VersionFromSchema
      actor: ActorId
      reason: string
      migrationId: string
    }): Promise<{ ok: true; appliedNetworkIds: string[] } | { ok: false; message: string }>
  }
  onMutation?: (kind: string) => void
}

export type AllowedEvidence = {
  policy: MNetPolicyEvidenceFromSchema
  audit: MNetClosedLoopAuditEvidenceFromSchema
  evidence: MNetEvidenceBundleFromSchema
}

export type SubmitJoinInput = Omit<
  MNetPendingJoinRequestFromSchema,
  'status' | 'requestedAt' | 'policyDecisionId'
> & { correlationId: string }
