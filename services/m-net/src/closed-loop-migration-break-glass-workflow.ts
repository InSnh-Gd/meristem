import type {
  ActorId,
  MNetBreakGlassGrantFromSchema,
  MNetClosedLoopAuditEvidenceFromSchema,
  MNetHistoricalProfileVersionFromSchema,
  MNetOperationDeniedFromSchema,
  MNetProfileMigrationResultFromSchema,
  MNetProfileV03VersionFromSchema
} from '../../../packages/contracts/src/index.ts'
import type { ClosedLoopWorkflowContext } from './closed-loop-workflow-support.ts'
import { closedLoopFailure, closedLoopFailureFromUnknown } from './closed-loop-workflow-support.ts'
import type { ClosedLoopFailure, ClosedLoopMutationOutcome } from './closed-loop-workflow-types.ts'

const BREAK_GLASS_TTL_MS = 30 * 60 * 1000

/** Profile migration and emergency grants share rollback/expiry enforcement semantics. */
export function createMigrationBreakGlassWorkflow(context: ClosedLoopWorkflowContext) {
  const { deps, id, now, timestamp, authorizeAndAudit, writeAuditEvidence, commitMutation } =
    context

  async function migrateProfile(input: {
    actor: ActorId
    networkId: string
    sourceProfileVersion: MNetHistoricalProfileVersionFromSchema
    targetProfileVersion: MNetProfileV03VersionFromSchema
    reason: string
  }): Promise<
    | ClosedLoopMutationOutcome<MNetProfileMigrationResultFromSchema>
    | MNetOperationDeniedFromSchema
    | ClosedLoopFailure
  > {
    const migrationId = id('migration')
    const correlationId = id('correlation')
    const gated = await authorizeAndAudit({
      actor: input.actor,
      permission: 'network:profile-enable',
      auditAction: 'mnet.profile.migration.apply',
      resource: `network:${input.networkId}:profile`,
      correlationId,
      payload: { reason: input.reason, targetProfileVersion: input.targetProfileVersion }
    })
    if ('kind' in gated || 'result' in gated) return gated
    const applied = await deps.migration.apply({ ...input, migrationId })
    if (!applied.ok) {
      return closedLoopFailure(503, 'mnet.profile.migration_failed', applied.message)
    }
    const result: MNetProfileMigrationResultFromSchema = {
      migrationId,
      networkId: input.networkId,
      sourceProfileVersion: input.sourceProfileVersion,
      targetProfileVersion: input.targetProfileVersion,
      state: 'rollback_available',
      appliedNetworkIds: applied.appliedNetworkIds,
      rollbackProfileVersion: input.sourceProfileVersion,
      rollbackState: 'available',
      evidence: gated.evidence,
      correlationId
    }
    try {
      return await commitMutation({
        networkId: input.networkId,
        correlationId,
        mutationKind: 'profile-migration-applied',
        value: result,
        facts: [{ kind: 'migration', value: result }],
        events: [{ subject: 'mnet.profile.migration.changed.v0', payload: result }]
      })
    } catch (error) {
      const compensation = await deps.migration.rollback({ ...input, migrationId })
      const failure = closedLoopFailureFromUnknown(error)
      return {
        ...failure,
        recovery: compensation.ok ? 'compensated' : 'manual_intervention_required'
      }
    }
  }

  async function rollbackProfile(input: {
    actor: ActorId
    migrationId: string
    reason: string
  }): Promise<
    | ClosedLoopMutationOutcome<MNetProfileMigrationResultFromSchema>
    | MNetOperationDeniedFromSchema
    | ClosedLoopFailure
  > {
    const migration = await deps.store.migrations.get(input.migrationId)
    if (!migration) {
      return closedLoopFailure(404, 'mnet.profile.migration_not_found', 'migration not found')
    }
    if (migration.rollbackState !== 'available') {
      return closedLoopFailure(
        409,
        'mnet.profile.rollback_unavailable',
        'migration rollback is unavailable'
      )
    }
    const correlationId = id('correlation')
    const gated = await authorizeAndAudit({
      actor: input.actor,
      permission: 'network:profile-disable',
      auditAction: 'mnet.profile.migration.rollback',
      resource: `network:${migration.networkId}:profile`,
      correlationId,
      payload: { migrationId: migration.migrationId, reason: input.reason }
    })
    if ('kind' in gated || 'result' in gated) return gated
    const rolledBack = await deps.migration.rollback({
      networkId: migration.networkId,
      sourceProfileVersion: migration.sourceProfileVersion,
      targetProfileVersion: migration.targetProfileVersion,
      actor: input.actor,
      reason: input.reason,
      migrationId: migration.migrationId
    })
    if (!rolledBack.ok) {
      return closedLoopFailure(503, 'mnet.profile.rollback_failed', rolledBack.message)
    }
    const rollbackAudit: MNetClosedLoopAuditEvidenceFromSchema = {
      ...gated.audit,
      result: 'rolled-back'
    }
    const result: MNetProfileMigrationResultFromSchema = {
      ...migration,
      state: 'rolled_back',
      appliedNetworkIds: rolledBack.appliedNetworkIds,
      rollbackState: 'completed',
      evidence: { ...gated.evidence, audit: rollbackAudit },
      correlationId
    }
    try {
      return await commitMutation({
        networkId: migration.networkId,
        correlationId,
        mutationKind: 'profile-migration-rolled-back',
        value: result,
        facts: [{ kind: 'migration', value: result }],
        events: [{ subject: 'mnet.profile.migration.changed.v0', payload: result }]
      })
    } catch (error) {
      const compensation = await deps.migration.apply({
        networkId: migration.networkId,
        sourceProfileVersion: migration.sourceProfileVersion,
        targetProfileVersion: migration.targetProfileVersion,
        actor: input.actor,
        reason: `compensate failed rollback: ${input.reason}`,
        migrationId: migration.migrationId
      })
      const failure = closedLoopFailureFromUnknown(error)
      return {
        ...failure,
        recovery: compensation.ok ? 'compensated' : 'manual_intervention_required'
      }
    }
  }

  async function denyRole(input: {
    actor: ActorId
    action: string
    resource: string
    code: string
    message: string
  }): Promise<ClosedLoopFailure> {
    const correlationId = id('correlation')
    const audit = await writeAuditEvidence({
      actor: input.actor,
      action: input.action,
      resource: input.resource,
      result: 'denied',
      correlationId,
      payload: { reason: input.message }
    })
    if ('kind' in audit) return audit
    return closedLoopFailure(403, input.code, input.message)
  }

  async function initiateBreakGlass(input: {
    actor: ActorId
    networkId: string
    reason: string
  }): Promise<
    | ClosedLoopMutationOutcome<MNetBreakGlassGrantFromSchema>
    | MNetOperationDeniedFromSchema
    | ClosedLoopFailure
  > {
    const resource = `network:${input.networkId}:break-glass`
    if (input.actor !== 'security-admin') {
      return denyRole({
        actor: input.actor,
        action: 'network:break-glass-initiate',
        resource,
        code: 'mnet.break_glass.security_admin_required',
        message: 'security-admin required'
      })
    }
    const correlationId = id('correlation')
    const gated = await authorizeAndAudit({
      actor: input.actor,
      permission: 'node:isolate',
      auditAction: 'mnet.break_glass.initiate',
      resource,
      correlationId,
      payload: { reason: input.reason }
    })
    if ('kind' in gated || 'result' in gated) return gated
    const initiatedAt = timestamp()
    const grant: MNetBreakGlassGrantFromSchema = {
      grantId: id('break-glass'),
      networkId: input.networkId,
      initiatedBy: 'security-admin',
      state: 'second_approval_pending',
      ttlMinutes: 30,
      initiatedAt,
      expiresAt: new Date(Date.parse(initiatedAt) + BREAK_GLASS_TTL_MS).toISOString(),
      requiresNormalApprovalAfterExpiry: true,
      evidence: gated.evidence,
      correlationId
    }
    try {
      return await commitMutation({
        networkId: input.networkId,
        correlationId,
        mutationKind: 'break-glass-initiated',
        value: grant,
        facts: [{ kind: 'break-glass', value: grant }],
        events: [{ subject: 'mnet.break_glass.changed.v0', payload: grant }]
      })
    } catch (error) {
      return closedLoopFailureFromUnknown(error)
    }
  }

  async function approveBreakGlass(input: {
    actor: ActorId
    grantId: string
  }): Promise<
    | ClosedLoopMutationOutcome<MNetBreakGlassGrantFromSchema>
    | MNetOperationDeniedFromSchema
    | ClosedLoopFailure
  > {
    const grant = await deps.store.breakGlass.get(input.grantId)
    if (!grant) {
      return closedLoopFailure(404, 'mnet.break_glass.not_found', 'break-glass grant not found')
    }
    if (input.actor !== 'break-glass-reviewer') {
      return denyRole({
        actor: input.actor,
        action: 'network:break-glass-approve',
        resource: `network:${grant.networkId}:break-glass:${grant.grantId}`,
        code: 'mnet.break_glass.independent_reviewer_required',
        message: 'independent reviewer required'
      })
    }
    if (grant.state !== 'second_approval_pending') {
      return closedLoopFailure(
        409,
        'mnet.break_glass.not_pending',
        'break-glass grant is not pending review'
      )
    }
    if (now().getTime() >= Date.parse(grant.expiresAt)) {
      const expiryResult = await enforceBreakGlassExpiry(grant.grantId)
      if ('kind' in expiryResult) return expiryResult
      return closedLoopFailure(
        409,
        'mnet.break_glass.not_pending',
        'break-glass grant is no longer pending review'
      )
    }
    const correlationId = id('correlation')
    const gated = await authorizeAndAudit({
      actor: input.actor,
      permission: 'policy:approval-approve',
      auditAction: 'mnet.break_glass.approve',
      resource: `network:${grant.networkId}:break-glass:${grant.grantId}`,
      correlationId
    })
    if ('kind' in gated || 'result' in gated) return gated
    const active: MNetBreakGlassGrantFromSchema = {
      ...grant,
      secondApprover: 'break-glass-reviewer',
      state: 'active',
      evidence: gated.evidence,
      correlationId
    }
    try {
      return await commitMutation({
        networkId: grant.networkId,
        correlationId,
        mutationKind: 'break-glass-activated',
        value: active,
        facts: [{ kind: 'break-glass', value: active }],
        events: [{ subject: 'mnet.break_glass.changed.v0', payload: active }]
      })
    } catch (error) {
      return closedLoopFailureFromUnknown(error)
    }
  }

  async function enforceBreakGlassExpiry(
    grantId: string
  ): Promise<
    | MNetBreakGlassGrantFromSchema
    | ClosedLoopMutationOutcome<MNetBreakGlassGrantFromSchema>
    | ClosedLoopFailure
  > {
    const grant = await deps.store.breakGlass.get(grantId)
    if (!grant) {
      return closedLoopFailure(404, 'mnet.break_glass.not_found', 'break-glass grant not found')
    }
    if (grant.state === 'auto_revoked') return grant
    if (now().getTime() < Date.parse(grant.expiresAt)) return grant
    const correlationId = id('correlation')
    const audit = await writeAuditEvidence({
      actor: grant.initiatedBy,
      action: 'network:break-glass-auto-revoke',
      resource: `network:${grant.networkId}:break-glass:${grant.grantId}`,
      result: 'auto-revoked',
      correlationId,
      payload: { expiresAt: grant.expiresAt }
    })
    if ('kind' in audit) return audit
    const revoked: MNetBreakGlassGrantFromSchema = {
      ...grant,
      state: 'auto_revoked',
      autoRevokedAt: grant.expiresAt,
      evidence: { ...grant.evidence, audit, log: { correlationId } },
      correlationId
    }
    try {
      return await commitMutation({
        networkId: grant.networkId,
        correlationId,
        mutationKind: 'break-glass-auto-revoked',
        value: revoked,
        facts: [{ kind: 'break-glass', value: revoked }],
        events: [{ subject: 'mnet.break_glass.changed.v0', payload: revoked }]
      })
    } catch (error) {
      return closedLoopFailureFromUnknown(error)
    }
  }

  async function enforceExpiredBreakGlass(): Promise<number> {
    const expirable = await deps.store.breakGlass.listExpirable()
    let revoked = 0
    for (const grant of expirable) {
      if (now().getTime() < Date.parse(grant.expiresAt)) continue
      const result = await enforceBreakGlassExpiry(grant.grantId)
      if (
        (!('kind' in result) && result.state === 'auto_revoked') ||
        ('kind' in result && result.kind === 'mutation' && result.value.state === 'auto_revoked')
      ) {
        revoked += 1
      }
    }
    return revoked
  }

  async function isBreakGlassActive(grantId: string): Promise<boolean> {
    const enforced = await enforceBreakGlassExpiry(grantId)
    if ('kind' in enforced) {
      return enforced.kind === 'mutation' && enforced.value.state === 'active'
    }
    return enforced.state === 'active'
  }

  return {
    migrateProfile,
    rollbackProfile,
    initiateBreakGlass,
    approveBreakGlass,
    enforceBreakGlassExpiry,
    enforceExpiredBreakGlass,
    isBreakGlassActive
  }
}
