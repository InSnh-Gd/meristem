import { Effect } from 'effect'
import { err, ok, type Result } from '../../../packages/common/src/result.ts'
import {
  type MDeployReconcileResultV01FromSchema,
  type MDeployRollbackResultV01FromSchema,
  type MDeploySignedEnvelopeV01FromSchema,
  validateMDeploySignedEnvelopeForApply
} from '../../../packages/contracts/src/index.ts'
import { prepareMDeployEvidence } from './evidence-support.ts'
import type { MDeployAgentRecord, MDeployDeps, MDeployError, MDeployOperation } from './deps.ts'
import { mDeployEnvelopeVerificationBytes } from './envelope-verification.ts'
import {
  createMDeployEventIntent,
  dispatchPendingMDeployEvents,
  publicationStatusAfterDurableState
} from './event-outbox.ts'

/** 复杂的拉取协调以 Effect 组装 I/O 边界，路由端仍接收显式 Result。 */
const pullReconcileEffect = Effect.fn('MDeployAgent.pullReconcile')(function* (
  deps: MDeployDeps,
  agentId: string
) {
  return yield* Effect.promise(() => reconcileQueuedOperation(deps, agentId))
})

/** agent 从控制器拉取已安排工作；断连时不创建新状态，仅返回已有 last-known 报告。 */
export async function reconcileMDeployAgent(
  deps: MDeployDeps,
  agentId: string
): Promise<
  Result<MDeployReconcileResultV01FromSchema | MDeployRollbackResultV01FromSchema, MDeployError>
> {
  return Effect.runPromise(pullReconcileEffect(deps, agentId))
}

async function reconcileQueuedOperation(
  deps: MDeployDeps,
  agentId: string
): Promise<
  Result<MDeployReconcileResultV01FromSchema | MDeployRollbackResultV01FromSchema, MDeployError>
> {
  const recovered = await dispatchPendingMDeployEvents(deps)
  if (!recovered.ok) return recovered
  if (!(await deps.controller.isAvailable())) {
    return err({
      code: 'deploy.controller_unavailable',
      message: 'controller is unavailable; no new desired state was applied'
    })
  }
  const agent = await deps.store.getAgent(agentId)
  if (!agent.ok) return agent
  if (!agent.value)
    return err({ code: 'deploy.agent_not_found', message: 'deployment agent not found' })
  const queued = await deps.store.nextQueuedOperation(agentId)
  if (!queued.ok) return queued
  if (!queued.value)
    return err({ code: 'deploy.operation_not_found', message: 'no queued operation' })

  const selectedDriver = agent.value.enrollment.capabilities[0]?.runtimeDriver
  if (!selectedDriver) {
    const blocked = await blockAndAuditAgentRejection(deps, queued.value, 'capability')
    if (!blocked.ok) return blocked
    return err({
      code: 'deploy.agent_runtime_unsupported',
      message: 'agent has no selected runtime driver capability'
    })
  }
  const validated = validateMDeploySignedEnvelopeForApply(queued.value.envelope, {
    now: deps.now(),
    expectedRuntimeDriver: selectedDriver,
    snapshotTtlMs: deps.snapshotTtlMs
  })
  if (!validated.ok) {
    const blocked = await blockAndAuditAgentRejection(deps, queued.value, 'verification')
    if (!blocked.ok) return blocked
    return err({
      code: validated.error.code,
      message: validated.error.message,
      ...(validated.error.detail === undefined ? {} : { detail: validated.error.detail })
    })
  }
  const trusted = await deps.envelopeVerifier.verify({
    signedBytes: mDeployEnvelopeVerificationBytes(
      validated.value,
      agent.value.enrollment.controllerTrust
    ),
    signature: validated.value.signature,
    signer: validated.value.signer,
    controllerTrust: agent.value.enrollment.controllerTrust
  })
  if (!trusted.ok) {
    const blocked = await blockAndAuditAgentRejection(deps, queued.value, 'verification')
    if (!blocked.ok) return blocked
    return trusted
  }
  if (!supportsRuntime(agent.value, validated.value.payload.runtime.driver)) {
    const blocked = await blockAndAuditAgentRejection(deps, queued.value, 'capability')
    if (!blocked.ok) return blocked
    return err({
      code: 'deploy.agent_runtime_unsupported',
      message: 'agent does not support the desired-state runtime driver'
    })
  }
  const resolved = await resolveSecretRefs(deps, validated.value)
  if (!resolved.ok) {
    const blocked = await blockAndAuditAgentRejection(deps, queued.value, 'secret')
    if (!blocked.ok) return blocked
    return resolved
  }
  const running = await deps.store.transitionOperation(queued.value.operationId, 'running')
  if (!running.ok) return running
  if (!running.value)
    return err({ code: 'deploy.operation_not_found', message: 'operation not found' })

  const infrastructure = await inspectInfrastructure(
    deps,
    agent.value,
    running.value,
    validated.value
  )
  if (!infrastructure.ok) {
    await deps.store.transitionOperation(running.value.operationId, 'failed', deps.now())
    await deps.log.writeFull({
      level: 'error',
      message: 'agent infrastructure inspection failed',
      correlationId: running.value.correlationId,
      errorCode: infrastructure.error.code
    })
    return infrastructure
  }
  const runtime = await runLocalRuntime(deps, agent.value, running.value, validated.value)
  if (!runtime.ok) {
    await deps.store.transitionOperation(running.value.operationId, 'failed', deps.now())
    await deps.log.writeFull({
      level: 'error',
      message: 'agent runtime reconciliation failed',
      correlationId: running.value.correlationId,
      errorCode: runtime.error.code
    })
    return runtime
  }
  const evidence = await prepareMDeployEvidence(deps, {
    operationId: running.value.operationId,
    correlationId: running.value.correlationId,
    auditId: running.value.auditId,
    evidenceType: running.value.kind === 'apply' ? 'runtime_apply' : 'rollback',
    digest: running.value.desiredStateDigest
  })
  if (!evidence.ok) {
    await deps.store.transitionOperation(running.value.operationId, 'failed', deps.now())
    return evidence
  }
  const completedAt = deps.now()
  const evidenceRefs = [evidence.value.storageRef]
  if (running.value.kind === 'rollback') {
    const rollback: MDeployRollbackResultV01FromSchema = {
      schemaVersion: 'mdeploy.rollback-result@0.1.0',
      operationId: running.value.operationId,
      previousDigest: running.value.previousDigest ?? running.value.desiredStateDigest,
      restoredDigest: running.value.desiredStateDigest,
      status: 'succeeded',
      publicationStatus: 'published',
      evidenceRefs,
      completedAt
    }
    const completed = await deps.store.completeOperation({
      operationId: running.value.operationId,
      completedAt,
      evidence: [evidence.value],
      eventIntents: [
        createMDeployEventIntent(
          running.value.operationId,
          'mdeploy.evidence.emitted.v0',
          evidence.value,
          completedAt
        ),
        createMDeployEventIntent(
          running.value.operationId,
          'mdeploy.rollback.succeeded.v0',
          rollback,
          completedAt
        )
      ],
      lastSuccessfulEnvelope: validated.value
    })
    if (!completed.ok) return completed
    if (!completed.value)
      return err({ code: 'deploy.operation_not_found', message: 'operation not found' })
    const publicationStatus = await publicationStatusAfterDurableState(
      deps,
      running.value.operationId,
      running.value.correlationId
    )
    const timeline = await deps.log.writeTimeline({
      summary: `agent rolled back deployment ${running.value.operationId}`,
      subject: 'mdeploy.rollback.succeeded',
      correlationId: running.value.correlationId
    })
    if (!timeline.ok) {
      await deps.log.writeFull({
        level: 'warn',
        message: 'rollback succeeded but timeline publication failed',
        correlationId: running.value.correlationId,
        errorCode: timeline.error.code
      })
    }
    return ok({ ...rollback, publicationStatus })
  }
  const reconcile: MDeployReconcileResultV01FromSchema = {
    schemaVersion: 'mdeploy.reconcile-result@0.1.0',
    operationId: running.value.operationId,
    agentId,
    desiredStateDigest: running.value.desiredStateDigest,
    applyStatus: 'succeeded',
    publicationStatus: 'published',
    evidenceRefs,
    completedAt
  }
  const completed = await deps.store.completeOperation({
    operationId: running.value.operationId,
    completedAt,
    evidence: [evidence.value],
    eventIntents: [
      createMDeployEventIntent(
        running.value.operationId,
        'mdeploy.evidence.emitted.v0',
        evidence.value,
        completedAt
      ),
      createMDeployEventIntent(
        running.value.operationId,
        'mdeploy.apply.succeeded.v0',
        reconcile,
        completedAt
      )
    ],
    lastSuccessfulEnvelope: validated.value
  })
  if (!completed.ok) return completed
  if (!completed.value)
    return err({ code: 'deploy.operation_not_found', message: 'operation not found' })
  const publicationStatus = await publicationStatusAfterDurableState(
    deps,
    running.value.operationId,
    running.value.correlationId
  )
  const timeline = await deps.log.writeTimeline({
    summary: `agent reconciled deployment ${running.value.operationId}`,
    subject: 'mdeploy.apply.succeeded',
    correlationId: running.value.correlationId
  })
  if (!timeline.ok) {
    await deps.log.writeFull({
      level: 'warn',
      message: 'deployment succeeded but timeline publication failed',
      correlationId: running.value.correlationId,
      errorCode: timeline.error.code
    })
  }
  return ok({ ...reconcile, publicationStatus })
}

async function blockAndAuditAgentRejection(
  deps: MDeployDeps,
  operation: MDeployOperation,
  reason: 'verification' | 'capability' | 'secret'
): Promise<Result<void, MDeployError>> {
  const blocked = await deps.store.transitionOperation(operation.operationId, 'blocked', deps.now())
  if (!blocked.ok) return blocked
  if (!blocked.value) {
    return err({ code: 'deploy.operation_not_found', message: 'operation not found' })
  }
  const audit = await deps.log.writeAudit({
    actor: operation.actor,
    action: `deploy.agent.${reason}.blocked`,
    resource: `deploy-operation:${operation.operationId}`,
    policyDecisionId: operation.policyDecisionId,
    correlationId: operation.correlationId,
    result: 'blocked'
  })
  if (!audit.ok) {
    // fail-closed 契约（见 mdeploy-security-repair failure-mode）：audit 写失败时上抛 audit 错误，
    // 不把可归因拒绝降级为静默成功；同时用 warn 全量日志保留原始拒绝 reason，
    // 避免安全信号只存在于调用方收到的单个错误码里。
    await deps.log.writeFull({
      level: 'warn',
      message: `agent ${reason} rejection durably blocked but audit write failed`,
      correlationId: operation.correlationId,
      errorCode: audit.error.code
    })
    return audit
  }
  return ok(undefined)
}

function supportsRuntime(agent: MDeployAgentRecord, runtimeDriver: 'podman' | 'docker'): boolean {
  return agent.enrollment.capabilities.some(
    capability => capability.runtimeDriver === runtimeDriver
  )
}

async function resolveSecretRefs(
  deps: MDeployDeps,
  envelope: MDeploySignedEnvelopeV01FromSchema
): Promise<Result<void, MDeployError>> {
  for (const service of envelope.payload.services) {
    for (const secretRef of service.secretRefs) {
      const resolved = await deps.secretProvider.resolve(secretRef)
      if (!resolved.ok) return resolved
    }
  }
  return ok(undefined)
}

async function runLocalRuntime(
  deps: MDeployDeps,
  agent: MDeployAgentRecord,
  operation: MDeployOperation,
  envelope: MDeploySignedEnvelopeV01FromSchema
): Promise<Result<void, MDeployError>> {
  const input = { agent, envelope, correlationId: operation.correlationId }
  return operation.kind === 'apply' ? deps.runtime.apply(input) : deps.runtime.rollback(input)
}

async function inspectInfrastructure(
  deps: MDeployDeps,
  agent: MDeployAgentRecord,
  operation: MDeployOperation,
  envelope: MDeploySignedEnvelopeV01FromSchema
): Promise<Result<void, MDeployError>> {
  if (!deps.infrastructure) return ok(undefined)
  const inspected = await deps.infrastructure.inspect({
    agent,
    envelope,
    operationId: operation.operationId,
    correlationId: operation.correlationId
  })
  if (!inspected.ok) return inspected
  const recorded = await deps.store.recordDrift(inspected.value.drift)
  if (!recorded.ok) return recorded
  const heartbeat = {
    schemaVersion: 'mdeploy.agent-heartbeat@0.1.0' as const,
    agentId: agent.enrollment.agentId,
    timestamp: inspected.value.health.checkedAt,
    ...(inspected.value.health.appliedImageDigest
      ? { lastAppliedDigest: inspected.value.health.appliedImageDigest }
      : {}),
    driftStatus: inspected.value.drift.resolvedAt ? ('none' as const) : ('confirmed' as const),
    health: inspected.value.health.health,
    connectionStatus: 'connected' as const,
    runtimeDrivers: agent.enrollment.capabilities.map(capability => capability.runtimeDriver),
    correlationId: operation.correlationId
  }
  const updated = await deps.store.upsertAgent({ enrollment: agent.enrollment, heartbeat })
  return updated.ok ? ok(undefined) : updated
}
