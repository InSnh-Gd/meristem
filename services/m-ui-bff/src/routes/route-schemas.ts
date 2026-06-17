import { t } from 'elysia'

export const idParamsSchema = t.Object({ id: t.String({ minLength: 1 }) })
export const commandIdParamsSchema = t.Object({ commandId: t.String({ minLength: 1 }) })
export const leafNodeIdBodySchema = t.Object({ leafNodeId: t.String({ minLength: 1 }) })

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

export const genericCommandEligibilityBodySchema = t.Union([
  leafNodeIdBodySchema,
  approvalPreviewBodySchema,
  networkProfilePreviewBodySchema,
  profileDefaultSetBodySchema,
  profileGlobalSwitchPlanBodySchema,
  profileGlobalSwitchApplyBodySchema,
  profileDisablePolicySetBodySchema,
  profileBreakGlassDisableBodySchema
])

export const genericCommandExecuteBodySchema = t.Union([
  leafNodeIdBodySchema,
  approvalExecuteBodySchema,
  profileExecuteBodySchema,
  profileDefaultSetBodySchema,
  profileGlobalSwitchPlanBodySchema,
  profileGlobalSwitchApplyBodySchema,
  profileDisablePolicySetBodySchema,
  profileBreakGlassDisableBodySchema
])
