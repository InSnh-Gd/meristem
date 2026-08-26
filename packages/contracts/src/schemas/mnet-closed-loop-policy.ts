import * as Schema from 'effect/Schema'
import {
  MNetNodeSelectorSchema,
  MNetProfileV03VersionSchema,
  MNetRouteClassSchema
} from './mnet-profile-v03.ts'
import { MNetHistoricalProfileVersionSchema } from './mnet-profile.ts'
import {
  MNetRelayPolicyStateSchema,
  MNetSidecarDegradedStatusSchema,
  MNetSignedTopologyMapStatusSchema,
  MNetTopologyViewSchema,
  MNetTunnelHealthSchema
} from './mnet-closed-loop-facts.ts'
import {
  MNetCredentialLifecycleResultSchema,
  MNetEvidenceBundleSchema,
  MNetJoinApprovalGrantedSchema,
  MNetJoinApprovalRejectedSchema,
  MNetOperationDeniedSchema,
  MNetPendingJoinRequestSchema
} from './mnet-closed-loop-evidence.ts'

const breakGlassTtlMs = 30 * 60 * 1000

function issue(path: readonly PropertyKey[], message: string): Schema.FilterIssue {
  return { path, message }
}

export const MNetForcedRelayPolicyResultSchema = Schema.Union(
  Schema.Struct({
    result: Schema.Literal('enabled', 'disabled'),
    relayPolicyId: Schema.String,
    networkId: Schema.String,
    state: MNetRelayPolicyStateSchema,
    routeClass: MNetRouteClassSchema,
    selector: MNetNodeSelectorSchema,
    reason: Schema.String,
    affectedNodeIds: Schema.Array(Schema.String),
    evidence: MNetEvidenceBundleSchema,
    correlationId: Schema.String
  }).pipe(
    Schema.filter(value => {
      const issues: Array<Schema.FilterIssue> = []
      if (value.state !== value.result)
        issues.push(issue(['state'], 'relay policy state must match the applied result'))
      if (value.evidence.policy.outcome !== 'allow')
        issues.push(
          issue(['evidence', 'policy', 'outcome'], 'relay policy change requires M-Policy allow')
        )
      if (value.evidence.audit.result !== 'allowed')
        issues.push(
          issue(
            ['evidence', 'audit', 'result'],
            'relay policy change requires allowed Audit evidence'
          )
        )
      return issues
    })
  ),
  MNetOperationDeniedSchema
)
export type MNetForcedRelayPolicyResultFromSchema = typeof MNetForcedRelayPolicyResultSchema.Type

export const MNetProfileMigrationStateSchema = Schema.Literal(
  'planned',
  'pending_approval',
  'running',
  'succeeded',
  'rollback_available',
  'rolling_back',
  'rolled_back',
  'failed'
)
export type MNetProfileMigrationStateFromSchema = typeof MNetProfileMigrationStateSchema.Type

export const MNetProfileMigrationResultSchema = Schema.Struct({
  migrationId: Schema.String,
  networkId: Schema.String,
  sourceProfileVersion: MNetHistoricalProfileVersionSchema,
  targetProfileVersion: MNetProfileV03VersionSchema,
  state: MNetProfileMigrationStateSchema,
  appliedNetworkIds: Schema.Array(Schema.String),
  rollbackProfileVersion: MNetHistoricalProfileVersionSchema,
  rollbackState: Schema.Literal('not-needed', 'available', 'in-progress', 'completed', 'failed'),
  evidence: MNetEvidenceBundleSchema,
  correlationId: Schema.String
}).pipe(
  Schema.filter(value => {
    const issues: Array<Schema.FilterIssue> = []
    const expectedRollbackState = {
      rollback_available: 'available',
      rolling_back: 'in-progress',
      rolled_back: 'completed'
    } as const
    if (value.state in expectedRollbackState) {
      const state = value.state as keyof typeof expectedRollbackState
      if (value.rollbackState !== expectedRollbackState[state])
        issues.push(issue(['rollbackState'], 'migration rollback state must match migration state'))
    }
    if (value.evidence.policy.outcome !== 'allow')
      issues.push(
        issue(['evidence', 'policy', 'outcome'], 'profile migration requires M-Policy allow')
      )
    return issues
  })
)
export type MNetProfileMigrationResultFromSchema = typeof MNetProfileMigrationResultSchema.Type

export const MNetBreakGlassStateSchema = Schema.Literal(
  'initiated',
  'second_approval_pending',
  'active',
  'auto_revoked'
)
export type MNetBreakGlassStateFromSchema = typeof MNetBreakGlassStateSchema.Type

export const MNetBreakGlassGrantSchema = Schema.Struct({
  grantId: Schema.String,
  networkId: Schema.String,
  initiatedBy: Schema.Literal('security-admin'),
  secondApprover: Schema.optional(Schema.Literal('break-glass-reviewer')),
  state: MNetBreakGlassStateSchema,
  ttlMinutes: Schema.Literal(30),
  initiatedAt: Schema.String,
  expiresAt: Schema.String,
  autoRevokedAt: Schema.optional(Schema.String),
  requiresNormalApprovalAfterExpiry: Schema.Literal(true),
  evidence: MNetEvidenceBundleSchema,
  correlationId: Schema.String
}).pipe(
  Schema.filter(value => {
    const issues: Array<Schema.FilterIssue> = []
    const initiatedAt = Date.parse(value.initiatedAt)
    const expiresAt = Date.parse(value.expiresAt)
    const approved = value.state === 'active' || value.state === 'auto_revoked'

    if (
      !Number.isFinite(initiatedAt) ||
      !Number.isFinite(expiresAt) ||
      expiresAt - initiatedAt !== breakGlassTtlMs
    )
      issues.push(
        issue(['expiresAt'], 'break-glass expiry must be exactly 30 minutes after initiation')
      )
    if (approved && value.secondApprover !== 'break-glass-reviewer')
      issues.push(
        issue(['secondApprover'], 'active break-glass requires an independent second approver')
      )
    if (!approved && value.secondApprover)
      issues.push(issue(['secondApprover'], 'pending break-glass must not claim second approval'))
    if (approved && value.evidence.policy.outcome !== 'allow')
      issues.push(
        issue(['evidence', 'policy', 'outcome'], 'active break-glass requires M-Policy allow')
      )
    if (value.state === 'auto_revoked') {
      if (value.autoRevokedAt !== value.expiresAt)
        issues.push(issue(['autoRevokedAt'], 'break-glass must auto-revoke at TTL expiry'))
      if (value.evidence.audit.result !== 'auto-revoked')
        issues.push(
          issue(['evidence', 'audit', 'result'], 'auto-revoke requires M-Log Audit evidence')
        )
    } else if (value.autoRevokedAt) {
      issues.push(issue(['autoRevokedAt'], 'auto-revoke time is only valid after TTL expiry'))
    }
    return issues
  })
)
export type MNetBreakGlassGrantFromSchema = typeof MNetBreakGlassGrantSchema.Type

export const MNetClosedLoopEventSubjectSchema = Schema.Literal(
  'mnet.join.requested.v0',
  'mnet.join.approved.v0',
  'mnet.join.rejected.v0',
  'mnet.credential.issued.v0',
  'mnet.credential.rotated.v0',
  'mnet.credential.revoked.v0',
  'mnet.topology.view.updated.v0',
  'mnet.topology.map.status.v0',
  'mnet.tunnel.health.v0',
  'mnet.relay_policy.changed.v0',
  'mnet.profile.migration.changed.v0',
  'mnet.break_glass.changed.v0',
  'mnet.sidecar.degraded.v0'
)
export type MNetClosedLoopEventSubjectFromSchema = typeof MNetClosedLoopEventSubjectSchema.Type

export const MNetClosedLoopPublicationStatusSchema = Schema.Literal('pending', 'published')
export type MNetClosedLoopPublicationStatusFromSchema =
  typeof MNetClosedLoopPublicationStatusSchema.Type

export const MNetClosedLoopPublicationSchema = Schema.Struct({
  status: MNetClosedLoopPublicationStatusSchema,
  pendingSubjects: Schema.Array(MNetClosedLoopEventSubjectSchema)
})
export type MNetClosedLoopPublicationFromSchema = typeof MNetClosedLoopPublicationSchema.Type

export const MNetClosedLoopMutationContractVersionSchema = Schema.Literal(
  'mnet-closed-loop-mutation@0.1.0'
)
export type MNetClosedLoopMutationContractVersionFromSchema =
  typeof MNetClosedLoopMutationContractVersionSchema.Type

export const MNetClosedLoopEventEnvelopeSchema = Schema.Union(
  Schema.Struct({
    subject: Schema.Literal('mnet.join.requested.v0'),
    payload: MNetPendingJoinRequestSchema
  }),
  Schema.Struct({
    subject: Schema.Literal('mnet.join.approved.v0'),
    payload: MNetJoinApprovalGrantedSchema
  }),
  Schema.Struct({
    subject: Schema.Literal('mnet.join.rejected.v0'),
    payload: MNetJoinApprovalRejectedSchema
  }),
  Schema.Struct({
    subject: Schema.Literal('mnet.credential.issued.v0'),
    payload: MNetCredentialLifecycleResultSchema
  }),
  Schema.Struct({
    subject: Schema.Literal('mnet.credential.rotated.v0'),
    payload: MNetCredentialLifecycleResultSchema
  }),
  Schema.Struct({
    subject: Schema.Literal('mnet.credential.revoked.v0'),
    payload: MNetCredentialLifecycleResultSchema
  }),
  Schema.Struct({
    subject: Schema.Literal('mnet.topology.view.updated.v0'),
    payload: MNetTopologyViewSchema
  }),
  Schema.Struct({
    subject: Schema.Literal('mnet.topology.map.status.v0'),
    payload: MNetSignedTopologyMapStatusSchema
  }),
  Schema.Struct({
    subject: Schema.Literal('mnet.tunnel.health.v0'),
    payload: MNetTunnelHealthSchema
  }),
  Schema.Struct({
    subject: Schema.Literal('mnet.relay_policy.changed.v0'),
    payload: MNetForcedRelayPolicyResultSchema
  }),
  Schema.Struct({
    subject: Schema.Literal('mnet.profile.migration.changed.v0'),
    payload: MNetProfileMigrationResultSchema
  }),
  Schema.Struct({
    subject: Schema.Literal('mnet.break_glass.changed.v0'),
    payload: MNetBreakGlassGrantSchema
  }),
  Schema.Struct({
    subject: Schema.Literal('mnet.sidecar.degraded.v0'),
    payload: MNetSidecarDegradedStatusSchema
  })
)
export type MNetClosedLoopEventEnvelopeFromSchema = typeof MNetClosedLoopEventEnvelopeSchema.Type
