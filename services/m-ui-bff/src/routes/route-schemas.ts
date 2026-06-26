import { t } from 'elysia'

export const idParamsSchema = t.Object({ id: t.String({ minLength: 1 }) })
export const commandIdParamsSchema = t.Object({ commandId: t.String({ minLength: 1 }) })
export const leafNodeIdBodySchema = t.Object({ leafNodeId: t.String({ minLength: 1 }) })
export const networkIdParamsSchema = t.Object({ id: t.String({ minLength: 1 }) })
export const networkNodeParamsSchema = t.Object({
  id: t.String({ minLength: 1 }),
  nodeId: t.String({ minLength: 1 })
})

export const joinTicketCreateBodySchema = t.Object({
  kind: t.Union([t.Literal('stem'), t.Literal('leaf')]),
  name: t.String({ minLength: 1 }),
  capabilities: t.Optional(t.Array(t.String())),
  expiresInSeconds: t.Optional(t.Number({ minimum: 30, maximum: 3600 }))
})

export const credentialRevokeBodySchema = t.Object({
  reason: t.Optional(t.String({ minLength: 1 }))
})

export const profileToggleBodySchema = t.Object({
  profileVersion: t.String({ minLength: 1 }),
  reason: t.Optional(t.String({ minLength: 1 }))
})

export const breakGlassBodySchema = t.Object({
  confirmation: t.String({ minLength: 1 }),
  emergencyReason: t.Optional(t.String({ minLength: 1 }))
})

export const networkDefaultsBodySchema = t.Object({
  profileVersion: t.String({ minLength: 1 }),
  reason: t.Optional(t.String({ minLength: 1 })),
  idempotencyKey: t.Optional(t.String({ minLength: 1 }))
})

export const migrationDryRunBodySchema = t.Object({
  targetProfileVersion: t.String({ minLength: 1 }),
  batchSize: t.Optional(t.Number({ minimum: 1 })),
  reason: t.Optional(t.String({ minLength: 1 })),
  idempotencyKey: t.Optional(t.String({ minLength: 1 }))
})

export const migrationOperationBodySchema = t.Object({
  operationId: t.String({ minLength: 1 })
})

export const migrationRollbackBodySchema = t.Object({
  operationId: t.String({ minLength: 1 }),
  reason: t.Optional(t.String({ minLength: 1 }))
})

/** 审批执行请求体 schema：approvalId 必填，reason 可选 */
export const approvalExecuteBodySchema = t.Object({
  approvalId: t.String({ minLength: 1 }),
  reason: t.Optional(t.String())
})

/** Profile 执行请求体 schema：networkId 与 profileVersion 必填，reason 可选 */
export const profileExecuteBodySchema = t.Object({
  networkId: t.String({ minLength: 1 }),
  profileVersion: t.String({ minLength: 1 }),
  reason: t.Optional(t.String())
})

export const approvalPreviewBodySchema = t.Object({
  approvalId: t.String({ minLength: 1 })
})

export const networkProfilePreviewBodySchema = t.Object({
  networkId: t.String({ minLength: 1 }),
  profileVersion: t.String({ minLength: 1 })
})

export const profileDefaultSetBodySchema = t.Object({
  profileVersion: t.String({ minLength: 1 }),
  reason: t.Optional(t.String({ minLength: 1 })),
  idempotencyKey: t.Optional(t.String({ minLength: 1 }))
})

export const profileGlobalSwitchPlanBodySchema = t.Object({
  targetProfileVersion: t.String({ minLength: 1 }),
  batchSize: t.Optional(t.Number({ minimum: 1 })),
  reason: t.Optional(t.String({ minLength: 1 })),
  idempotencyKey: t.Optional(t.String({ minLength: 1 }))
})

export const profileGlobalSwitchApplyBodySchema = t.Object({
  operationId: t.String({ minLength: 1 })
})

export const profileDisablePolicySetBodySchema = t.Object({
  requireApproval: t.Boolean(),
  emergencyBreakGlassEnabled: t.Boolean(),
  reason: t.Optional(t.String({ minLength: 1 })),
  idempotencyKey: t.Optional(t.String({ minLength: 1 }))
})

export const profileBreakGlassDisableBodySchema = t.Object({
  networkId: t.String({ minLength: 1 }),
  emergencyReason: t.Optional(t.String())
})

export const mnetJoinTicketEligibilityBodySchema = t.Object({
  networkId: t.String({ minLength: 1 })
})

export const mnetBreakGlassEligibilityBodySchema = t.Object({
  networkId: t.String({ minLength: 1 })
})

export const mnetMigrationEligibilityBodySchema = t.Object({
  scope: t.Optional(t.String())
})

export const mnetCredentialEligibilityBodySchema = t.Object({
  networkId: t.String({ minLength: 1 }),
  nodeId: t.String({ minLength: 1 })
})

export const nodeControlCommandBodySchema = t.Object({
  nodeId: t.String({ minLength: 1 }),
  reason: t.Optional(t.String({ minLength: 1 }))
})

export const genericCommandEligibilityBodySchema = t.Union([
  leafNodeIdBodySchema,
  approvalPreviewBodySchema,
  networkProfilePreviewBodySchema,
  profileDefaultSetBodySchema,
  profileGlobalSwitchPlanBodySchema,
  profileGlobalSwitchApplyBodySchema,
  profileDisablePolicySetBodySchema,
  profileBreakGlassDisableBodySchema,
  mnetJoinTicketEligibilityBodySchema,
  mnetBreakGlassEligibilityBodySchema,
  mnetMigrationEligibilityBodySchema,
  mnetCredentialEligibilityBodySchema,
  nodeControlCommandBodySchema
])

export const genericCommandExecuteBodySchema = t.Union([
  leafNodeIdBodySchema,
  approvalExecuteBodySchema,
  profileExecuteBodySchema,
  profileDefaultSetBodySchema,
  profileGlobalSwitchPlanBodySchema,
  profileGlobalSwitchApplyBodySchema,
  profileDisablePolicySetBodySchema,
  profileBreakGlassDisableBodySchema,
  joinTicketCreateBodySchema,
  profileToggleBodySchema,
  breakGlassBodySchema,
  networkDefaultsBodySchema,
  migrationDryRunBodySchema,
  migrationOperationBodySchema,
  migrationRollbackBodySchema,
  credentialRevokeBodySchema,
  mnetCredentialEligibilityBodySchema,
  nodeControlCommandBodySchema
])
