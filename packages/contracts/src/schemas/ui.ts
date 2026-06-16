import * as Schema from 'effect/Schema'
import { ActorIdSchema } from './identity.ts'
import {
  MNetProfileRegionSchema,
  MNetProfileVersionSchema,
  NetworkProfileStateSchema
} from './mnet-profile.ts'
import {
  ApprovalOriginServiceSchema,
  ApprovalStatusSchema,
  ApprovalVoteTypeSchema,
  PermissionSchema,
  RequiredActionSchema
} from './policy.ts'

export const DisabledCommandExplanationSchema = Schema.Struct({
  code: Schema.Literal(
    'missing_permission',
    'target_missing',
    'wrong_node_kind',
    'node_unreachable'
  ),
  message: Schema.String,
  missingPermission: Schema.optional(PermissionSchema)
})

export const MinimalPolicyDecisionSummarySchema = Schema.Struct({
  id: Schema.NonEmptyString,
  actor: ActorIdSchema,
  action: PermissionSchema,
  resource: Schema.NonEmptyString,
  result: Schema.Literal('allow', 'deny', 'require_manual_review', 'require_multi_approval'),
  createdAt: Schema.NonEmptyString
})

export const CommandWellCommandSchema = Schema.Struct({
  id: Schema.Literal('task.noop.run', 'task.noop.submit'),
  label: Schema.String,
  action: PermissionSchema,
  resource: Schema.NonEmptyString,
  risk: Schema.Literal('medium'),
  requiredPermissions: Schema.Array(PermissionSchema),
  requiresPolicy: Schema.Boolean,
  requiresAudit: Schema.Boolean
})

export const CommandWellEligibilitySchema = Schema.Union(
  Schema.Struct({
    state: Schema.Literal('enabled'),
    command: CommandWellCommandSchema
  }),
  Schema.Struct({
    state: Schema.Literal('disabled'),
    disabled: DisabledCommandExplanationSchema,
    disabledReason: Schema.String
  })
)

/** 状态来源分类，只允许 authoritative/event/cache/read-model/log/audit/policy */
export const SduiV02StateSourceSchema = Schema.Literal(
  'authoritative',
  'event',
  'cache',
  'read-model',
  'log',
  'audit',
  'policy'
)

export const ApprovalQueueItemSchema = Schema.Struct({
  approvalId: Schema.String,
  policyDecisionId: Schema.String,
  originService: ApprovalOriginServiceSchema,
  operationId: Schema.String,
  requestedBy: ActorIdSchema,
  requiredAction: RequiredActionSchema,
  quorumRequired: Schema.Number,
  status: ApprovalStatusSchema,
  expiresAt: Schema.String,
  createdAt: Schema.String,
  completedAt: Schema.optional(Schema.String),
  stateSource: SduiV02StateSourceSchema
})

export const ApprovalDetailDisplaySchema = Schema.Struct({
  approval: ApprovalQueueItemSchema,
  votes: Schema.Array(
    Schema.Struct({
      actor: ActorIdSchema,
      vote: ApprovalVoteTypeSchema,
      reason: Schema.optional(Schema.String),
      createdAt: Schema.String,
      stateSource: SduiV02StateSourceSchema
    })
  )
})

export const NetworkProfileListItemSchema = Schema.Struct({
  profileVersion: MNetProfileVersionSchema,
  region: MNetProfileRegionSchema,
  displayName: Schema.String,
  controlPlaneOnly: Schema.Boolean,
  status: NetworkProfileStateSchema,
  networkId: Schema.optional(Schema.String),
  stateSource: SduiV02StateSourceSchema
})

export const OperationalCommandPreviewCommandIdSchema = Schema.Literal(
  'policy.approval.approve.preview',
  'policy.approval.reject.preview',
  'network.profile.enable.preview',
  'network.profile.disable.preview'
)

export const OperationalCommandPreviewActionSchema = Schema.Literal('display-only')

export const OperationalCommandPreviewStateSchema = Schema.Literal('enabled', 'disabled')

export const OperationalCommandPreviewSchema = Schema.Struct({
  commandId: OperationalCommandPreviewCommandIdSchema,
  label: Schema.String,
  action: OperationalCommandPreviewActionSchema,
  resource: Schema.String,
  risk: Schema.String,
  requiredPermissions: Schema.Array(PermissionSchema),
  requiresPolicy: Schema.Boolean,
  requiresAudit: Schema.Boolean,
  state: OperationalCommandPreviewStateSchema,
  disabledReason: Schema.optional(Schema.String),
  displayOnly: Schema.Literal(true)
})

/** 组件种类白名单，不在名单内的 kind 解码时被拒绝 */
export const SduiV02ComponentKindSchema = Schema.Literal(
  'TimelinePanel',
  'NodeListPanel',
  'NodeDetailPanel',
  'AuditLedger',
  'PolicyDecisionPanel',
  'ServiceListPanel',
  'CommandWellPanel',
  'StateSourceBadge',
  'RouteHeader',
  'NodeMap',
  'TimelineStream',
  'ServiceRegistryTable',
  'InlineOperationalAlert',
  'KeyValueInspector',
  'TraceLink',
  'RawEnvelopeView',
  'FilterBar',
  'DecisionQueueSummary',
  'ApprovalQueuePanel',
  'ApprovalDetailPanel',
  'NetworkProfileListPanel',
  'NetworkProfileDetailPanel',
  'OperationalCommandPreview'
)

/** 路由内单个组件引用，必须包含 kind 与 id */
export const SduiV02RouteComponentSchema = Schema.Struct({
  kind: SduiV02ComponentKindSchema,
  id: Schema.String
})

/** 单条 SDUI v0.2 路由定义，约束 id/title/权限/状态来源/降级状态/组件列表 */
export const SduiV02RouteSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  requiredPermissions: Schema.Array(Schema.String),
  stateSources: Schema.Array(SduiV02StateSourceSchema),
  degradedState: Schema.Struct({
    enabled: Schema.Boolean,
    reason: Schema.String
  }),
  components: Schema.Array(SduiV02RouteComponentSchema)
})

/** 路由注册表，schemaVersion 固定为 sdui@0.2.0 且 routes 为路由数组 */
export const SduiV02RouteRegistrySchema = Schema.Struct({
  schemaVersion: Schema.Literal('sdui@0.2.0'),
  routes: Schema.Array(SduiV02RouteSchema)
})

export type ApprovalQueueItem = typeof ApprovalQueueItemSchema.Type
export type ApprovalDetailDisplay = typeof ApprovalDetailDisplaySchema.Type
export type NetworkProfileListItem = typeof NetworkProfileListItemSchema.Type
export type OperationalCommandPreviewCommandId =
  typeof OperationalCommandPreviewCommandIdSchema.Type
export type OperationalCommandPreviewAction = typeof OperationalCommandPreviewActionSchema.Type
export type OperationalCommandPreviewState = typeof OperationalCommandPreviewStateSchema.Type
export type OperationalCommandPreview = typeof OperationalCommandPreviewSchema.Type
export type DisabledCommandExplanation = typeof DisabledCommandExplanationSchema.Type
export type MinimalPolicyDecisionSummary = typeof MinimalPolicyDecisionSummarySchema.Type
export type CommandWellEligibility = typeof CommandWellEligibilitySchema.Type
export type SduiV02ComponentKind = typeof SduiV02ComponentKindSchema.Type
export type SduiV02StateSource = typeof SduiV02StateSourceSchema.Type
export type SduiV02Route = typeof SduiV02RouteSchema.Type
export type SduiV02RouteRegistry = typeof SduiV02RouteRegistrySchema.Type
