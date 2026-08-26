import * as Schema from 'effect/Schema'
import { actorIds } from '../literals.ts'
import { MNetJoinCredentialStatusSchema, MNetNodeKindSchema } from './mnet-closed-loop-facts.ts'
import { MNetProfileV03VersionSchema } from './mnet-profile-v03.ts'
import { RedactedSecretRefSchema } from './secret-provider.ts'

function issue(path: readonly PropertyKey[], message: string): Schema.FilterIssue {
  return { path, message }
}

export const MNetPolicyEvidenceSchema = Schema.Struct({
  policyDecisionId: Schema.String,
  source: Schema.Literal('m-policy'),
  outcome: Schema.Literal('allow', 'deny', 'conditional'),
  requiredPermission: Schema.String,
  reason: Schema.String,
  decidedAt: Schema.String
})
export type MNetPolicyEvidenceFromSchema = typeof MNetPolicyEvidenceSchema.Type

export const MNetClosedLoopAuditEvidenceSchema = Schema.Struct({
  auditId: Schema.String,
  source: Schema.Literal('m-log-audit'),
  action: Schema.String,
  resource: Schema.String,
  actor: Schema.Literal(...actorIds),
  result: Schema.Literal('allowed', 'denied', 'expired', 'auto-revoked', 'rolled-back'),
  writtenAt: Schema.String,
  correlationId: Schema.String
})
export type MNetClosedLoopAuditEvidenceFromSchema = typeof MNetClosedLoopAuditEvidenceSchema.Type

export const MNetLogEvidenceSchema = Schema.Struct({
  timelineId: Schema.optional(Schema.String),
  fullLogId: Schema.optional(Schema.String),
  eventId: Schema.optional(Schema.String),
  subject: Schema.optional(Schema.String),
  correlationId: Schema.String
})
export type MNetLogEvidenceFromSchema = typeof MNetLogEvidenceSchema.Type

export const MNetEvidenceBundleSchema = Schema.Struct({
  policy: MNetPolicyEvidenceSchema,
  audit: MNetClosedLoopAuditEvidenceSchema,
  log: MNetLogEvidenceSchema
})
export type MNetEvidenceBundleFromSchema = typeof MNetEvidenceBundleSchema.Type

export const MNetOperationDeniedSchema = Schema.Struct({
  result: Schema.Literal('denied'),
  reason: Schema.String,
  policy: MNetPolicyEvidenceSchema,
  audit: MNetClosedLoopAuditEvidenceSchema,
  sideEffect: Schema.Literal('none'),
  correlationId: Schema.String
})
export type MNetOperationDeniedFromSchema = typeof MNetOperationDeniedSchema.Type

export const MNetJoinCredentialSchema = Schema.Struct({
  credentialId: Schema.String,
  nodeId: Schema.String,
  networkId: Schema.String,
  profileVersion: MNetProfileV03VersionSchema,
  status: MNetJoinCredentialStatusSchema,
  credentialRef: RedactedSecretRefSchema,
  issuedAt: Schema.String,
  expiresAt: Schema.String,
  rotatedFromCredentialId: Schema.optional(Schema.String),
  revokedAt: Schema.optional(Schema.String),
  revokedByAuditId: Schema.optional(Schema.String)
})
export type MNetJoinCredentialFromSchema = typeof MNetJoinCredentialSchema.Type

export const MNetCredentialOperationStateSchema = Schema.Literal(
  'pending_secret',
  'pending_previous_revoke',
  'completed'
)
export type MNetCredentialOperationStateFromSchema = typeof MNetCredentialOperationStateSchema.Type

/** 凭据操作在外部 SecretProvider 调用前持久化，重启后可继续执行。 */
export const MNetCredentialOperationSchema = Schema.Struct({
  operationId: Schema.String,
  action: Schema.Literal('rotate', 'revoke'),
  state: MNetCredentialOperationStateSchema,
  networkId: Schema.String,
  nodeId: Schema.String,
  previousCredential: MNetJoinCredentialSchema,
  replacementCredentialId: Schema.optional(Schema.String),
  replacementExpiresAt: Schema.optional(Schema.String),
  replacementCredential: Schema.optional(MNetJoinCredentialSchema),
  evidence: MNetEvidenceBundleSchema,
  correlationId: Schema.String,
  createdAt: Schema.String,
  lastError: Schema.optional(Schema.String)
}).pipe(
  Schema.filter(value => {
    const issues: Array<Schema.FilterIssue> = []
    if (
      value.action === 'rotate' &&
      (!value.replacementCredentialId || !value.replacementExpiresAt)
    ) {
      issues.push(
        issue(['replacementCredentialId'], 'credential rotation requires replacement metadata')
      )
    }
    if (value.state === 'pending_previous_revoke' && !value.replacementCredential) {
      issues.push(
        issue(
          ['replacementCredential'],
          'pending previous revocation requires the replacement credential'
        )
      )
    }
    return issues
  })
)
export type MNetCredentialOperationFromSchema = typeof MNetCredentialOperationSchema.Type

export const MNetPendingJoinRequestSchema = Schema.Struct({
  requestId: Schema.String,
  networkId: Schema.String,
  nodeId: Schema.String,
  requestedNodeKind: MNetNodeKindSchema,
  requestedProfileVersion: MNetProfileV03VersionSchema,
  requestedBy: Schema.Literal(...actorIds),
  status: Schema.Literal('pending', 'approved', 'rejected', 'expired'),
  requestedAt: Schema.String,
  expiresAt: Schema.String,
  policyDecisionId: Schema.optional(Schema.String)
})
export type MNetPendingJoinRequestFromSchema = typeof MNetPendingJoinRequestSchema.Type

export const MNetJoinApprovalGrantedSchema = Schema.Struct({
  result: Schema.Literal('approved'),
  request: MNetPendingJoinRequestSchema,
  credential: MNetJoinCredentialSchema,
  evidence: MNetEvidenceBundleSchema,
  correlationId: Schema.String
}).pipe(
  Schema.filter(value => {
    const issues: Array<Schema.FilterIssue> = []
    if (value.request.status !== 'approved')
      issues.push(issue(['request', 'status'], 'approved join requires an approved request'))
    if (value.credential.status !== 'issued')
      issues.push(issue(['credential', 'status'], 'approved join must issue a credential'))
    if (value.evidence.policy.outcome !== 'allow')
      issues.push(issue(['evidence', 'policy', 'outcome'], 'approved join requires M-Policy allow'))
    if (value.evidence.audit.result !== 'allowed')
      issues.push(
        issue(['evidence', 'audit', 'result'], 'approved join requires allowed Audit evidence')
      )
    if (value.request.policyDecisionId !== value.evidence.policy.policyDecisionId)
      issues.push(
        issue(['request', 'policyDecisionId'], 'join request must reference its policy decision')
      )
    if (
      value.request.nodeId !== value.credential.nodeId ||
      value.request.networkId !== value.credential.networkId ||
      value.request.requestedProfileVersion !== value.credential.profileVersion
    )
      issues.push(issue(['credential'], 'issued credential must match the approved join request'))
    return issues
  })
)
export type MNetJoinApprovalGrantedFromSchema = typeof MNetJoinApprovalGrantedSchema.Type

export const MNetJoinApprovalRejectedSchema = Schema.Struct({
  result: Schema.Literal('rejected'),
  request: MNetPendingJoinRequestSchema,
  credential: Schema.Literal(null),
  evidence: MNetEvidenceBundleSchema,
  correlationId: Schema.String
}).pipe(
  Schema.filter(value => {
    const issues: Array<Schema.FilterIssue> = []
    if (value.request.status !== 'rejected')
      issues.push(issue(['request', 'status'], 'rejected join requires a rejected request'))
    if (value.evidence.policy.outcome !== 'allow')
      issues.push(
        issue(['evidence', 'policy', 'outcome'], 'join rejection requires M-Policy allow')
      )
    if (value.evidence.audit.result !== 'allowed')
      issues.push(
        issue(['evidence', 'audit', 'result'], 'join rejection requires allowed Audit evidence')
      )
    if (value.request.policyDecisionId !== value.evidence.policy.policyDecisionId)
      issues.push(
        issue(['request', 'policyDecisionId'], 'join rejection must reference its policy decision')
      )
    return issues
  })
)
export type MNetJoinApprovalRejectedFromSchema = typeof MNetJoinApprovalRejectedSchema.Type

export const MNetJoinApprovalResultSchema = Schema.Union(
  MNetJoinApprovalGrantedSchema,
  MNetJoinApprovalRejectedSchema
)
export type MNetJoinApprovalResultFromSchema = typeof MNetJoinApprovalResultSchema.Type

export const MNetCredentialLifecycleActionSchema = Schema.Literal(
  'issue',
  'rotate',
  'revoke',
  'expire'
)
export type MNetCredentialLifecycleActionFromSchema =
  typeof MNetCredentialLifecycleActionSchema.Type

export const MNetCredentialLifecycleResultSchema = Schema.Struct({
  result: Schema.Literal('issued', 'rotated', 'revoked', 'expired'),
  action: MNetCredentialLifecycleActionSchema,
  credential: MNetJoinCredentialSchema,
  previousCredentialId: Schema.optional(Schema.String),
  existingTunnelsInvalidated: Schema.Boolean,
  evidence: MNetEvidenceBundleSchema,
  correlationId: Schema.String
}).pipe(
  Schema.filter(value => {
    const issues: Array<Schema.FilterIssue> = []
    const expectedResult = {
      issue: 'issued',
      rotate: 'rotated',
      revoke: 'revoked',
      expire: 'expired'
    } as const
    const expectedStatus = {
      issue: 'issued',
      rotate: 'issued',
      revoke: 'revoked',
      expire: 'expired'
    } as const
    const mustInvalidateTunnels = value.action !== 'issue'

    if (value.result !== expectedResult[value.action])
      issues.push(issue(['result'], 'credential result must match its lifecycle action'))
    if (value.credential.status !== expectedStatus[value.action])
      issues.push(
        issue(['credential', 'status'], 'credential status must match its lifecycle action')
      )
    if (value.existingTunnelsInvalidated !== mustInvalidateTunnels)
      issues.push(
        issue(
          ['existingTunnelsInvalidated'],
          'credential lifecycle must fail closed for existing tunnels'
        )
      )
    if (value.evidence.policy.outcome !== 'allow')
      issues.push(
        issue(['evidence', 'policy', 'outcome'], 'credential lifecycle requires M-Policy allow')
      )
    if (value.action === 'rotate') {
      if (!value.previousCredentialId)
        issues.push(
          issue(['previousCredentialId'], 'credential rotation requires the previous credential')
        )
      if (value.credential.rotatedFromCredentialId !== value.previousCredentialId)
        issues.push(
          issue(
            ['credential', 'rotatedFromCredentialId'],
            'rotated credential must reference the previous credential'
          )
        )
    }
    if (
      value.action === 'revoke' &&
      (!value.credential.revokedAt || !value.credential.revokedByAuditId)
    )
      issues.push(
        issue(['credential'], 'revoked credential requires revocation time and Audit evidence')
      )
    return issues
  })
)
export type MNetCredentialLifecycleResultFromSchema =
  typeof MNetCredentialLifecycleResultSchema.Type
