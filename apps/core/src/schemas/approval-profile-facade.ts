import { t } from 'elysia'

const actorIdSchema = t.Union([
  t.Literal('viewer'),
  t.Literal('operator'),
  t.Literal('admin'),
  t.Literal('security-admin'),
  t.Literal('break-glass-reviewer')
])

export const policyApprovalSchema = t.Object({
  id: t.String(),
  policyDecisionId: t.String(),
  originService: t.Union([t.Literal('m-task'), t.Literal('m-net')]),
  operationId: t.String(),
  requestedBy: actorIdSchema,
  requiredAction: t.Union([t.Literal('manual_review'), t.Literal('multi_approval')]),
  status: t.Union([
    t.Literal('pending'),
    t.Literal('approved'),
    t.Literal('rejected'),
    t.Literal('expired'),
    t.Literal('canceled')
  ]),
  quorumRequired: t.Number(),
  expiresAt: t.String(),
  createdAt: t.String(),
  updatedAt: t.String(),
  completedAt: t.Optional(t.String())
})

export const policyApprovalVoteSchema = t.Object({
  id: t.String(),
  approvalId: t.String(),
  actor: actorIdSchema,
  vote: t.Union([t.Literal('approve'), t.Literal('reject')]),
  reason: t.Optional(t.String()),
  createdAt: t.String()
})

export const approvalListResponseSchema = t.Object({
  approvals: t.Array(policyApprovalSchema)
})

export const approvalDetailResponseSchema = t.Object({
  id: t.String(),
  policyDecisionId: t.String(),
  originService: t.Union([t.Literal('m-task'), t.Literal('m-net')]),
  operationId: t.String(),
  requestedBy: actorIdSchema,
  requiredAction: t.Union([t.Literal('manual_review'), t.Literal('multi_approval')]),
  status: t.Union([
    t.Literal('pending'),
    t.Literal('approved'),
    t.Literal('rejected'),
    t.Literal('expired'),
    t.Literal('canceled')
  ]),
  quorumRequired: t.Number(),
  expiresAt: t.String(),
  createdAt: t.String(),
  updatedAt: t.String(),
  completedAt: t.Optional(t.String()),
  votes: t.Array(policyApprovalVoteSchema)
})

const mNetInfrastructureConfigRefSchema = t.Object({
  configRef: t.String()
})

const mNetRegionalProfileCapabilitiesSchema = t.Object({
  controlPlaneOnly: t.Literal(false),
  managementPlaneExcluded: t.Literal(true),
  realNetBirdSidecar: t.Literal(true),
  signalConfigRef: mNetInfrastructureConfigRefSchema,
  relayConfigRef: mNetInfrastructureConfigRefSchema,
  stunConfigRef: mNetInfrastructureConfigRefSchema,
  sidecarDesiredState: t.Union([
    t.Literal('install'),
    t.Literal('configure'),
    t.Literal('start'),
    t.Literal('drain'),
    t.Literal('stop')
  ]),
  sidecarCredentialRef: t.Object({
    provider: t.String(),
    keyPath: t.String(),
    version: t.Number()
  }),
  sidecarCredentialStatus: t.Union([
    t.Literal('missing'),
    t.Literal('pending'),
    t.Literal('ready'),
    t.Literal('expired'),
    t.Literal('rotation_required')
  ]),
  sidecarHealthStatus: t.Union([
    t.Literal('unknown'),
    t.Literal('healthy'),
    t.Literal('degraded'),
    t.Literal('unhealthy')
  ])
})

const mNetForcedTcpRelaySelectorSchema = t.Object({
  enabled: t.Literal(true),
  selectorOwnership: t.Union([t.Literal('operator'), t.Literal('policy')]),
  selector: t.Union([
    t.Object({ selectorType: t.Literal('all-leaf-nodes'), includeAllLeafNodes: t.Literal(true) }),
    t.Object({ selectorType: t.Literal('node-ids'), nodeIds: t.Array(t.String()) }),
    t.Object({ selectorType: t.Literal('label-selector'), matchLabels: t.Record(t.String(), t.String()) })
  ]),
  routeClass: t.Union([t.Literal('standard'), t.Literal('cn-resident'), t.Literal('forced-tcp-relay')]),
  operatorOverrideAllowed: t.Boolean(),
  operatorOverrideActive: t.Boolean(),
  operatorOverrideActor: t.Optional(actorIdSchema),
  operatorOverrideReason: t.Optional(t.String()),
  policyDecision: t.Object({
    decisionId: t.String(),
    source: t.Literal('m-policy'),
    outcome: t.Union([t.Literal('allow'), t.Literal('deny'), t.Literal('conditional')]),
    reason: t.String()
  }),
  auditEvidence: t.Object({
    auditId: t.String(),
    eventId: t.String(),
    eventSubject: t.Literal('mnet.forced_relay.change.v0')
  })
})

export const mNetRegionalProfileSchema = t.Object({
  profileVersion: t.Union([t.Literal('m-net@0.3.0'), t.Literal('m-net-cn@0.3.0')]),
  region: t.Union([t.Literal('cn'), t.Literal('default')]),
  displayName: t.String(),
  schemaVersion: t.Literal('mnet-profile@0.3.0'),
  status: t.Union([t.Literal('available'), t.Literal('deprecated')]),
  rules: t.Record(t.String(), t.Unknown()),
  capabilities: mNetRegionalProfileCapabilitiesSchema,
  forcedTcpRelaySelector: t.Optional(mNetForcedTcpRelaySelectorSchema)
})

export const networkProfileListResponseSchema = t.Object({
  profiles: t.Array(mNetRegionalProfileSchema)
})
