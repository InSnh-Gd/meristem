import { t } from 'elysia'

/**
 * M-Deploy 公开路由共享 TypeBox 请求体契约。
 * Core public facade 与 M-Deploy 公开路由共用同一份定义，防止两侧漂移；
 * 追加字段遵循契约版本化规则，禁止单侧改名或删字段。
 */

export const deployDigestSchema = t.Object({
  algorithm: t.Union([t.Literal('sha256'), t.Literal('sha512')]),
  value: t.String({ minLength: 1 })
})

export const deployProposalBodySchema = t.Object({
  sourceRef: t.Object({
    repositoryUrl: t.String({ minLength: 1 }),
    branch: t.String({ minLength: 1 }),
    commit: t.String({ minLength: 1 }),
    path: t.String({ minLength: 1 }),
    digest: deployDigestSchema,
    syncedAt: t.String({ minLength: 1 })
  }),
  diffSummary: t.Object({
    added: t.Number({ minimum: 0 }),
    changed: t.Number({ minimum: 0 }),
    removed: t.Number({ minimum: 0 }),
    summary: t.String({ minLength: 1 })
  })
})

export const deployApprovalBodySchema = t.Object({
  result: t.Union([t.Literal('approve'), t.Literal('reject')])
})

export const deployApplyBodySchema = t.Object({
  proposalId: t.String({ minLength: 1 }),
  agentId: t.String({ minLength: 1 })
})

export const deployRollbackBodySchema = t.Object({
  agentId: t.String({ minLength: 1 }),
  targetDigest: deployDigestSchema
})

export const deployProposalParamsSchema = t.Object({ id: t.String({ minLength: 1 }) })

// ── 公开路由响应信封（与 M-Deploy 公开路由的 Effect Schema 形状严格一致）────
const deployApprovalStatusSchema = t.Union([
  t.Literal('pending'),
  t.Literal('approved'),
  t.Literal('rejected'),
  t.Literal('expired')
])
const deployOperationStatusSchema = t.Union([
  t.Literal('queued'),
  t.Literal('running'),
  t.Literal('succeeded'),
  t.Literal('failed'),
  t.Literal('blocked')
])
const deployStateSourceSchema = t.Union([
  t.Literal('git'),
  t.Literal('agent'),
  t.Literal('iac'),
  t.Literal('runtime')
])
const deployDriftTypeSchema = t.Union([
  t.Literal('runtime_state'),
  t.Literal('iac_state'),
  t.Literal('artifact_digest'),
  t.Literal('service_config')
])
const deployDriftSeveritySchema = t.Union([
  t.Literal('low'),
  t.Literal('medium'),
  t.Literal('high'),
  t.Literal('critical')
])
const deployEvidenceTypeSchema = t.Union([
  t.Literal('signature_verification'),
  t.Literal('runtime_plan'),
  t.Literal('runtime_apply'),
  t.Literal('opentofu_plan'),
  t.Literal('opentofu_apply'),
  t.Literal('agent_ack'),
  t.Literal('drift_report'),
  t.Literal('rollback')
])

export const deployDesiredStateResponseSchema = t.Object({
  latestDigest: t.Optional(deployDigestSchema),
  lastSuccessfulDigest: t.Optional(deployDigestSchema),
  syncedAt: t.Optional(t.String()),
  stale: t.Boolean(),
  controllerAvailable: t.Boolean()
})

export const deployProposalResponseSchema = t.Object({
  proposal: t.Object({
    schemaVersion: t.Literal('mdeploy.proposal@0.1.0'),
    proposalId: t.String(),
    sourceRef: t.Object({
      repositoryUrl: t.String(),
      branch: t.String(),
      commit: t.String(),
      path: t.String(),
      digest: deployDigestSchema,
      syncedAt: t.String()
    }),
    diffSummary: t.Object({
      added: t.Number(),
      changed: t.Number(),
      removed: t.Number(),
      summary: t.String()
    }),
    actor: t.String(),
    policyDecisionId: t.String(),
    approvalStatus: deployApprovalStatusSchema,
    createdAt: t.String(),
    correlationId: t.String()
  })
})

export const deployApprovalResponseSchema = t.Object({
  approval: t.Object({
    schemaVersion: t.Literal('mdeploy.approval@0.1.0'),
    approvalId: t.String(),
    proposalId: t.String(),
    approver: t.String(),
    timestamp: t.String(),
    result: t.Union([t.Literal('approve'), t.Literal('reject')]),
    policyDecisionId: t.String(),
    correlationId: t.String()
  })
})

const deployOperationFields = {
  operationId: t.String(),
  kind: t.Union([t.Literal('apply'), t.Literal('rollback')]),
  proposalId: t.Optional(t.String()),
  agentId: t.String(),
  envelope: t.Unknown(),
  desiredStateDigest: deployDigestSchema,
  actor: t.String(),
  policyDecisionId: t.String(),
  quorumProofId: t.Optional(t.String()),
  auditId: t.String(),
  correlationId: t.String(),
  status: deployOperationStatusSchema,
  publicationStatus: t.Union([t.Literal('pending'), t.Literal('published')]),
  createdAt: t.String(),
  previousDigest: t.Optional(deployDigestSchema),
  completedAt: t.Optional(t.String())
}

export const deployOperationResponseSchema = t.Object(deployOperationFields)

export const deployApplyResponseSchema = t.Object({
  operation: t.Object({ ...deployOperationFields, applyStatus: deployOperationStatusSchema })
})

export const deployRollbackResponseSchema = t.Object({
  operation: deployOperationResponseSchema
})

export const deployDriftResponseSchema = t.Object({
  reports: t.Array(
    t.Object({
      schemaVersion: t.Literal('mdeploy.drift-report@0.1.0'),
      reportId: t.String(),
      agentId: t.String(),
      expectedState: t.Object({ digest: deployDigestSchema, source: deployStateSourceSchema }),
      actualState: t.Object({ digest: deployDigestSchema, source: deployStateSourceSchema }),
      driftType: deployDriftTypeSchema,
      severity: deployDriftSeveritySchema,
      timestamp: t.String(),
      resolvedAt: t.Optional(t.String())
    })
  )
})

export const deployDriftCheckResponseSchema = t.Object({
  requested: t.Literal(true),
  correlationId: t.String()
})

export const deployEvidenceResponseSchema = t.Object({
  evidence: t.Array(
    t.Object({
      schemaVersion: t.Literal('mdeploy.evidence-metadata@0.1.0'),
      operationId: t.String(),
      correlationId: t.String(),
      auditId: t.String(),
      evidenceType: deployEvidenceTypeSchema,
      timestamp: t.String(),
      storageRef: t.Object({
        uri: t.String(),
        digest: deployDigestSchema,
        redactionStatus: t.Union([t.Literal('redacted'), t.Literal('metadata_only')])
      })
    })
  )
})

export const deployAgentsResponseSchema = t.Object({
  agents: t.Array(
    t.Object({
      enrollment: t.Object({
        schemaVersion: t.Literal('mdeploy.agent-enrollment@0.1.0'),
        agentId: t.String(),
        hostId: t.String(),
        capabilities: t.Array(
          t.Object({
            runtimeDriver: t.Union([t.Literal('podman'), t.Literal('docker')]),
            version: t.String(),
            features: t.Array(t.String())
          })
        ),
        controllerTrust: t.Object({
          issuer: t.String(),
          audience: t.String(),
          publicKeyFingerprint: t.String(),
          expiresAt: t.String()
        }),
        enrolledAt: t.String()
      }),
      heartbeat: t.Optional(
        t.Object({
          schemaVersion: t.Literal('mdeploy.agent-heartbeat@0.1.0'),
          agentId: t.String(),
          timestamp: t.String(),
          lastAppliedDigest: t.Optional(deployDigestSchema),
          driftStatus: t.Union([t.Literal('none'), t.Literal('suspected'), t.Literal('confirmed')]),
          health: t.Union([t.Literal('healthy'), t.Literal('degraded'), t.Literal('unhealthy')]),
          connectionStatus: t.Union([t.Literal('connected'), t.Literal('disconnected')]),
          runtimeDrivers: t.Array(t.Union([t.Literal('podman'), t.Literal('docker')])),
          correlationId: t.Optional(t.String())
        })
      )
    })
  )
})

export const deployApiRoutes = {
  desiredState: '/api/v0/deploy/desired-state',
  proposals: '/api/v0/deploy/proposals',
  proposalDetail: '/api/v0/deploy/proposals/:id',
  approve: '/api/v0/deploy/proposals/:id/approve',
  apply: '/api/v0/deploy/apply',
  rollback: '/api/v0/deploy/rollback',
  drift: '/api/v0/deploy/drift',
  driftCheck: '/api/v0/deploy/drift/check',
  evidence: '/api/v0/deploy/evidence',
  agents: '/api/v0/deploy/agents'
} as const
