import * as Schema from 'effect/Schema'
import { ServiceSummarySchema } from './core.ts'
import { EventBusPublishMetricsSummarySchema } from './eventbus.ts'
import { ActorIdSchema } from './identity.ts'
import { MNetMigrationRequiredSchema } from './mnet-profile-v03.ts'
import {
  MNetOperationalCredentialLifecycleSchema,
  MNetOperationalDeploymentReadinessSchema,
  MNetOperationalEventStreamSchema,
  MNetOperationalMigrationStateSchema,
  MNetOperationalNodeKindSchema,
  MNetOperationalProfileSelectionSchema,
  MNetOperationalSidecarNodeSchema,
  MNetOperationalStatusSchema,
  MNetOperationalTopologySchema
} from './mnet-operational.ts'
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
  PolicyInternalSummarySchema,
  RequiredActionSchema
} from './policy.ts'
import { ProjectionHealthResponseSchema } from './projection.ts'

export const DisabledCommandExplanationSchema = Schema.Struct({
  code: Schema.Literal(
    'missing_permission',
    'target_missing',
    'wrong_node_kind',
    'node_unreachable',
    'unreachable_node',
    'migration_required',
    'missing_secret_provider',
    'stale_jwks',
    'missing_signal_relay'
  ),
  message: Schema.String,
  missingPermission: Schema.optional(PermissionSchema),
  migration: Schema.optional(MNetMigrationRequiredSchema)
})

export const CommandWellCommandSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  action: PermissionSchema,
  resource: Schema.NonEmptyString,
  risk: Schema.Literal('low', 'medium', 'high', 'critical'),
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

export const StateSourceMetadataSchema = Schema.Struct({
  sourceType: SduiV02StateSourceSchema,
  sourceId: Schema.String,
  correlationId: Schema.optional(Schema.String),
  traceId: Schema.optional(Schema.String)
})

export const ServiceInspectorResponseSchema = Schema.Struct({
  service: Schema.Struct({
    id: ServiceSummarySchema.fields.id,
    version: ServiceSummarySchema.fields.version,
    domain: ServiceSummarySchema.fields.domain,
    kind: ServiceSummarySchema.fields.kind,
    lifecycle: ServiceSummarySchema.fields.lifecycle,
    runtime: ServiceSummarySchema.fields.runtime,
    stateSource: StateSourceMetadataSchema
  }),
  eventBusMetrics: Schema.NullOr(EventBusPublishMetricsSummarySchema),
  eventBusMetricsStateSource: Schema.NullOr(StateSourceMetadataSchema),
  logProjectionHealth: Schema.NullOr(ProjectionHealthResponseSchema),
  logProjectionHealthStateSource: Schema.NullOr(StateSourceMetadataSchema),
  policySummary: Schema.NullOr(PolicyInternalSummarySchema),
  policySummaryStateSource: Schema.NullOr(StateSourceMetadataSchema)
})

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

export const BffOperationalCreateManageStatusSchema = Schema.Struct({
  mode: Schema.Literal('manage'),
  networkId: Schema.String,
  networkStatus: Schema.Literal('active', 'degraded'),
  profileState: Schema.String,
  memberCount: Schema.Number,
  lastUpdatedAt: Schema.String,
  summary: Schema.String,
  stateSource: StateSourceMetadataSchema
})

export const BffOperationalProfileSelectionResponseSchema = Schema.Struct({
  networkId: Schema.String,
  profileSelection: MNetOperationalProfileSelectionSchema,
  summary: Schema.String,
  disabledReason: Schema.optional(DisabledCommandExplanationSchema),
  stateSource: StateSourceMetadataSchema
})

export const BffOperationalTopologyResponseSchema = Schema.Struct({
  networkId: Schema.String,
  topology: MNetOperationalTopologySchema,
  stateSource: StateSourceMetadataSchema
})

export const BffOperationalSidecarHealthSummarySchema = Schema.Struct({
  networkId: Schema.String,
  status: MNetOperationalStatusSchema,
  summary: Schema.String,
  nodes: Schema.Array(MNetOperationalSidecarNodeSchema),
  stateSource: StateSourceMetadataSchema
})

export const BffOperationalCredentialLifecycleResponseSchema = Schema.Struct({
  networkId: Schema.String,
  credentials: MNetOperationalCredentialLifecycleSchema,
  stateSource: StateSourceMetadataSchema
})

export const BffOperationalMigrationResponseSchema = Schema.Struct({
  networkId: Schema.String,
  migration: MNetOperationalMigrationStateSchema,
  disabledReason: Schema.optional(DisabledCommandExplanationSchema),
  stateSource: StateSourceMetadataSchema
})

export const BffOperationalCommandEligibilitySchema = Schema.Struct({
  commandId: Schema.String,
  label: Schema.String,
  action: Schema.String,
  resource: Schema.String,
  requiredPermissions: Schema.Array(PermissionSchema),
  requiresPolicy: Schema.Boolean,
  requiresAudit: Schema.Boolean,
  state: Schema.Literal('enabled', 'disabled'),
  disabledReason: Schema.optional(DisabledCommandExplanationSchema),
  summary: Schema.String,
  targetNodeId: Schema.optional(Schema.String),
  targetNodeKind: Schema.optional(MNetOperationalNodeKindSchema)
})

export const BffOperationalPolicyEligibilitySchema = Schema.Struct({
  networkId: Schema.String,
  commands: Schema.Array(BffOperationalCommandEligibilitySchema),
  stateSource: StateSourceMetadataSchema
})

export const BffOperationalProgressFeedResponseSchema = Schema.Struct({
  networkId: Schema.String,
  eventStream: MNetOperationalEventStreamSchema,
  deploymentReadiness: MNetOperationalDeploymentReadinessSchema,
  summary: Schema.String,
  stateSource: StateSourceMetadataSchema
})

export const BffOperationalProofPathResponseSchema = Schema.Struct({
  networkId: Schema.String,
  createManageStatus: BffOperationalCreateManageStatusSchema,
  profileSelection: BffOperationalProfileSelectionResponseSchema,
  topology: BffOperationalTopologyResponseSchema,
  sidecarHealth: BffOperationalSidecarHealthSummarySchema,
  credentialLifecycle: BffOperationalCredentialLifecycleResponseSchema,
  migration: BffOperationalMigrationResponseSchema,
  policyEligibility: BffOperationalPolicyEligibilitySchema,
  progressFeed: BffOperationalProgressFeedResponseSchema
})

/** 组件种类白名单，不在名单内的 kind 解码时被拒绝 */
export const SduiV02ComponentKindSchema = Schema.Literal(
  'AuditLedger',
  'PolicyDecisionPanel',
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
  'OperationalCommandPreview',
  'NetworkListPanel',
  'NetworkDetailPanel',
  'NodeCredentialPanel',
  'DataplaneStatusPanel'
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

export type ApprovalQueueItemFromSchema = typeof ApprovalQueueItemSchema.Type
export type ApprovalDetailDisplayFromSchema = typeof ApprovalDetailDisplaySchema.Type
export type NetworkProfileListItemFromSchema = typeof NetworkProfileListItemSchema.Type
export type OperationalCommandPreviewCommandIdFromSchema =
  typeof OperationalCommandPreviewCommandIdSchema.Type
export type OperationalCommandPreviewActionFromSchema =
  typeof OperationalCommandPreviewActionSchema.Type
export type OperationalCommandPreviewStateFromSchema =
  typeof OperationalCommandPreviewStateSchema.Type
export type OperationalCommandPreviewFromSchema = typeof OperationalCommandPreviewSchema.Type
export type BffOperationalCreateManageStatusFromSchema =
  typeof BffOperationalCreateManageStatusSchema.Type
export type BffOperationalProfileSelectionResponseFromSchema =
  typeof BffOperationalProfileSelectionResponseSchema.Type
export type BffOperationalTopologyResponseFromSchema =
  typeof BffOperationalTopologyResponseSchema.Type
export type BffOperationalSidecarHealthSummaryFromSchema =
  typeof BffOperationalSidecarHealthSummarySchema.Type
export type BffOperationalCredentialLifecycleResponseFromSchema =
  typeof BffOperationalCredentialLifecycleResponseSchema.Type
export type BffOperationalMigrationResponseFromSchema =
  typeof BffOperationalMigrationResponseSchema.Type
export type BffOperationalCommandEligibilityFromSchema =
  typeof BffOperationalCommandEligibilitySchema.Type
export type BffOperationalPolicyEligibilityFromSchema =
  typeof BffOperationalPolicyEligibilitySchema.Type
export type BffOperationalProgressFeedResponseFromSchema =
  typeof BffOperationalProgressFeedResponseSchema.Type
export type BffOperationalProofPathResponseFromSchema =
  typeof BffOperationalProofPathResponseSchema.Type
export type DisabledCommandExplanationFromSchema = typeof DisabledCommandExplanationSchema.Type
export type CommandWellEligibilityFromSchema = typeof CommandWellEligibilitySchema.Type
export type SduiV02ComponentKindFromSchema = typeof SduiV02ComponentKindSchema.Type
export type SduiV02StateSourceFromSchema = typeof SduiV02StateSourceSchema.Type
export type StateSourceMetadataFromSchema = typeof StateSourceMetadataSchema.Type
export type SduiV02RouteFromSchema = typeof SduiV02RouteSchema.Type
export type SduiV02RouteRegistryFromSchema = typeof SduiV02RouteRegistrySchema.Type
export type ServiceInspectorResponseFromSchema = typeof ServiceInspectorResponseSchema.Type
