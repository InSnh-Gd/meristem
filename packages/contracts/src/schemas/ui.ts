import * as Schema from 'effect/Schema'
import { ActorIdSchema } from './identity.ts'
import { PermissionSchema } from './policy.ts'

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
  'DecisionQueueSummary'
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

export type DisabledCommandExplanation = typeof DisabledCommandExplanationSchema.Type
export type MinimalPolicyDecisionSummary = typeof MinimalPolicyDecisionSummarySchema.Type
export type CommandWellEligibility = typeof CommandWellEligibilitySchema.Type
export type SduiV02Route = typeof SduiV02RouteSchema.Type
export type SduiV02RouteRegistry = typeof SduiV02RouteRegistrySchema.Type
