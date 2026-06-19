import { t } from 'elysia'
import { apiErrorRouteSchema } from '../../../packages/contracts/src/index.ts'

export const internalErrorSchema = apiErrorRouteSchema

export const externalErrorSchema = apiErrorRouteSchema

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
  profileVersion: t.Union([
    t.Literal('m-net-cn@0.1.0'),
    t.Literal('m-net-cn@0.2.0'),
    t.Literal('m-net-default@0.1.0')
  ]),
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
  }),
  t.Object({
    status: t.Literal('enabled'),
    profileVersion: t.String(),
    correlationId: t.String(),
    operationId: t.String(),
    mapVersion: t.Number(),
    relayAssignment: t.Object({
      nodeId: t.String(),
      relayEndpoint: t.String(),
      relayType: t.Union([t.Literal('wstunnel'), t.Literal('direct')])
    })
  })
])

export const nodeIdParamsSchema = t.Object({
  nodeId: t.String({ minLength: 1 })
})

export const latestNetworkMapSchema = t.Object({
  profileVersion: t.String(),
  networkId: t.String(),
  members: t.Array(
    t.Object({
      nodeId: t.String(),
      tunnelIp: t.String(),
      publicKey: t.String()
    })
  ),
  aclRules: t.Array(
    t.Object({
      ruleId: t.String(),
      action: t.Union([t.Literal('allow'), t.Literal('deny')]),
      sourceNodeId: t.String(),
      targetNodeId: t.String(),
      protocol: t.Union([t.Literal('any'), t.Literal('tcp'), t.Literal('udp'), t.Literal('icmp')])
    })
  ),
  relayAssignment: t.Optional(
    t.Object({
      relayType: t.Union([t.Literal('wstunnel'), t.Literal('direct')]),
      relayEndpoint: t.String(),
      nodeIds: t.Array(t.String())
    })
  ),
  expiresAt: t.Number(),
  mapVersion: t.Number(),
  signatureMetadata: t.Object({
    algorithm: t.Literal('placeholder-ed25519'),
    keyId: t.String(),
    value: t.String()
  })
})

export const nodeKeyRegistrationBodySchema = t.Object({
  keyId: t.String({ minLength: 1 }),
  publicKey: t.String({ minLength: 1 }),
  createdAt: t.String({ minLength: 1 })
})

export const nodeKeyRegistrationResponseSchema = t.Object({
  nodeId: t.String(),
  keyId: t.String(),
  fingerprint: t.String(),
  mapVersion: t.Number(),
  correlationId: t.String()
})

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
