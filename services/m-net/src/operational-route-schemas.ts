import { t } from 'elysia'
import {
  externalErrorSchema,
  internalErrorSchema,
  internalResponse,
  networkIdParamsSchema
} from './route-schemas.ts'

export { internalResponse, networkIdParamsSchema, externalErrorSchema, internalErrorSchema }

export const operationalDegradedReasonSchema = t.Object({
  code: t.Union([
    t.Literal('eventbus_unavailable'),
    t.Literal('sidecar_report_stale'),
    t.Literal('migration_required'),
    t.Literal('credential_missing'),
    t.Literal('credential_expired'),
    t.Literal('credential_rotation_required'),
    t.Literal('sidecar_unhealthy'),
    t.Literal('topology_missing'),
    t.Literal('network_not_ready')
  ]),
  message: t.String(),
  nodeId: t.Optional(t.String()),
  subject: t.Optional(
    t.Union([
      t.Literal('mnet.sidecar.lifecycle.v0'),
      t.Literal('mnet.sidecar.health.v0'),
      t.Literal('mnet.topology.update.v0'),
      t.Literal('mnet.migration.required.v0'),
      t.Literal('mnet.forced_relay.change.v0'),
      t.Literal('mnet.credential.expiry.v0')
    ])
  ),
  staleForMs: t.Optional(t.Number()),
  observedAt: t.Optional(t.String())
})

export const operationalSelectorSchema = t.Union([
  t.Object({ selectorType: t.Literal('all-leaf-nodes'), includeAllLeafNodes: t.Literal(true) }),
  t.Object({ selectorType: t.Literal('node-ids'), nodeIds: t.Array(t.String()) }),
  t.Object({ selectorType: t.Literal('label-selector'), matchLabels: t.Record(t.String(), t.String()) })
])

export const operationalMigrationSchema = t.Object({
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

export const operationalSnapshotResponseSchema = t.Object({
  networkId: t.String(),
  network: t.Object({
    status: t.Union([t.Literal('active'), t.Literal('degraded')]),
    memberCount: t.Number(),
    profileState: t.String(),
    lastUpdatedAt: t.String(),
    summary: t.String()
  }),
  profileSelection: t.Object({
    profileVersion: t.String(),
    displayName: t.String(),
    schemaVersion: t.String(),
    region: t.Union([t.Literal('default'), t.Literal('cn'), t.Literal('unknown')]),
    controlPlaneOnly: t.Boolean(),
    compatibility: t.Union([
      t.Literal('compatible'),
      t.Literal('migration_required'),
      t.Literal('unknown')
    ]),
    migration: t.Optional(operationalMigrationSchema)
  }),
  eventStream: t.Object({
    status: t.Union([t.Literal('healthy'), t.Literal('degraded')]),
    lastSubject: t.Optional(
      t.Union([
        t.Literal('mnet.sidecar.lifecycle.v0'),
        t.Literal('mnet.sidecar.health.v0'),
        t.Literal('mnet.topology.update.v0'),
        t.Literal('mnet.migration.required.v0'),
        t.Literal('mnet.forced_relay.change.v0'),
        t.Literal('mnet.credential.expiry.v0')
      ])
    ),
    lastEventId: t.Optional(t.String()),
    lastEventAt: t.Optional(t.String()),
    degradationReason: t.Optional(operationalDegradedReasonSchema)
  }),
  sidecars: t.Array(
    t.Object({
      nodeId: t.String(),
      nodeKind: t.Union([t.Literal('stem'), t.Literal('leaf'), t.Literal('unknown')]),
      profileVersion: t.String(),
      desiredState: t.Optional(
        t.Union([
          t.Literal('install'),
          t.Literal('configure'),
          t.Literal('start'),
          t.Literal('drain'),
          t.Literal('stop')
        ])
      ),
      credentialStatus: t.Union([
        t.Literal('missing'),
        t.Literal('pending'),
        t.Literal('ready'),
        t.Literal('expired'),
        t.Literal('rotation_required')
      ]),
      credentialRef: t.Optional(
        t.Object({ provider: t.String(), keyPath: t.String(), version: t.Optional(t.Number()) })
      ),
      expiresAt: t.Optional(t.String()),
      healthStatus: t.Union([
        t.Literal('unknown'),
        t.Literal('healthy'),
        t.Literal('degraded'),
        t.Literal('unhealthy')
      ]),
      checkedAt: t.Optional(t.String()),
      signalReachable: t.Optional(t.Boolean()),
      relayReachable: t.Optional(t.Boolean()),
      stunReachable: t.Optional(t.Boolean()),
      stale: t.Boolean(),
      staleForMs: t.Optional(t.Number()),
      summary: t.String()
    })
  ),
  topology: t.Object({
    topologyRevision: t.Optional(t.String()),
    routeClass: t.Optional(
      t.Union([
        t.Literal('standard'),
        t.Literal('cn-resident'),
        t.Literal('forced-tcp-relay')
      ])
    ),
    nodes: t.Array(
      t.Object({
        nodeId: t.String(),
        label: t.String(),
        nodeKind: t.Union([t.Literal('stem'), t.Literal('leaf'), t.Literal('unknown')]),
        healthStatus: t.Union([
          t.Literal('unknown'),
          t.Literal('healthy'),
          t.Literal('degraded'),
          t.Literal('unhealthy')
        ]),
        state: t.Union([
          t.Literal('healthy'),
          t.Literal('degraded'),
          t.Literal('migration_required'),
          t.Literal('unknown')
        ])
      })
    ),
    edges: t.Array(
      t.Object({
        edgeId: t.String(),
        fromNodeId: t.String(),
        toNodeId: t.String(),
        relation: t.Union([t.Literal('peer'), t.Literal('relay'), t.Literal('forced-relay')])
      })
    ),
    summary: t.String()
  }),
  credentials: t.Object({
    status: t.Union([t.Literal('healthy'), t.Literal('degraded'), t.Literal('blocked')]),
    nodes: t.Array(
      t.Object({
        nodeId: t.String(),
        credentialStatus: t.Union([
          t.Literal('missing'),
          t.Literal('pending'),
          t.Literal('ready'),
          t.Literal('expired'),
          t.Literal('rotation_required')
        ]),
        expiresAt: t.Optional(t.String()),
        credentialRef: t.Optional(
          t.Object({ provider: t.String(), keyPath: t.String(), version: t.Optional(t.Number()) })
        ),
        summary: t.String()
      })
    ),
    summary: t.String()
  }),
  migrationRequired: t.Object({
    required: t.Boolean(),
    resourceKind: t.Optional(t.Union([t.Literal('profile'), t.Literal('node')])),
    migration: t.Optional(operationalMigrationSchema),
    summary: t.String()
  }),
  forcedRelay: t.Object({
    active: t.Boolean(),
    routeClass: t.Optional(
      t.Union([
        t.Literal('standard'),
        t.Literal('cn-resident'),
        t.Literal('forced-tcp-relay')
      ])
    ),
    selectorOwnership: t.Optional(t.Union([t.Literal('operator'), t.Literal('policy')])),
    selector: t.Optional(operationalSelectorSchema),
    operatorOverrideActive: t.Optional(t.Boolean()),
    affectedNodeIds: t.Array(t.String()),
    summary: t.String()
  }),
  deploymentReadiness: t.Object({
    status: t.Union([t.Literal('healthy'), t.Literal('degraded'), t.Literal('blocked')]),
    summary: t.String(),
    reasons: t.Array(operationalDegradedReasonSchema)
  }),
  stateSources: t.Object({
    network: t.Literal('authoritative'),
    profileSelection: t.Literal('authoritative'),
    sidecars: t.Literal('read-model'),
    topology: t.Literal('read-model'),
    credentials: t.Literal('read-model'),
    migration: t.Literal('read-model'),
    forcedRelay: t.Literal('read-model'),
    deploymentReadiness: t.Literal('composed'),
    eventStream: t.Literal('read-model')
  })
})

export const operationalEventIngestBodySchema = t.Object({
  networkId: t.String({ minLength: 1 }),
  eventId: t.Optional(t.String({ minLength: 1 })),
  occurredAt: t.Optional(t.String({ minLength: 1 })),
  event: t.Object({
    subject: t.Union([
      t.Literal('mnet.sidecar.lifecycle.v0'),
      t.Literal('mnet.sidecar.health.v0'),
      t.Literal('mnet.topology.update.v0'),
      t.Literal('mnet.migration.required.v0'),
      t.Literal('mnet.forced_relay.change.v0'),
      t.Literal('mnet.credential.expiry.v0')
    ]),
    payload: t.Any()
  })
})

export const operationalEventIngestResponseSchema = t.Object({
  accepted: t.Literal(true),
  networkId: t.String(),
  publishStatus: t.Union([t.Literal('published'), t.Literal('degraded')]),
  snapshotStatus: t.Union([t.Literal('healthy'), t.Literal('degraded'), t.Literal('blocked')]),
  occurredAt: t.String()
})

export const operationalExternalErrorResponses = {
  401: externalErrorSchema,
  404: externalErrorSchema,
  503: externalErrorSchema
} as const
