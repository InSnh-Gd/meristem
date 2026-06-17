import { t } from 'elysia'

export const internalErrorSchema = t.Object({
  error: t.Object({
    code: t.String(),
    message: t.String()
  })
})

export const externalErrorSchema = t.Object({
  error: t.Object({
    code: t.String(),
    message: t.String()
  })
})

export const networkSchema = t.Object({
  id: t.String(),
  name: t.String(),
  profileVersion: t.String(),
  status: t.Literal('active'),
  createdAt: t.String()
})

export const networkSummarySchema = t.Object({
  id: t.String(),
  name: t.String(),
  profileVersion: t.String(),
  status: t.Literal('active'),
  createdAt: t.String(),
  memberCount: t.Number()
})

export const networkMemberSchema = t.Object({
  networkId: t.String(),
  nodeId: t.String(),
  nodeKind: t.Union([t.Literal('stem'), t.Literal('leaf')]),
  membershipMode: t.Union([t.Literal('full'), t.Literal('restricted')]),
  status: t.Literal('joined'),
  joinedAt: t.String()
})

export const taskExecuteResponseSchema = t.Object({
  nodeId: t.String(),
  taskId: t.String(),
  result: t.Literal('completed'),
  completedAt: t.String()
})

export const networkIdParamsSchema = t.Object({
  id: t.String({ minLength: 1 })
})

export const profileVersionParamsSchema = t.Object({
  profileVersion: t.String({ minLength: 1 })
})

export const operationIdParamsSchema = t.Object({
  id: t.String({ minLength: 1 })
})

export const createNetworkBodySchema = t.Object({
  name: t.String({ minLength: 1 }),
  profileVersion: t.Optional(t.String({ minLength: 1 }))
})

export const joinNetworkBodySchema = t.Object({
  nodeId: t.String({ minLength: 1 })
})

export const executeNoopBodySchema = t.Object({
  nodeId: t.String({ minLength: 1 }),
  taskId: t.String({ minLength: 1 }),
  correlationId: t.String({ minLength: 1 })
})

export const setNetworkProfileBodySchema = t.Object({
  profileVersion: t.Union([t.Literal('m-net-cn@0.1.0'), t.Literal('m-net-default@0.1.0')]),
  reason: t.String({ minLength: 1 })
})

export const setNetworkProfileResponseSchema = t.Union([
  t.Object({
    status: t.Literal('pending_approval'),
    operationId: t.String(),
    approvalId: t.Optional(t.String()),
    correlationId: t.String()
  }),
  t.Object({
    status: t.Literal('disabled'),
    profileVersion: t.String(),
    correlationId: t.String()
  })
])

export const breakGlassDisableBodySchema = t.Object({
  emergencyReason: t.String(),
  /** 客户端传值将被忽略——服务端自行检测 */
  approvalDegraded: t.Optional(t.Boolean())
})

export const breakGlassDisableResponseSchema = t.Object({
  operationId: t.String(),
  profileVersion: t.String(),
  status: t.Literal('disabled'),
  approvalDegraded: t.Boolean(),
  degradationSource: t.Optional(t.String()),
  auditId: t.String(),
  fullLogId: t.String(),
  correlationId: t.String()
})

export const disablePolicyBodySchema = t.Object({
  requireApproval: t.Boolean(),
  emergencyBreakGlassEnabled: t.Boolean(),
  reason: t.String({ minLength: 1 }),
  idempotencyKey: t.String({ minLength: 1 })
})

export const disablePolicyResponseSchema = t.Object({
  requireApproval: t.Boolean(),
  emergencyBreakGlassEnabled: t.Boolean(),
  reason: t.String(),
  idempotencyKey: t.String(),
  updatedAt: t.String()
})

export function internalResponse<
  TSuccess extends ReturnType<typeof t.Object>,
  const TExtra extends Record<number, ReturnType<typeof t.Object>> = Record<number, never>
>(success: TSuccess, extra?: TExtra) {
  return {
    200: success,
    401: internalErrorSchema,
    ...(extra ?? {})
  } as const
}

export const externalReadErrorResponses = {
  401: externalErrorSchema,
  403: externalErrorSchema,
  404: externalErrorSchema,
  503: externalErrorSchema
} as const

export const externalWriteErrorResponses = {
  401: externalErrorSchema,
  403: externalErrorSchema,
  404: externalErrorSchema,
  409: externalErrorSchema,
  503: externalErrorSchema
} as const

export const externalBreakGlassErrorResponses = {
  400: externalErrorSchema,
  401: externalErrorSchema,
  403: externalErrorSchema,
  404: externalErrorSchema,
  409: externalErrorSchema,
  503: externalErrorSchema
} as const
