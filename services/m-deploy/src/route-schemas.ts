import { t } from 'elysia'
import {
  apiErrorRouteSchema,
  deployApprovalBodySchema,
  deployApplyBodySchema,
  deployDigestSchema,
  deployProposalBodySchema,
  deployRollbackBodySchema
} from '../../../packages/contracts/src/index.ts'

export { apiErrorRouteSchema }

// 公开路由请求体与 Core facade 共用 contracts 定义，避免两侧漂移。
export const digestSchema = deployDigestSchema
export const proposalBodySchema = deployProposalBodySchema
export const approvalBodySchema = deployApprovalBodySchema
export const applyBodySchema = deployApplyBodySchema
export const rollbackBodySchema = deployRollbackBodySchema

export const agentEnrollmentBodySchema = t.Object({
  schemaVersion: t.Literal('mdeploy.agent-enrollment@0.1.0'),
  agentId: t.String({ minLength: 1 }),
  hostId: t.String({ minLength: 1 }),
  capabilities: t.Array(
    t.Object({
      runtimeDriver: t.Union([t.Literal('podman'), t.Literal('docker')]),
      version: t.String({ minLength: 1 }),
      features: t.Array(t.String())
    })
  ),
  controllerTrust: t.Object({
    issuer: t.String({ minLength: 1 }),
    audience: t.String({ minLength: 1 }),
    publicKeyFingerprint: t.String({ minLength: 1 }),
    expiresAt: t.String({ minLength: 1 })
  }),
  enrolledAt: t.String({ minLength: 1 })
})

export const agentHeartbeatBodySchema = t.Object({
  schemaVersion: t.Literal('mdeploy.agent-heartbeat@0.1.0'),
  agentId: t.String({ minLength: 1 }),
  timestamp: t.String({ minLength: 1 }),
  lastAppliedDigest: t.Optional(digestSchema),
  driftStatus: t.Union([t.Literal('none'), t.Literal('suspected'), t.Literal('confirmed')]),
  health: t.Union([t.Literal('healthy'), t.Literal('degraded'), t.Literal('unhealthy')]),
  connectionStatus: t.Union([t.Literal('connected'), t.Literal('disconnected')]),
  runtimeDrivers: t.Array(t.Union([t.Literal('podman'), t.Literal('docker')])),
  correlationId: t.Optional(t.String({ minLength: 1 }))
})

export const driftReportBodySchema = t.Object({
  schemaVersion: t.Literal('mdeploy.drift-report@0.1.0'),
  reportId: t.String({ minLength: 1 }),
  agentId: t.String({ minLength: 1 }),
  expectedState: t.Object({
    digest: digestSchema,
    source: t.Union([t.Literal('git'), t.Literal('agent'), t.Literal('iac'), t.Literal('runtime')])
  }),
  actualState: t.Object({
    digest: digestSchema,
    source: t.Union([t.Literal('git'), t.Literal('agent'), t.Literal('iac'), t.Literal('runtime')])
  }),
  driftType: t.Union([
    t.Literal('runtime_state'),
    t.Literal('iac_state'),
    t.Literal('artifact_digest'),
    t.Literal('service_config')
  ]),
  severity: t.Union([
    t.Literal('low'),
    t.Literal('medium'),
    t.Literal('high'),
    t.Literal('critical')
  ]),
  timestamp: t.String({ minLength: 1 }),
  resolvedAt: t.Optional(t.String({ minLength: 1 }))
})

export const identifierParamsSchema = t.Object({ id: t.String({ minLength: 1 }) })
