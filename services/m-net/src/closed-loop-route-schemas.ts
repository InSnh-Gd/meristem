import type { TSchema } from '@sinclair/typebox'
import { t } from 'elysia'

const nonEmptyString = t.String({ minLength: 1 })

export const closedLoopIdParamsSchema = t.Object({ id: nonEmptyString })
export const closedLoopNetworkParamsSchema = t.Object({ networkId: nonEmptyString })

const nodeKindSchema = t.Union([t.Literal('core'), t.Literal('stem'), t.Literal('leaf')])
const v03ProfileSchema = t.Union([
  t.Literal('m-net@0.3.0'),
  t.Literal('m-net-cn@0.3.0')
])
const historicalProfileSchema = t.Union([
  t.Literal('m-net-default@0.1.0'),
  t.Literal('m-net-cn@0.1.0'),
  t.Literal('m-net-cn@0.2.0')
])

export const submitJoinBodySchema = t.Object({
  requestId: nonEmptyString,
  networkId: nonEmptyString,
  nodeId: nonEmptyString,
  requestedNodeKind: nodeKindSchema,
  requestedProfileVersion: v03ProfileSchema,
  expiresAt: nonEmptyString
})

export const decideJoinBodySchema = t.Union([
  t.Object({
    decision: t.Literal('approve'),
    credentialExpiresAt: nonEmptyString
  }),
  t.Object({
    decision: t.Literal('reject'),
    reason: nonEmptyString
  })
])

export const rotateCredentialBodySchema = t.Object({
  expiresAt: nonEmptyString,
  reason: nonEmptyString
})

export const reasonBodySchema = t.Object({ reason: nonEmptyString })

const routeClassSchema = t.Union([
  t.Literal('standard'),
  t.Literal('cn-resident'),
  t.Literal('forced-tcp-relay')
])

const selectorSchema = t.Union([
  t.Object({
    selectorType: t.Literal('node-ids'),
    nodeIds: t.Readonly(t.Array(nonEmptyString))
  }),
  t.Object({
    selectorType: t.Literal('label-selector'),
    matchLabels: t.Record(t.String(), t.String())
  }),
  t.Object({ selectorType: t.Literal('all-leaf-nodes'), includeAllLeafNodes: t.Literal(true) })
])

export const relayPolicyBodySchema = t.Object({
  state: t.Union([t.Literal('enabled'), t.Literal('disabled')]),
  routeClass: routeClassSchema,
  selector: selectorSchema,
  reason: nonEmptyString,
  affectedNodeIds: t.Array(nonEmptyString)
})

export const migrateProfileBodySchema = t.Object({
  networkId: nonEmptyString,
  sourceProfileVersion: historicalProfileSchema,
  targetProfileVersion: v03ProfileSchema,
  reason: nonEmptyString
})

export const initiateBreakGlassBodySchema = t.Object({
  networkId: nonEmptyString,
  reason: nonEmptyString
})

const policyEvidenceSchema = t.Object({
  policyDecisionId: nonEmptyString,
  source: t.Literal('m-policy'),
  outcome: t.Union([t.Literal('allow'), t.Literal('deny'), t.Literal('conditional')]),
  requiredPermission: nonEmptyString,
  reason: t.String(),
  decidedAt: nonEmptyString
})

const auditEvidenceSchema = t.Object({
  auditId: nonEmptyString,
  source: t.Literal('m-log-audit'),
  action: nonEmptyString,
  resource: nonEmptyString,
  actor: t.Union([
    t.Literal('viewer'),
    t.Literal('operator'),
    t.Literal('admin'),
    t.Literal('security-admin'),
    t.Literal('break-glass-reviewer')
  ]),
  result: t.Union([
    t.Literal('allowed'),
    t.Literal('denied'),
    t.Literal('expired'),
    t.Literal('auto-revoked'),
    t.Literal('rolled-back')
  ]),
  writtenAt: nonEmptyString,
  correlationId: nonEmptyString
})

const logEvidenceSchema = t.Object({
  timelineId: t.Optional(t.Union([nonEmptyString, t.Undefined()])),
  fullLogId: t.Optional(t.Union([nonEmptyString, t.Undefined()])),
  eventId: t.Optional(t.Union([nonEmptyString, t.Undefined()])),
  subject: t.Optional(t.Union([nonEmptyString, t.Undefined()])),
  correlationId: nonEmptyString
})

const evidenceSchema = t.Object({
  policy: policyEvidenceSchema,
  audit: auditEvidenceSchema,
  log: logEvidenceSchema
})

const operationDeniedSchema = t.Object({
  result: t.Literal('denied'),
  reason: t.String(),
  policy: policyEvidenceSchema,
  audit: auditEvidenceSchema,
  sideEffect: t.Literal('none'),
  correlationId: nonEmptyString
})

const publicationSchema = t.Object({
  status: t.Union([t.Literal('pending'), t.Literal('published')]),
  pendingSubjects: t.Readonly(t.Array(
    t.Union([
      t.Literal('mnet.join.requested.v0'),
      t.Literal('mnet.join.approved.v0'),
      t.Literal('mnet.join.rejected.v0'),
      t.Literal('mnet.credential.issued.v0'),
      t.Literal('mnet.credential.rotated.v0'),
      t.Literal('mnet.credential.revoked.v0'),
      t.Literal('mnet.topology.view.updated.v0'),
      t.Literal('mnet.topology.map.status.v0'),
      t.Literal('mnet.tunnel.health.v0'),
      t.Literal('mnet.relay_policy.changed.v0'),
      t.Literal('mnet.profile.migration.changed.v0'),
      t.Literal('mnet.break_glass.changed.v0'),
      t.Literal('mnet.sidecar.degraded.v0')
    ])
  ))
})

function mutationSchema<T extends TSchema>(value: T) {
  return t.Object({
    kind: t.Literal('mutation'),
    contractVersion: t.Literal('mnet-closed-loop-mutation@0.1.0'),
    value,
    publication: publicationSchema
  })
}

const pendingJoinSchema = t.Object({
  requestId: nonEmptyString,
  networkId: nonEmptyString,
  nodeId: nonEmptyString,
  requestedNodeKind: nodeKindSchema,
  requestedProfileVersion: v03ProfileSchema,
  requestedBy: t.Union([
    t.Literal('viewer'),
    t.Literal('operator'),
    t.Literal('admin'),
    t.Literal('security-admin'),
    t.Literal('break-glass-reviewer')
  ]),
  status: t.Union([
    t.Literal('pending'),
    t.Literal('approved'),
    t.Literal('rejected'),
    t.Literal('expired')
  ]),
  requestedAt: nonEmptyString,
  expiresAt: nonEmptyString,
  policyDecisionId: t.Optional(t.Union([nonEmptyString, t.Undefined()]))
})

const secretRefSchema = t.Object({
  provider: nonEmptyString,
  keyPath: nonEmptyString,
  version: t.Optional(t.Union([t.Number(), t.Undefined()]))
})

const credentialSchema = t.Object({
  credentialId: nonEmptyString,
  nodeId: nonEmptyString,
  networkId: nonEmptyString,
  profileVersion: v03ProfileSchema,
  status: t.Union([
    t.Literal('pending'),
    t.Literal('issued'),
    t.Literal('active'),
    t.Literal('rotating'),
    t.Literal('revoked'),
    t.Literal('expired')
  ]),
  credentialRef: secretRefSchema,
  issuedAt: nonEmptyString,
  expiresAt: nonEmptyString,
  rotatedFromCredentialId: t.Optional(t.Union([nonEmptyString, t.Undefined()])),
  revokedAt: t.Optional(t.Union([nonEmptyString, t.Undefined()])),
  revokedByAuditId: t.Optional(t.Union([nonEmptyString, t.Undefined()]))
})

const joinDecisionSchema = t.Union([
  t.Object({
    result: t.Literal('approved'),
    request: pendingJoinSchema,
    credential: credentialSchema,
    evidence: evidenceSchema,
    correlationId: nonEmptyString
  }),
  t.Object({
    result: t.Literal('rejected'),
    request: pendingJoinSchema,
    credential: t.Null(),
    evidence: evidenceSchema,
    correlationId: nonEmptyString
  })
])

const credentialLifecycleSchema = t.Object({
  result: t.Union([
    t.Literal('issued'),
    t.Literal('rotated'),
    t.Literal('revoked'),
    t.Literal('expired')
  ]),
  action: t.Union([
    t.Literal('issue'),
    t.Literal('rotate'),
    t.Literal('revoke'),
    t.Literal('expire')
  ]),
  credential: credentialSchema,
  previousCredentialId: t.Optional(t.Union([nonEmptyString, t.Undefined()])),
  existingTunnelsInvalidated: t.Boolean(),
  evidence: evidenceSchema,
  correlationId: nonEmptyString
})

const relayPolicyResultSchema = t.Object({
  result: t.Union([t.Literal('enabled'), t.Literal('disabled')]),
  relayPolicyId: nonEmptyString,
  networkId: nonEmptyString,
  state: t.Union([t.Literal('enabled'), t.Literal('disabled')]),
  routeClass: routeClassSchema,
  selector: selectorSchema,
  reason: nonEmptyString,
  affectedNodeIds: t.Readonly(t.Array(nonEmptyString)),
  evidence: evidenceSchema,
  correlationId: nonEmptyString
})

const migrationResultSchema = t.Object({
  migrationId: nonEmptyString,
  networkId: nonEmptyString,
  sourceProfileVersion: historicalProfileSchema,
  targetProfileVersion: v03ProfileSchema,
  state: t.Union([
    t.Literal('planned'),
    t.Literal('pending_approval'),
    t.Literal('running'),
    t.Literal('succeeded'),
    t.Literal('rollback_available'),
    t.Literal('rolling_back'),
    t.Literal('rolled_back'),
    t.Literal('failed')
  ]),
  appliedNetworkIds: t.Readonly(t.Array(nonEmptyString)),
  rollbackProfileVersion: historicalProfileSchema,
  rollbackState: t.Union([
    t.Literal('not-needed'),
    t.Literal('available'),
    t.Literal('in-progress'),
    t.Literal('completed'),
    t.Literal('failed')
  ]),
  evidence: evidenceSchema,
  correlationId: nonEmptyString
})

const breakGlassSchema = t.Object({
  grantId: nonEmptyString,
  networkId: nonEmptyString,
  initiatedBy: t.Literal('security-admin'),
  secondApprover: t.Optional(
    t.Union([t.Literal('break-glass-reviewer'), t.Undefined()])
  ),
  state: t.Union([
    t.Literal('initiated'),
    t.Literal('second_approval_pending'),
    t.Literal('active'),
    t.Literal('auto_revoked')
  ]),
  ttlMinutes: t.Literal(30),
  initiatedAt: nonEmptyString,
  expiresAt: nonEmptyString,
  autoRevokedAt: t.Optional(t.Union([nonEmptyString, t.Undefined()])),
  requiresNormalApprovalAfterExpiry: t.Literal(true),
  evidence: evidenceSchema,
  correlationId: nonEmptyString
})

const sidecarStatusSchema = t.Object({
  nodeId: nonEmptyString,
  desiredState: t.Union([
    t.Literal('install'),
    t.Literal('configure'),
    t.Literal('start'),
    t.Literal('drain'),
    t.Literal('stop')
  ]),
  healthStatus: t.Union([
    t.Literal('unknown'),
    t.Literal('healthy'),
    t.Literal('degraded'),
    t.Literal('unhealthy')
  ]),
  degradedReason: t.Optional(t.Union([nonEmptyString, t.Undefined()])),
  proofPath: t.Union([
    t.Literal('sidecar-proof'),
    t.Literal('runtime-probe'),
    t.Literal('operator-report')
  ]),
  fallbackTransport: t.Optional(
    t.Union([t.Literal('wireguard-rendered'), t.Undefined()])
  ),
  uiFacingFact: t.Literal(true),
  healthy: t.Boolean(),
  checkedAt: nonEmptyString
})

export const tunnelHealthSchema = t.Object({
  nodeId: nonEmptyString,
  peerNodeId: nonEmptyString,
  status: t.Union([t.Literal('up'), t.Literal('degraded'), t.Literal('down')]),
  mode: t.Union([
    t.Literal('direct'),
    t.Literal('relay'),
    t.Literal('forced-relay'),
    t.Literal('none')
  ]),
  latencyMs: t.Optional(t.Union([t.Number({ minimum: 0 }), t.Undefined()])),
  packetLossPct: t.Optional(
    t.Union([t.Number({ minimum: 0, maximum: 100 }), t.Undefined()])
  ),
  relayStatus: t.Union([
    t.Literal('not-required'),
    t.Literal('available'),
    t.Literal('forced'),
    t.Literal('unavailable')
  ]),
  checkedAt: nonEmptyString,
  stateSource: t.Union([
    t.Literal('opensearch-projection'),
    t.Literal('node-runtime-report')
  ])
})

const mapStatusSchema = t.Object({
  mapId: nonEmptyString,
  networkId: nonEmptyString,
  topologyRevision: nonEmptyString,
  signedBy: nonEmptyString,
  issuedAt: nonEmptyString,
  expiresAt: nonEmptyString,
  freshness: t.Union([
    t.Literal('fresh'),
    t.Literal('stale'),
    t.Literal('expired'),
    t.Literal('fail_closed')
  ]),
  stateSource: t.Literal('nats-kv-cache'),
  validation: t.Union([
    t.Literal('valid'),
    t.Literal('signature_invalid'),
    t.Literal('stale'),
    t.Literal('expired')
  ])
})

const topologySchema = t.Object({
  contractVersion: t.Literal('mnet-closed-loop@0.1.0'),
  generatedAt: nonEmptyString,
  stateSource: t.Literal('composed-ui-fact'),
  networks: t.Readonly(t.Array(
    t.Object({
      networkId: nonEmptyString,
      displayName: nonEmptyString,
      profileVersion: v03ProfileSchema,
      status: t.Union([
        t.Literal('healthy'),
        t.Literal('degraded'),
        t.Literal('fail_closed'),
        t.Literal('migration_required')
      ]),
      mapStatus: mapStatusSchema,
      relayPolicyState: t.Union([
        t.Literal('enabled'),
        t.Literal('disabled'),
        t.Literal('denied')
      ])
    })
  )),
  nodes: t.Readonly(t.Array(
    t.Object({
      nodeId: nonEmptyString,
      nodeKind: nodeKindSchema,
      runtimeState: t.Union([
        t.Literal('joining'),
        t.Literal('healthy'),
        t.Literal('degraded'),
        t.Literal('offline'),
        t.Literal('disabled'),
        t.Literal('isolated'),
        t.Literal('recovering'),
        t.Literal('revoked')
      ]),
      profileVersion: v03ProfileSchema,
      sidecar: sidecarStatusSchema,
      credentialStatus: credentialSchema.properties.status,
      keyStatus: t.Object({
        nodeId: nonEmptyString,
        publicKeyFingerprint: nonEmptyString,
        status: t.Union([
          t.Literal('registered'),
          t.Literal('rotation_required'),
          t.Literal('revoked'),
          t.Literal('stale')
        ]),
        lastValidatedAt: nonEmptyString,
        auditId: t.Optional(t.Union([nonEmptyString, t.Undefined()]))
      })
    })
  )),
  profiles: t.Readonly(t.Array(v03ProfileSchema)),
  tunnelHealth: t.Readonly(t.Array(tunnelHealthSchema)),
  sidecarStatuses: t.Readonly(t.Array(sidecarStatusSchema)),
  degraded: t.Boolean(),
  correlationId: nonEmptyString
})

export const submitJoinResponseSchema = t.Union([
  mutationSchema(pendingJoinSchema),
  operationDeniedSchema
])
export const joinDecisionResponseSchema = t.Union([
  mutationSchema(joinDecisionSchema),
  operationDeniedSchema
])
export const credentialLifecycleResponseSchema = t.Union([
  mutationSchema(credentialLifecycleSchema),
  operationDeniedSchema
])
export const relayPolicyResponseSchema = t.Union([
  mutationSchema(relayPolicyResultSchema),
  operationDeniedSchema
])
export const migrationResponseSchema = t.Union([
  mutationSchema(migrationResultSchema),
  operationDeniedSchema
])
export const breakGlassResponseSchema = t.Union([
  mutationSchema(breakGlassSchema),
  operationDeniedSchema
])
export const topologyResponseSchema = topologySchema
export const tunnelHealthMutationResponseSchema = mutationSchema(tunnelHealthSchema)
