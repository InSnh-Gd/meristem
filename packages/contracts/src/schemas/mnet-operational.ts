import * as Schema from 'effect/Schema'
import {
  MNetNodeSelectorSchema,
  MNetMigrationRequiredSchema,
  MNetProfileV03EventSubjectSchema,
  MNetProfileV03VersionSchema,
  MNetRouteClassSchema,
  MNetSelectorOwnershipSchema,
  MNetSidecarCredentialStatusSchema,
  MNetSidecarDesiredStateSchema,
  MNetSidecarHealthEventPayloadSchema,
  MNetSidecarHealthStatusSchema,
  MNetSidecarLifecycleEventPayloadSchema,
  MNetTopologyUpdateEventPayloadSchema,
  MNetMigrationRequiredEventPayloadSchema,
  MNetForcedRelayChangeEventPayloadSchema,
  MNetCredentialExpiryEventPayloadSchema
} from './mnet-profile-v03.ts'
import { MNetProfileVersionSchema } from './mnet-profile.ts'
import { RedactedSecretRefSchema } from './secret-provider.ts'

export const MNetOperationalProfileVersionSchema = Schema.Union(
  MNetProfileVersionSchema,
  MNetProfileV03VersionSchema
)
export type MNetOperationalProfileVersionFromSchema =
  typeof MNetOperationalProfileVersionSchema.Type

export const MNetOperationalStateSourceSchema = Schema.Literal(
  'authoritative',
  'read-model',
  'composed'
)
export type MNetOperationalStateSourceFromSchema = typeof MNetOperationalStateSourceSchema.Type

export const MNetOperationalStatusSchema = Schema.Literal('healthy', 'degraded', 'blocked')
export type MNetOperationalStatusFromSchema = typeof MNetOperationalStatusSchema.Type

export const MNetOperationalDegradedReasonCodeSchema = Schema.Literal(
  'eventbus_unavailable',
  'sidecar_report_stale',
  'migration_required',
  'credential_missing',
  'credential_expired',
  'credential_rotation_required',
  'sidecar_unhealthy',
  'topology_missing',
  'network_not_ready'
)
export type MNetOperationalDegradedReasonCodeFromSchema =
  typeof MNetOperationalDegradedReasonCodeSchema.Type

export const MNetOperationalDegradedReasonSchema = Schema.Struct({
  code: MNetOperationalDegradedReasonCodeSchema,
  message: Schema.String,
  nodeId: Schema.optional(Schema.String),
  subject: Schema.optional(MNetProfileV03EventSubjectSchema),
  staleForMs: Schema.optional(Schema.Number),
  observedAt: Schema.optional(Schema.String)
})
export type MNetOperationalDegradedReasonFromSchema =
  typeof MNetOperationalDegradedReasonSchema.Type

export const MNetOperationalEventStreamSchema = Schema.Struct({
  status: Schema.Literal('healthy', 'degraded'),
  lastSubject: Schema.optional(MNetProfileV03EventSubjectSchema),
  lastEventId: Schema.optional(Schema.String),
  lastEventAt: Schema.optional(Schema.String),
  degradationReason: Schema.optional(MNetOperationalDegradedReasonSchema)
})
export type MNetOperationalEventStreamFromSchema = typeof MNetOperationalEventStreamSchema.Type

export const MNetOperationalNetworkStatusSchema = Schema.Struct({
  status: Schema.Literal('active', 'degraded'),
  memberCount: Schema.Number,
  profileState: Schema.String,
  lastUpdatedAt: Schema.String,
  summary: Schema.String
})
export type MNetOperationalNetworkStatusFromSchema = typeof MNetOperationalNetworkStatusSchema.Type

export const MNetOperationalProfileSelectionSchema = Schema.Struct({
  profileVersion: MNetOperationalProfileVersionSchema,
  displayName: Schema.String,
  schemaVersion: Schema.String,
  region: Schema.Literal('default', 'cn', 'unknown'),
  controlPlaneOnly: Schema.Boolean,
  compatibility: Schema.Literal('compatible', 'migration_required', 'unknown'),
  migration: Schema.optional(MNetMigrationRequiredSchema)
})
export type MNetOperationalProfileSelectionFromSchema =
  typeof MNetOperationalProfileSelectionSchema.Type

export const MNetOperationalNodeKindSchema = Schema.Literal('stem', 'leaf', 'unknown')
export type MNetOperationalNodeKindFromSchema = typeof MNetOperationalNodeKindSchema.Type

export const MNetOperationalSidecarNodeSchema = Schema.Struct({
  nodeId: Schema.String,
  nodeKind: MNetOperationalNodeKindSchema,
  profileVersion: MNetOperationalProfileVersionSchema,
  desiredState: Schema.optional(MNetSidecarDesiredStateSchema),
  credentialStatus: MNetSidecarCredentialStatusSchema,
  credentialRef: Schema.optional(RedactedSecretRefSchema),
  expiresAt: Schema.optional(Schema.String),
  healthStatus: MNetSidecarHealthStatusSchema,
  checkedAt: Schema.optional(Schema.String),
  signalReachable: Schema.optional(Schema.Boolean),
  relayReachable: Schema.optional(Schema.Boolean),
  stunReachable: Schema.optional(Schema.Boolean),
  stale: Schema.Boolean,
  staleForMs: Schema.optional(Schema.Number),
  summary: Schema.String
})
export type MNetOperationalSidecarNodeFromSchema = typeof MNetOperationalSidecarNodeSchema.Type

export const MNetOperationalTopologyNodeSchema = Schema.Struct({
  nodeId: Schema.String,
  label: Schema.String,
  nodeKind: MNetOperationalNodeKindSchema,
  healthStatus: MNetSidecarHealthStatusSchema,
  state: Schema.Literal('healthy', 'degraded', 'migration_required', 'unknown')
})
export type MNetOperationalTopologyNodeFromSchema = typeof MNetOperationalTopologyNodeSchema.Type

export const MNetOperationalTopologyEdgeSchema = Schema.Struct({
  edgeId: Schema.String,
  fromNodeId: Schema.String,
  toNodeId: Schema.String,
  relation: Schema.Literal('peer', 'relay', 'forced-relay')
})
export type MNetOperationalTopologyEdgeFromSchema = typeof MNetOperationalTopologyEdgeSchema.Type

export const MNetOperationalTopologySchema = Schema.Struct({
  topologyRevision: Schema.optional(Schema.String),
  routeClass: Schema.optional(MNetRouteClassSchema),
  nodes: Schema.Array(MNetOperationalTopologyNodeSchema),
  edges: Schema.Array(MNetOperationalTopologyEdgeSchema),
  summary: Schema.String
})
export type MNetOperationalTopologyFromSchema = typeof MNetOperationalTopologySchema.Type

export const MNetOperationalCredentialNodeSchema = Schema.Struct({
  nodeId: Schema.String,
  credentialStatus: MNetSidecarCredentialStatusSchema,
  expiresAt: Schema.optional(Schema.String),
  credentialRef: Schema.optional(RedactedSecretRefSchema),
  summary: Schema.String
})
export type MNetOperationalCredentialNodeFromSchema =
  typeof MNetOperationalCredentialNodeSchema.Type

export const MNetOperationalCredentialLifecycleSchema = Schema.Struct({
  status: MNetOperationalStatusSchema,
  nodes: Schema.Array(MNetOperationalCredentialNodeSchema),
  summary: Schema.String
})
export type MNetOperationalCredentialLifecycleFromSchema =
  typeof MNetOperationalCredentialLifecycleSchema.Type

export const MNetOperationalMigrationStateSchema = Schema.Struct({
  required: Schema.Boolean,
  resourceKind: Schema.optional(Schema.Literal('profile', 'node')),
  migration: Schema.optional(MNetMigrationRequiredSchema),
  summary: Schema.String
})
export type MNetOperationalMigrationStateFromSchema =
  typeof MNetOperationalMigrationStateSchema.Type

export const MNetOperationalForcedRelayStateSchema = Schema.Struct({
  active: Schema.Boolean,
  routeClass: Schema.optional(MNetRouteClassSchema),
  selectorOwnership: Schema.optional(MNetSelectorOwnershipSchema),
  selector: Schema.optional(MNetNodeSelectorSchema),
  operatorOverrideActive: Schema.optional(Schema.Boolean),
  affectedNodeIds: Schema.Array(Schema.String),
  summary: Schema.String
})
export type MNetOperationalForcedRelayStateFromSchema =
  typeof MNetOperationalForcedRelayStateSchema.Type

export const MNetOperationalDeploymentReadinessSchema = Schema.Struct({
  status: MNetOperationalStatusSchema,
  summary: Schema.String,
  reasons: Schema.Array(MNetOperationalDegradedReasonSchema)
})
export type MNetOperationalDeploymentReadinessFromSchema =
  typeof MNetOperationalDeploymentReadinessSchema.Type

export const MNetOperationalStateSourcesSchema = Schema.Struct({
  network: Schema.Literal('authoritative'),
  profileSelection: Schema.Literal('authoritative'),
  sidecars: Schema.Literal('read-model'),
  topology: Schema.Literal('read-model'),
  credentials: Schema.Literal('read-model'),
  migration: Schema.Literal('read-model'),
  forcedRelay: Schema.Literal('read-model'),
  deploymentReadiness: Schema.Literal('composed'),
  eventStream: Schema.Literal('read-model')
})
export type MNetOperationalStateSourcesFromSchema = typeof MNetOperationalStateSourcesSchema.Type

export const MNetOperationalSnapshotSchema = Schema.Struct({
  networkId: Schema.String,
  network: MNetOperationalNetworkStatusSchema,
  profileSelection: MNetOperationalProfileSelectionSchema,
  eventStream: MNetOperationalEventStreamSchema,
  sidecars: Schema.Array(MNetOperationalSidecarNodeSchema),
  topology: MNetOperationalTopologySchema,
  credentials: MNetOperationalCredentialLifecycleSchema,
  migrationRequired: MNetOperationalMigrationStateSchema,
  forcedRelay: MNetOperationalForcedRelayStateSchema,
  deploymentReadiness: MNetOperationalDeploymentReadinessSchema,
  stateSources: MNetOperationalStateSourcesSchema
})
export type MNetOperationalSnapshotFromSchema = typeof MNetOperationalSnapshotSchema.Type

export const MNetOperationalTopologySnapshotNodeSchema = Schema.Struct({
  nodeId: Schema.String,
  label: Schema.String,
  nodeKind: MNetOperationalNodeKindSchema,
  healthStatus: MNetSidecarHealthStatusSchema,
  state: Schema.Literal('healthy', 'degraded', 'migration_required', 'unknown')
})
export type MNetOperationalTopologySnapshotNodeFromSchema =
  typeof MNetOperationalTopologySnapshotNodeSchema.Type

export const MNetOperationalTopologySnapshotEdgeSchema = Schema.Struct({
  edgeId: Schema.String,
  fromNodeId: Schema.String,
  toNodeId: Schema.String,
  relation: Schema.Literal('peer', 'relay', 'forced-relay')
})
export type MNetOperationalTopologySnapshotEdgeFromSchema =
  typeof MNetOperationalTopologySnapshotEdgeSchema.Type

export const MNetOperationalEventEnvelopeSchema = Schema.Union(
  Schema.Struct({
    subject: Schema.Literal('mnet.sidecar.lifecycle.v0'),
    payload: MNetSidecarLifecycleEventPayloadSchema
  }),
  Schema.Struct({
    subject: Schema.Literal('mnet.sidecar.health.v0'),
    payload: MNetSidecarHealthEventPayloadSchema
  }),
  Schema.Struct({
    subject: Schema.Literal('mnet.topology.update.v0'),
    payload: MNetTopologyUpdateEventPayloadSchema
  }),
  Schema.Struct({
    subject: Schema.Literal('mnet.migration.required.v0'),
    payload: MNetMigrationRequiredEventPayloadSchema
  }),
  Schema.Struct({
    subject: Schema.Literal('mnet.forced_relay.change.v0'),
    payload: MNetForcedRelayChangeEventPayloadSchema
  }),
  Schema.Struct({
    subject: Schema.Literal('mnet.credential.expiry.v0'),
    payload: MNetCredentialExpiryEventPayloadSchema
  })
)
export type MNetOperationalEventEnvelopeFromSchema = typeof MNetOperationalEventEnvelopeSchema.Type

export const MNetOperationalEventIngestRequestSchema = Schema.Struct({
  networkId: Schema.String,
  eventId: Schema.optional(Schema.String),
  occurredAt: Schema.optional(Schema.String),
  event: MNetOperationalEventEnvelopeSchema
})
export type MNetOperationalEventIngestRequestFromSchema =
  typeof MNetOperationalEventIngestRequestSchema.Type

export const MNetOperationalEventIngestResponseSchema = Schema.Struct({
  accepted: Schema.Literal(true),
  networkId: Schema.String,
  publishStatus: Schema.Literal('published', 'degraded'),
  snapshotStatus: MNetOperationalStatusSchema,
  occurredAt: Schema.String
})
export type MNetOperationalEvent = MNetOperationalEventIngestRequestFromSchema

export type MNetOperationalEventIngestResponseFromSchema =
  typeof MNetOperationalEventIngestResponseSchema.Type
