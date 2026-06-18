import * as Schema from 'effect/Schema'
import { actorIds, permissions } from '../literals.ts'

export const ApiErrorDetailSchema = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  correlationId: Schema.optional(Schema.String)
})
export type ApiErrorDetailFromSchema = typeof ApiErrorDetailSchema.Type

export const ApiErrorSchema = Schema.Struct({
  error: ApiErrorDetailSchema
})
export type ApiErrorFromSchema = typeof ApiErrorSchema.Type

export const DependencyStateSchema = Schema.Literal('ready', 'unavailable')
export type DependencyStateFromSchema = typeof DependencyStateSchema.Type

export const CoreDependenciesSchema = Schema.Struct({
  postgres: DependencyStateSchema,
  nats: DependencyStateSchema,
  'm-policy': DependencyStateSchema,
  'm-log': DependencyStateSchema,
  'm-eventbus': DependencyStateSchema,
  'm-net': DependencyStateSchema
})
export type CoreDependenciesFromSchema = typeof CoreDependenciesSchema.Type

export const ServiceDomainSchema = Schema.Literal(
  'core',
  'm-net',
  'm-eventbus',
  'm-log',
  'm-policy',
  'm-task',
  'm-ui',
  'm-cli',
  'm-extension'
)
export type ServiceDomainFromSchema = typeof ServiceDomainSchema.Type

export const ServiceKindSchema = Schema.Literal(
  'core',
  'internal',
  'node',
  'task',
  'extension',
  'bff'
)
export type ServiceKindFromSchema = typeof ServiceKindSchema.Type

export const CoreModeSchema = Schema.Literal('normal', 'degraded', 'safe')
export type CoreModeFromSchema = typeof CoreModeSchema.Type

export const ServiceRuntimeModeSchema = Schema.Literal('normal', 'degraded')
export type ServiceRuntimeModeFromSchema = typeof ServiceRuntimeModeSchema.Type

export const ServiceLifecycleSchema = Schema.Struct({
  reloadable: Schema.Boolean,
  rollbackable: Schema.Boolean,
  degradable: Schema.Boolean
})
export type ServiceLifecycleFromSchema = typeof ServiceLifecycleSchema.Type

export const ServiceRuntimeSchema = Schema.Struct({
  liveness: Schema.Boolean,
  readiness: Schema.Boolean,
  mode: ServiceRuntimeModeSchema,
  lastError: Schema.optional(Schema.String),
  lastReloadedAt: Schema.optional(Schema.String)
})
export type ServiceRuntimeFromSchema = typeof ServiceRuntimeSchema.Type

export const ServiceSummarySchema = Schema.Struct({
  id: Schema.String,
  version: Schema.String,
  domain: ServiceDomainSchema,
  kind: ServiceKindSchema,
  lifecycle: ServiceLifecycleSchema,
  runtime: Schema.optional(ServiceRuntimeSchema)
})
export type ServiceSummaryFromSchema = typeof ServiceSummarySchema.Type

export const HealthResponseSchema = Schema.Struct({
  ok: Schema.Literal(true),
  service: Schema.Literal('meristem-core'),
  version: Schema.String,
  uptimeMs: Schema.Number
})
export type HealthResponseFromSchema = typeof HealthResponseSchema.Type

export const SessionResponseSchema = Schema.Struct({
  actor: Schema.Literal(...actorIds),
  permissions: Schema.Array(Schema.Literal(...permissions))
})
export type SessionResponseFromSchema = typeof SessionResponseSchema.Type

export const ReadyResponseSchema = Schema.Struct({
  ready: Schema.Boolean,
  dependencies: CoreDependenciesSchema
})
export type ReadyResponseFromSchema = typeof ReadyResponseSchema.Type

export const StatusCountsSchema = Schema.Struct({
  services: Schema.Number,
  nodes: Schema.Number,
  tasks: Schema.Number
})
export type StatusCountsFromSchema = typeof StatusCountsSchema.Type

export const StatusResponseSchema = Schema.Struct({
  core: Schema.Struct({
    id: Schema.String,
    version: Schema.String,
    mode: CoreModeSchema
  }),
  dependencies: CoreDependenciesSchema,
  counts: StatusCountsSchema
})
export type StatusResponseFromSchema = typeof StatusResponseSchema.Type

export const NodeKindSchema = Schema.Literal('stem', 'leaf')
export type NodeKindFromSchema = typeof NodeKindSchema.Type

export const NodeModeSchema = Schema.Literal('agent', 'managed', 'simulated')
export type NodeModeFromSchema = typeof NodeModeSchema.Type

export const NodeReachabilitySchema = Schema.Literal(
  'unknown',
  'public',
  'private',
  'reachable',
  'unreachable'
)
export type NodeReachabilityFromSchema = typeof NodeReachabilitySchema.Type

export const NodeStatusSchema = Schema.Literal(
  'ready',
  'joining',
  'healthy',
  'degraded',
  'offline',
  'revoked'
)
export type NodeStatusFromSchema = typeof NodeStatusSchema.Type

export const MNodeSchema = Schema.Struct({
  id: Schema.String,
  kind: NodeKindSchema,
  name: Schema.String,
  mode: NodeModeSchema,
  status: NodeStatusSchema,
  reachability: NodeReachabilitySchema,
  lastSeenAt: Schema.optional(Schema.String),
  agentVersion: Schema.optional(Schema.String),
  capabilities: Schema.Array(Schema.String),
  createdAt: Schema.String
})
export type MNodeFromSchema = typeof MNodeSchema.Type

export const CreateNodeTicketResponseSchema = Schema.Struct({
  ticketId: Schema.String,
  ticket: Schema.String,
  expiresAt: Schema.String,
  joinUrl: Schema.String,
  policyDecisionId: Schema.String,
  correlationId: Schema.String
})
export type CreateNodeTicketResponseFromSchema = typeof CreateNodeTicketResponseSchema.Type

export const RegisterNodeResponseSchema = Schema.Struct({
  node: MNodeSchema,
  policyDecisionId: Schema.String,
  correlationId: Schema.String
})
export type RegisterNodeResponseFromSchema = typeof RegisterNodeResponseSchema.Type

export const IssueNodeCredentialResponseSchema = Schema.Struct({
  nodeId: Schema.String,
  token: Schema.String,
  issuedAt: Schema.String,
  policyDecisionId: Schema.String,
  correlationId: Schema.String
})
export type IssueNodeCredentialResponseFromSchema = typeof IssueNodeCredentialResponseSchema.Type

export const NodeListResponseSchema = Schema.Struct({
  nodes: Schema.Array(MNodeSchema)
})
export type NodeListResponseFromSchema = typeof NodeListResponseSchema.Type

export const NodeDetailResponseSchema = Schema.Struct({
  node: MNodeSchema
})
export type NodeDetailResponseFromSchema = typeof NodeDetailResponseSchema.Type

export const NetworkStatusSchema = Schema.Literal('active')
export type NetworkStatusFromSchema = typeof NetworkStatusSchema.Type

export const NetworkMembershipModeSchema = Schema.Literal('full', 'restricted')
export type NetworkMembershipModeFromSchema = typeof NetworkMembershipModeSchema.Type

export const NetworkMembershipStatusSchema = Schema.Literal('joined')
export type NetworkMembershipStatusFromSchema = typeof NetworkMembershipStatusSchema.Type

export const MNetworkSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  profileVersion: Schema.String,
  status: NetworkStatusSchema,
  createdAt: Schema.String
})
export type MNetworkFromSchema = typeof MNetworkSchema.Type

export const NetworkSummarySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  profileVersion: Schema.String,
  status: NetworkStatusSchema,
  createdAt: Schema.String,
  memberCount: Schema.Number
})
export type NetworkSummaryFromSchema = typeof NetworkSummarySchema.Type

export const MNetworkMemberSchema = Schema.Struct({
  networkId: Schema.String,
  nodeId: Schema.String,
  nodeKind: NodeKindSchema,
  membershipMode: NetworkMembershipModeSchema,
  status: NetworkMembershipStatusSchema,
  joinedAt: Schema.String
})
export type MNetworkMemberFromSchema = typeof MNetworkMemberSchema.Type

export const NetworkRecordResponseSchema = Schema.Struct({
  network: MNetworkSchema
})
export type NetworkRecordResponseFromSchema = typeof NetworkRecordResponseSchema.Type

export const CreateNetworkResponseSchema = Schema.Struct({
  network: MNetworkSchema,
  policyDecisionId: Schema.String,
  correlationId: Schema.String
})
export type CreateNetworkResponseFromSchema = typeof CreateNetworkResponseSchema.Type

export const NetworkListResponseSchema = Schema.Struct({
  networks: Schema.Array(NetworkSummarySchema)
})
export type NetworkListResponseFromSchema = typeof NetworkListResponseSchema.Type

export const NetworkMemberRecordResponseSchema = Schema.Struct({
  member: MNetworkMemberSchema
})
export type NetworkMemberRecordResponseFromSchema = typeof NetworkMemberRecordResponseSchema.Type

export const JoinNetworkResponseSchema = Schema.Struct({
  member: MNetworkMemberSchema,
  policyDecisionId: Schema.String,
  correlationId: Schema.String
})
export type JoinNetworkResponseFromSchema = typeof JoinNetworkResponseSchema.Type

export const NetworkMembersResponseSchema = Schema.Struct({
  members: Schema.Array(MNetworkMemberSchema)
})
export type NetworkMembersResponseFromSchema = typeof NetworkMembersResponseSchema.Type

export const PolicyResultSchema = Schema.Literal(
  'allow',
  'deny',
  'require_manual_review',
  'require_multi_approval'
)
export type PolicyResultFromSchema = typeof PolicyResultSchema.Type

export const OperationDangerLevelSchema = Schema.Literal('low', 'medium', 'high', 'critical')
export type OperationDangerLevelFromSchema = typeof OperationDangerLevelSchema.Type

export const RiskFactorSchema = Schema.Literal(
  'actor_permission_level',
  'operation_danger_level',
  'target_node_kind',
  'target_node_reachability',
  'task_type_risk',
  'recent_failure_count',
  'outside_expected_scope',
  'audit_visibility'
)
export type RiskFactorFromSchema = typeof RiskFactorSchema.Type

export const PolicyDecisionSchema = Schema.Struct({
  id: Schema.String,
  actor: Schema.Literal(...actorIds),
  action: Schema.Literal(...permissions),
  resource: Schema.String,
  result: PolicyResultSchema,
  reasons: Schema.Array(Schema.String),
  operationDangerLevel: Schema.optional(OperationDangerLevelSchema),
  suspicionScore: Schema.optional(Schema.Number),
  riskFactors: Schema.optional(Schema.Array(RiskFactorSchema)),
  requiredAction: Schema.optional(Schema.Literal('manual_review', 'multi_approval')),
  createdAt: Schema.String
})
export type PolicyDecisionFromSchema = typeof PolicyDecisionSchema.Type

export const PolicyDecisionResponseSchema = Schema.Struct({
  decision: PolicyDecisionSchema
})
export type PolicyDecisionResponseFromSchema = typeof PolicyDecisionResponseSchema.Type

export const TimelineLogSchema = Schema.Struct({
  id: Schema.String,
  timestamp: Schema.String,
  summary: Schema.String,
  subject: Schema.optional(Schema.String),
  correlationId: Schema.optional(Schema.String)
})
export type TimelineLogFromSchema = typeof TimelineLogSchema.Type

export const FullLogLevelSchema = Schema.Literal('debug', 'info', 'warn', 'error')
export type FullLogLevelFromSchema = typeof FullLogLevelSchema.Type

export const FullLogSchema = Schema.Struct({
  id: Schema.String,
  timestamp: Schema.String,
  level: FullLogLevelSchema,
  source: Schema.String,
  message: Schema.String,
  correlationId: Schema.optional(Schema.String),
  traceId: Schema.optional(Schema.String),
  payload: Schema.optional(Schema.Unknown)
})
export type FullLogFromSchema = typeof FullLogSchema.Type

export const AuditLogSchema = Schema.Struct({
  id: Schema.String,
  timestamp: Schema.String,
  summary: Schema.optional(Schema.String),
  actor: Schema.Union(Schema.Literal(...actorIds), Schema.Literal('system')),
  action: Schema.String,
  resource: Schema.String,
  decisionId: Schema.optional(Schema.String),
  result: Schema.String,
  correlationId: Schema.optional(Schema.String),
  traceId: Schema.optional(Schema.String),
  payload: Schema.optional(Schema.Unknown)
})
export type AuditLogFromSchema = typeof AuditLogSchema.Type

export const TimelineLogListResponseSchema = Schema.Struct({
  entries: Schema.Array(TimelineLogSchema)
})
export type TimelineLogListResponseFromSchema = typeof TimelineLogListResponseSchema.Type

export const FullLogListResponseSchema = Schema.Struct({
  entries: Schema.Array(FullLogSchema)
})
export type FullLogListResponseFromSchema = typeof FullLogListResponseSchema.Type

export const AuditLogListResponseSchema = Schema.Struct({
  entries: Schema.Array(AuditLogSchema)
})
export type AuditLogListResponseFromSchema = typeof AuditLogListResponseSchema.Type

export const TimelineLogSearchResponseSchema = Schema.Struct({
  entries: Schema.Array(TimelineLogSchema),
  total: Schema.Number
})
export type TimelineLogSearchResponseFromSchema = typeof TimelineLogSearchResponseSchema.Type

export const FullLogSearchResponseSchema = Schema.Struct({
  entries: Schema.Array(FullLogSchema),
  total: Schema.Number
})
export type FullLogSearchResponseFromSchema = typeof FullLogSearchResponseSchema.Type

export const AuditLogSearchResponseSchema = Schema.Struct({
  entries: Schema.Array(AuditLogSchema),
  total: Schema.Number
})
export type AuditLogSearchResponseFromSchema = typeof AuditLogSearchResponseSchema.Type

export const ServiceRegisterResponseSchema = Schema.Struct({
  service: Schema.Unknown,
  policyDecisionId: Schema.String,
  correlationId: Schema.String
})
export type ServiceRegisterResponseFromSchema = typeof ServiceRegisterResponseSchema.Type

export const ServiceListResponseSchema = Schema.Struct({
  services: Schema.Array(ServiceSummarySchema)
})
export type ServiceListResponseFromSchema = typeof ServiceListResponseSchema.Type

export const ServiceReloadResponseSchema = Schema.Struct({
  serviceId: Schema.String,
  accepted: Schema.Literal(true),
  reloadedAt: Schema.String,
  policyDecisionId: Schema.String,
  correlationId: Schema.String
})
export type ServiceReloadResponseFromSchema = typeof ServiceReloadResponseSchema.Type

export const CoreLifecycleStartedPayloadSchema = Schema.Struct({
  nodeId: Schema.String,
  startedAt: Schema.String,
  version: Schema.String
})
export type CoreLifecycleStartedPayloadFromSchema = typeof CoreLifecycleStartedPayloadSchema.Type

export const CoreLifecycleDegradedPayloadSchema = Schema.Struct({
  dependencies: CoreDependenciesSchema
})
export type CoreLifecycleDegradedPayloadFromSchema = typeof CoreLifecycleDegradedPayloadSchema.Type

export const ServiceLifecycleRegisteredPayloadSchema = Schema.Struct({
  id: Schema.String,
  version: Schema.String,
  domain: Schema.String,
  kind: Schema.String
})
export type ServiceLifecycleRegisteredPayloadFromSchema =
  typeof ServiceLifecycleRegisteredPayloadSchema.Type

export const ServiceLifecycleReloadRequestedPayloadSchema = Schema.Struct({
  serviceId: Schema.String,
  reason: Schema.optional(Schema.String)
})
export type ServiceLifecycleReloadRequestedPayloadFromSchema =
  typeof ServiceLifecycleReloadRequestedPayloadSchema.Type

export const NodeRegistrationRequestedPayloadSchema = Schema.Struct({
  kind: NodeKindSchema,
  name: Schema.String,
  channel: Schema.optional(Schema.Literal('join-ticket'))
})
export type NodeRegistrationRequestedPayloadFromSchema =
  typeof NodeRegistrationRequestedPayloadSchema.Type

export const NodeJoinTicketCreatedPayloadSchema = Schema.Struct({
  ticketId: Schema.String,
  kind: NodeKindSchema,
  name: Schema.String,
  expiresAt: Schema.String
})
export type NodeJoinTicketCreatedPayloadFromSchema = typeof NodeJoinTicketCreatedPayloadSchema.Type

export const NodeRegistrationAcceptedPayloadSchema = Schema.Struct({
  nodeId: Schema.String,
  kind: NodeKindSchema,
  mode: NodeModeSchema
})
export type NodeRegistrationAcceptedPayloadFromSchema =
  typeof NodeRegistrationAcceptedPayloadSchema.Type

export const NodeStatusChangedPayloadSchema = Schema.Struct({
  nodeId: Schema.String,
  previousStatus: NodeStatusSchema,
  nextStatus: NodeStatusSchema
})
export type NodeStatusChangedPayloadFromSchema = typeof NodeStatusChangedPayloadSchema.Type

export const MNetNetworkCreatedPayloadSchema = Schema.Struct({
  networkId: Schema.String,
  name: Schema.String,
  profileVersion: Schema.String
})
export type MNetNetworkCreatedPayloadFromSchema = typeof MNetNetworkCreatedPayloadSchema.Type

export const MNetMembershipJoinedPayloadSchema = Schema.Struct({
  networkId: Schema.String,
  nodeId: Schema.String,
  nodeKind: NodeKindSchema,
  membershipMode: NetworkMembershipModeSchema
})
export type MNetMembershipJoinedPayloadFromSchema = typeof MNetMembershipJoinedPayloadSchema.Type
