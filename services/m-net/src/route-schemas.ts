import { t } from 'elysia'
import { apiErrorRouteSchema } from '../../../packages/contracts/src/index.ts'

export const internalErrorSchema = apiErrorRouteSchema

export const externalErrorSchema = apiErrorRouteSchema

export const externalMigrationRequiredErrorSchema = t.Object({
  error: t.Object({
    code: t.Literal('migration_required'),
    message: t.String(),
    correlationId: t.Optional(t.String()),
    migration: t.Object({
      code: t.Literal('migration_required'),
      message: t.String(),
      targetProfileVersion: t.Union([t.Literal('m-net@0.3.0'), t.Literal('m-net-cn@0.3.0')]),
      rebuildGuidanceKey: t.Union([
        t.Literal('rebuild_node_with_netbird_sidecar'),
        t.Literal('migrate_profile_to_mnet_v03'),
        t.Literal('migrate_profile_to_mnet_cn_v03')
      ]),
      affectedProfileIds: t.Array(t.String()),
      affectedNodeIds: t.Array(t.String()),
      reasonCode: t.Union([
        t.Literal('legacy_profile_v0_1'),
        t.Literal('legacy_cn_profile_v0_1'),
        t.Literal('legacy_wstunnel_profile_v0_2'),
        t.Literal('legacy_wstunnel_node')
      ])
    })
  })
})

export const migrationRequiredBodySchema = t.Object({
  code: t.Literal('migration_required'),
  message: t.String(),
  targetProfileVersion: t.Union([t.Literal('m-net@0.3.0'), t.Literal('m-net-cn@0.3.0')]),
  rebuildGuidanceKey: t.Union([
    t.Literal('rebuild_node_with_netbird_sidecar'),
    t.Literal('migrate_profile_to_mnet_v03'),
    t.Literal('migrate_profile_to_mnet_cn_v03')
  ]),
  affectedProfileIds: t.Array(t.String()),
  affectedNodeIds: t.Array(t.String()),
  reasonCode: t.Union([
    t.Literal('legacy_profile_v0_1'),
    t.Literal('legacy_cn_profile_v0_1'),
    t.Literal('legacy_wstunnel_profile_v0_2'),
    t.Literal('legacy_wstunnel_node')
  ])
})

export const migrationReportItemSchema = t.Object({
  resourceKind: t.Union([t.Literal('profile'), t.Literal('node')]),
  resourceId: t.String(),
  migration: migrationRequiredBodySchema
})

export const migrationReportSchema = t.Object({
  status: t.Union([t.Literal('ok'), t.Literal('migration_required')]),
  generatedAt: t.String(),
  items: t.Array(migrationReportItemSchema)
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
  profileVersion: t.Union([t.Literal('m-net@0.3.0'), t.Literal('m-net-cn@0.3.0')]),
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
      relayType: t.Union([t.Literal('wstunnel'), t.Literal('direct')]) // relay transport type remains backward-readable for stored artifacts
    })
  })
])

export const nodeIdParamsSchema = t.Object({
  nodeId: t.String({ minLength: 1 })
})

export const nodeControlBodySchema = t.Object({
  action: t.Union([
    t.Literal('disable'),
    t.Literal('isolate'),
    t.Literal('recover'),
    t.Literal('switch-role')
  ]),
  reason: t.String({ minLength: 1 }),
  targetKind: t.Optional(t.Union([t.Literal('stem'), t.Literal('leaf')]))
})

export const nodeControlResponseSchema = t.Object({
  node: t.Object({
    id: t.String(),
    kind: t.Union([t.Literal('stem'), t.Literal('leaf')]),
    name: t.String(),
    mode: t.Union([t.Literal('agent'), t.Literal('managed'), t.Literal('simulated')]),
    status: t.Union([
      t.Literal('ready'),
      t.Literal('joining'),
      t.Literal('healthy'),
      t.Literal('degraded'),
      t.Literal('offline'),
      t.Literal('disabled'),
      t.Literal('isolated'),
      t.Literal('recovering'),
      t.Literal('revoked')
    ]),
    reachability: t.Union([
      t.Literal('unknown'),
      t.Literal('public'),
      t.Literal('private'),
      t.Literal('reachable'),
      t.Literal('unreachable')
    ]),
    lastSeenAt: t.Optional(t.String()),
    agentVersion: t.Optional(t.String()),
    capabilities: t.Array(t.String()),
    createdAt: t.String()
  }),
  policyDecisionId: t.String(),
  correlationId: t.String()
})

export const latestNetworkMapSchema = t.Object({
  profileVersion: t.String(),
  networkId: t.String(),
  members: t.Array(
    t.Object({
      nodeId: t.String(),
      tunnelIp: t.String(),
      publicKey: t.String(),
      endpoint: t.Optional(t.String())
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
      relayType: t.Union([t.Literal('wstunnel'), t.Literal('direct')]), // legacy wstunnel — v0.2 contract, preserved for migration compat
      relayEndpoint: t.String(),
      nodeIds: t.Array(t.String())
    })
  ),
  expiresAt: t.Number(),
  mapVersion: t.Number(),
  signatureMetadata: t.Object({
    algorithm: t.Literal('ed25519'),
    keyId: t.String(),
    publicKey: t.String(),
    value: t.String()
  })
})

export const latestNodeRuntimeSidecarSchema = t.Object({
  signalConfigRef: t.Object({ configRef: t.String() }),
  relayConfigRef: t.Object({ configRef: t.String() }),
  stunConfigRef: t.Object({ configRef: t.String() }),
  sidecarCredentialRef: t.Object({
    provider: t.String(),
    keyPath: t.String(),
    version: t.Optional(t.Number()),
    metadata: t.Optional(t.Record(t.String(), t.String()))
  }),
  desiredState: t.Union([
    t.Literal('install'),
    t.Literal('configure'),
    t.Literal('start'),
    t.Literal('drain'),
    t.Literal('stop')
  ]),
  credentialStatus: t.Union([
    t.Literal('missing'),
    t.Literal('pending'),
    t.Literal('ready'),
    t.Literal('expired'),
    t.Literal('rotation_required')
  ]),
  healthStatus: t.Union([
    t.Literal('unknown'),
    t.Literal('healthy'),
    t.Literal('degraded'),
    t.Literal('unhealthy')
  ]),
  configHash: t.Optional(t.String())
})

export const nodeKeyRegistrationBodySchema = t.Object({
  keyId: t.String({ minLength: 1 }),
  publicKey: t.String({ minLength: 1 }),
  createdAt: t.String({ minLength: 1 }),
  endpoint: t.Optional(t.String({ minLength: 1 }))
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
  409: t.Union([externalMigrationRequiredErrorSchema, externalErrorSchema]),
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
