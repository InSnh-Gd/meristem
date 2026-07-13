import { err, ok, type Result } from '../../../packages/common/src/result.ts'
import type {
  MDeployAgentEnrollmentV01FromSchema,
  MDeployAgentHeartbeatV01FromSchema,
  MDeployDriftReportV01FromSchema
} from '../../../packages/contracts/src/index.ts'
import { validateInternalRequest } from '../../../packages/internal-http/src/index.ts'
import {
  isMDeployRouteFailure,
  type MDeployRouteFailure,
  routeFailure
} from './controller-support.ts'
import type { MDeployAgentRecord, MDeployDeps, MDeployError } from './deps.ts'
import { persistMDeployEvidence } from './evidence-support.ts'

/** 内部入口只接受共享 loopback 令牌，外部 actor 无法绕过 Core public facade。 */
export function requireMDeployInternalRequest(
  headers: Record<string, string | undefined>
): { correlationId: string } | MDeployRouteFailure {
  const validated = validateInternalRequest(headers)
  if (!validated.ok) return routeFailure(401, validated.error)
  return { correlationId: headers['x-correlation-id'] ?? crypto.randomUUID() }
}

/** enrollment 必须经过注入的 agent identity verifier，服务本身不签发或拥有身份。 */
export async function enrollMDeployAgent(
  deps: MDeployDeps,
  enrollment: MDeployAgentEnrollmentV01FromSchema
): Promise<Result<MDeployAgentRecord, MDeployError>> {
  const verified = await deps.agentIdentity.verifyEnrollment(enrollment)
  if (!verified.ok) return verified
  return deps.store.upsertAgent({ enrollment })
}

/** 心跳只更新部署健康摘要，不携带明文 secret 或主机命令输出。 */
export async function recordMDeployHeartbeat(
  deps: MDeployDeps,
  agentId: string,
  heartbeat: MDeployAgentHeartbeatV01FromSchema
): Promise<Result<MDeployAgentRecord, MDeployError>> {
  if (agentId !== heartbeat.agentId) {
    return err({ code: 'deploy.agent_id_mismatch', message: 'agent route and heartbeat id differ' })
  }
  const agent = await deps.store.getAgent(agentId)
  if (!agent.ok) return agent
  if (!agent.value)
    return err({ code: 'deploy.agent_not_found', message: 'deployment agent not found' })
  const saved = await deps.store.upsertAgent({ ...agent.value, heartbeat })
  if (!saved.ok) return saved
  const event = await deps.events.publish('mdeploy.agent.heartbeat.v0', heartbeat)
  if (!event.ok) return event
  return saved
}

/** drift 是观察事实：记录并发出红acted evidence，不改动已运行的目标状态。 */
export async function recordMDeployDrift(
  deps: MDeployDeps,
  report: MDeployDriftReportV01FromSchema,
  correlationId: string
): Promise<Result<MDeployDriftReportV01FromSchema, MDeployError>> {
  const agent = await deps.store.getAgent(report.agentId)
  if (!agent.ok) return agent
  if (!agent.value)
    return err({ code: 'deploy.agent_not_found', message: 'deployment agent not found' })
  const stored = await deps.store.recordDrift(report)
  if (!stored.ok) return stored
  const audit = await deps.log.writeAudit({
    actor: 'operator',
    action: 'deploy.drift.record',
    resource: `deploy-agent:${report.agentId}`,
    policyDecisionId: 'system-observation',
    correlationId,
    result: 'observed'
  })
  if (!audit.ok) return audit
  const evidence = await persistMDeployEvidence(deps, {
    operationId: report.reportId,
    correlationId,
    auditId: audit.value.auditId,
    evidenceType: 'drift_report',
    digest: report.actualState.digest
  })
  if (!evidence.ok) return evidence
  const event = await deps.events.publish('mdeploy.drift.detected.v0', report)
  if (!event.ok) return event
  return stored
}

export function resultOrInternalFailure<T>(
  result: Result<T, MDeployError>,
  correlationId?: string
): T | MDeployRouteFailure {
  if (result.ok) return result.value
  return routeFailure(
    result.error.code.includes('not_found') ? 404 : 503,
    result.error,
    correlationId
  )
}

export { isMDeployRouteFailure, ok }
