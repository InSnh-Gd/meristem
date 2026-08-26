import * as Schema from 'effect/Schema'
import type {
  CommandWellEligibilityFromSchema as CommandWellEligibility,
  DisabledCommandExplanationFromSchema as DisabledCommandExplanation,
  MNetMigrationRequired,
  Permission
} from '../../../../../packages/contracts/src/index.ts'

export const BffJoinTicketRecordSchema = Schema.Struct({
  ticketId: Schema.String,
  ticket: Schema.String,
  expiresAt: Schema.String,
  joinUrl: Schema.String,
  policyDecisionId: Schema.String,
  correlationId: Schema.String,
  networkId: Schema.String,
  status: Schema.Literal('active')
})

export const BffJoinTicketListResponseSchema = Schema.Struct({
  tickets: Schema.Array(BffJoinTicketRecordSchema)
})

export const BffCredentialMutationResponseSchema = Schema.Struct({
  nodeId: Schema.String,
  action: Schema.Literal('issued', 'rotated', 'revoked'),
  policyDecisionId: Schema.String,
  correlationId: Schema.String,
  issuedAt: Schema.optional(Schema.String),
  revokedAt: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String)
})

export const BffDataPlaneNodeStatusSchema = Schema.Struct({
  networkId: Schema.String,
  nodeId: Schema.String,
  tunnelStatus: Schema.String,
  relayAssignment: Schema.Struct({
    relayId: Schema.String,
    relayType: Schema.String,
    relayEndpoint: Schema.String
  }),
  lastMapVersion: Schema.String,
  lastMapAt: Schema.String,
  partitionState: Schema.String,
  stateSource: Schema.Struct({ sourceType: Schema.String, sourceId: Schema.String })
})

export const BffDataPlaneStatusResponseSchema = Schema.Struct({
  networkId: Schema.String,
  nodes: Schema.Array(BffDataPlaneNodeStatusSchema),
  stateSource: Schema.Struct({ sourceType: Schema.String, sourceId: Schema.String })
})

export const BffRelayAssignmentResponseSchema = Schema.Struct({
  networkId: Schema.String,
  relayAssignment: Schema.Struct({
    relayType: Schema.String,
    relayEndpoint: Schema.String,
    nodeIds: Schema.Array(Schema.String)
  }),
  stateSource: Schema.Struct({ sourceType: Schema.String, sourceId: Schema.String })
})

export const BffNetworkMapSummaryResponseSchema = Schema.Struct({
  networkId: Schema.String,
  mapVersion: Schema.String,
  memberCount: Schema.Number,
  aclRuleCount: Schema.Number,
  relayAssignment: Schema.Struct({
    relayType: Schema.String,
    relayEndpoint: Schema.String,
    nodeIds: Schema.Array(Schema.String)
  }),
  expiresAt: Schema.String,
  signedBy: Schema.String,
  stateSource: Schema.Struct({ sourceType: Schema.String, sourceId: Schema.String })
})

export const BffNetworkDetailResponseSchema = Schema.Struct({
  network: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    profileVersion: Schema.String,
    status: Schema.String,
    createdAt: Schema.String,
    memberCount: Schema.optional(Schema.Number),
    stateSource: Schema.Struct({ sourceType: Schema.String, sourceId: Schema.String })
  }),
  members: Schema.Array(
    Schema.Struct({
      networkId: Schema.String,
      nodeId: Schema.String,
      nodeKind: Schema.String,
      membershipMode: Schema.String,
      status: Schema.String,
      joinedAt: Schema.String,
      stateSource: Schema.Struct({ sourceType: Schema.String, sourceId: Schema.String })
    })
  ),
  profileState: Schema.Struct({
    profileVersion: Schema.String,
    stateSource: Schema.Struct({ sourceType: Schema.String, sourceId: Schema.String })
  }),
  networkMapSummary: BffNetworkMapSummaryResponseSchema,
  dataPlaneStatus: BffDataPlaneStatusResponseSchema,
  stateSource: Schema.Struct({ sourceType: Schema.String, sourceId: Schema.String })
})

type DisabledCode = DisabledCommandExplanation['code']

function disabledExplanation(input: {
  code: DisabledCode
  message: string
  missingPermission?: Permission
  migration?: MNetMigrationRequired
}): DisabledCommandExplanation {
  return {
    code: input.code,
    message: input.message,
    ...(input.missingPermission !== undefined
      ? { missingPermission: input.missingPermission }
      : {}),
    ...(input.migration ? { migration: input.migration } : {})
  }
}

/** 统一构造 M-Net CommandWell 禁用态，保持与现有 UI schema 一致。 */
export function disabledEligibility(
  code: DisabledCode,
  message: string,
  missingPermission?: Permission,
  migration?: MNetMigrationRequired
): CommandWellEligibility {
  const detail =
    missingPermission !== undefined || migration !== undefined
      ? disabledExplanation({
          code,
          message,
          ...(missingPermission !== undefined ? { missingPermission } : {}),
          ...(migration !== undefined ? { migration } : {})
        })
      : disabledExplanation({ code, message })
  return { state: 'disabled', disabled: detail, disabledReason: message }
}

/** M-Net 数据面控制命令使用既有禁用语义，BFF 不做最终授权。 */
export function enabledEligibility(input: {
  id: string
  label: string
  action: string
  resource: string
  risk?: 'low' | 'medium' | 'high' | 'critical'
  requiredPermissions: readonly Permission[]
}) {
  return {
    state: 'enabled' as const,
    command: {
      id: input.id,
      label: input.label,
      action: input.action,
      resource: input.resource,
      risk: input.risk ?? 'high',
      requiredPermissions: input.requiredPermissions,
      requiresPolicy: true,
      requiresAudit: true
    }
  }
}

/** BFF 对节点凭证 mutation 只保留生命周期元数据，绝不回传明文 token。 */
export function redactCredentialMutationResponse(
  value: Record<string, unknown>
): Schema.Schema.Type<typeof BffCredentialMutationResponseSchema> {
  const nodeId = typeof value.nodeId === 'string' ? value.nodeId : ''
  const policyDecisionId = typeof value.policyDecisionId === 'string' ? value.policyDecisionId : ''
  const correlationId = typeof value.correlationId === 'string' ? value.correlationId : ''
  const issuedAt = typeof value.issuedAt === 'string' ? value.issuedAt : undefined
  const revokedAt = typeof value.revokedAt === 'string' ? value.revokedAt : undefined
  const reason = typeof value.reason === 'string' ? value.reason : undefined
  const action = revokedAt
    ? 'revoked'
    : issuedAt
      ? typeof value.token === 'string'
        ? 'issued'
        : 'rotated'
      : 'rotated'
  return {
    nodeId,
    action,
    policyDecisionId,
    correlationId,
    ...(issuedAt ? { issuedAt } : {}),
    ...(revokedAt ? { revokedAt } : {}),
    ...(reason ? { reason } : {})
  }
}
