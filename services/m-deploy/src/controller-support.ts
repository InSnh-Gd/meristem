import { err, ok, type Result } from '../../../packages/common/src/result.ts'
import {
  deploymentPermission,
  type MDeployApprovalV01FromSchema,
  type MDeployDiffSummaryV01FromSchema,
  type MDeployGitSourceRefV01FromSchema,
  type MDeployProposalV01FromSchema,
  type MDeployReconcileResultV01FromSchema,
  type MDeployRollbackResultV01FromSchema
} from '../../../packages/contracts/src/index.ts'
import type {
  MDeployDeps,
  MDeployError,
  MDeployOperation,
  MDeployOperationKind,
  MDeployPublicContext
} from './deps.ts'
import { validateEnvelopeForAgent } from './controller-envelope-validation.ts'
import { prepareMDeployEvidence } from './evidence-support.ts'
import { createMDeployEventIntent, publicationStatusAfterDurableState } from './event-outbox.ts'

export type MDeployRouteFailure = {
  kind: 'failure'
  status: 400 | 401 | 403 | 404 | 409 | 503
  body: { error: { code: string; message: string; correlationId?: string } }
}

/** 将服务 Result 统一映射为由路由层最终返回的显式失败结果。 */
export function routeFailure(
  status: MDeployRouteFailure['status'],
  error: MDeployError,
  correlationId?: string
): MDeployRouteFailure {
  return {
    kind: 'failure',
    status,
    body: {
      error: {
        code: error.code,
        message: error.message,
        ...(correlationId ? { correlationId } : {})
      }
    }
  }
}

export function isMDeployRouteFailure(value: unknown): value is MDeployRouteFailure {
  return typeof value === 'object' && value !== null && Reflect.get(value, 'kind') === 'failure'
}

/** 公共入口只消费 Core 提供的认证结果，不在 M-Deploy 内重建身份生命周期。 */
export async function requireMDeployPublicContext(
  deps: MDeployDeps,
  headers: Record<string, string | undefined>
): Promise<MDeployPublicContext | MDeployRouteFailure> {
  const authorization = headers.authorization
  const correlationId = headers['x-correlation-id'] ?? crypto.randomUUID()
  if (!authorization) {
    return routeFailure(
      401,
      { code: 'auth.unauthorized', message: 'missing bearer token' },
      correlationId
    )
  }
  const verified = await deps.auth.verify(authorization)
  if (!verified.ok) return routeFailure(401, verified.error, correlationId)
  return { actor: verified.value.actor, correlationId }
}

/** M-Policy 结果是唯一授权来源；非 allow 结果不会进入 M-Deploy 状态写入。 */
export async function requireDeploymentAuthorization(
  deps: MDeployDeps,
  context: MDeployPublicContext,
  action: Parameters<MDeployDeps['policy']['authorize']>[0]['action'],
  resource: string
): Promise<{ decisionId: string } | MDeployRouteFailure> {
  const decision = await deps.policy.authorize({
    actor: context.actor,
    action,
    resource,
    correlationId: context.correlationId
  })
  if (!decision.ok) return routeFailure(503, decision.error, context.correlationId)
  if (decision.value.result === 'allow') return { decisionId: decision.value.decisionId }
  return routeFailure(
    decision.value.result === 'deny' ? 403 : 409,
    { code: 'policy.not_allowed', message: `policy result: ${decision.value.result}` },
    context.correlationId
  )
}

/** 提案写入前固定执行 M-Policy 和 Audit，Git 仍是内容而非本服务写入的事实源。 */
export async function createMDeployProposal(
  deps: MDeployDeps,
  context: MDeployPublicContext,
  input: {
    sourceRef: MDeployGitSourceRefV01FromSchema
    diffSummary: MDeployDiffSummaryV01FromSchema
  }
): Promise<Result<MDeployProposalV01FromSchema, MDeployError>> {
  const authorization = await requireDeploymentAuthorization(
    deps,
    context,
    deploymentPermission.desiredStatePropose,
    `git:${input.sourceRef.repositoryUrl}@${input.sourceRef.commit}`
  )
  if (isMDeployRouteFailure(authorization)) return err(authorization.body.error)
  const audit = await deps.log.writeAudit({
    actor: context.actor,
    action: 'deploy.propose',
    resource: `git:${input.sourceRef.repositoryUrl}@${input.sourceRef.commit}`,
    policyDecisionId: authorization.decisionId,
    correlationId: context.correlationId,
    result: 'allow'
  })
  if (!audit.ok) return audit

  const proposal: MDeployProposalV01FromSchema = {
    schemaVersion: 'mdeploy.proposal@0.1.0',
    proposalId: crypto.randomUUID(),
    sourceRef: input.sourceRef,
    diffSummary: input.diffSummary,
    actor: context.actor,
    policyDecisionId: authorization.decisionId,
    approvalStatus: 'pending',
    createdAt: deps.now(),
    correlationId: context.correlationId
  }
  const saved = await deps.store.createProposal(proposal)
  if (!saved.ok) return saved
  const event = await deps.events.publish('mdeploy.proposal.created.v0', saved.value)
  if (!event.ok) return event
  const timeline = await deps.log.writeTimeline({
    summary: `deployment proposal created: ${saved.value.proposalId}`,
    subject: 'mdeploy.proposal.created',
    correlationId: context.correlationId
  })
  if (!timeline.ok) {
    await deps.log.writeFull({
      level: 'warn',
      message: 'deployment proposal created but timeline publication failed',
      correlationId: context.correlationId,
      errorCode: timeline.error.code
    })
  }
  return saved
}

/** 审批状态由 M-Policy 回传；M-Deploy 只保存关联结果和对应证据链。 */
export async function recordMDeployApproval(
  deps: MDeployDeps,
  context: MDeployPublicContext,
  proposalId: string,
  result: 'approve' | 'reject'
): Promise<Result<MDeployApprovalV01FromSchema, MDeployError>> {
  const proposal = await deps.store.getProposal(proposalId)
  if (!proposal.ok) return proposal
  if (!proposal.value)
    return err({ code: 'deploy.proposal_not_found', message: 'proposal not found' })
  const authorization = await requireDeploymentAuthorization(
    deps,
    context,
    deploymentPermission.desiredStateApprove,
    `deploy-proposal:${proposalId}`
  )
  if (isMDeployRouteFailure(authorization)) return err(authorization.body.error)
  const recorded = await deps.policy.recordApproval({
    actor: context.actor,
    proposal: proposal.value,
    result,
    correlationId: context.correlationId
  })
  if (!recorded.ok) return recorded
  const audit = await deps.log.writeAudit({
    actor: context.actor,
    action: 'deploy.approve',
    resource: `deploy-proposal:${proposalId}`,
    policyDecisionId: recorded.value.approval.policyDecisionId,
    correlationId: context.correlationId,
    result
  })
  if (!audit.ok) return audit
  const saved = await deps.store.createApproval(recorded.value.approval)
  if (!saved.ok) return saved
  const updated = await deps.store.updateProposalStatus(proposalId, recorded.value.proposalStatus)
  if (!updated.ok || !updated.value) {
    return err(
      updated.ok
        ? { code: 'deploy.proposal_not_found', message: 'proposal not found' }
        : updated.error
    )
  }
  const event = await deps.events.publish('mdeploy.approval.recorded.v0', saved.value)
  if (!event.ok) return event
  const timeline = await deps.log.writeTimeline({
    summary: `deployment approval recorded: ${saved.value.approvalId}`,
    subject: 'mdeploy.approval.recorded',
    correlationId: context.correlationId
  })
  if (!timeline.ok) {
    await deps.log.writeFull({
      level: 'warn',
      message: 'deployment approval recorded but timeline publication failed',
      correlationId: context.correlationId,
      errorCode: timeline.error.code
    })
  }
  return saved
}

/** 只安排拉取操作；控制器不会在此路径向主机推送命令或建立 SSH 会话。 */
export async function scheduleMDeployOperation(
  deps: MDeployDeps,
  context: MDeployPublicContext,
  input: { proposalId: string; agentId: string; kind: MDeployOperationKind }
): Promise<Result<MDeployOperation, MDeployError>> {
  const proposal = await deps.store.getProposal(input.proposalId)
  if (!proposal.ok) return proposal
  if (!proposal.value)
    return err({ code: 'deploy.proposal_not_found', message: 'proposal not found' })
  const quorum =
    input.kind === 'apply'
      ? await deps.policy.proveProductionApplyQuorum({
          proposal: proposal.value,
          correlationId: context.correlationId
        })
      : null
  if (quorum && !quorum.ok) return quorum
  if (proposal.value.approvalStatus !== 'approved') {
    return err({ code: 'deploy.proposal_not_approved', message: 'proposal is not approved' })
  }
  const action =
    input.kind === 'apply'
      ? deploymentPermission.desiredStateApply
      : deploymentPermission.desiredStateRollback
  const authorization = await requireDeploymentAuthorization(
    deps,
    context,
    action,
    `deploy-proposal:${input.proposalId}`
  )
  if (isMDeployRouteFailure(authorization)) return err(authorization.body.error)
  const agent = await deps.store.getAgent(input.agentId)
  if (!agent.ok) return agent
  if (!agent.value)
    return err({ code: 'deploy.agent_not_found', message: 'deployment agent not found' })
  const envelope = await deps.git.fetchSignedEnvelope(proposal.value.sourceRef)
  if (!envelope.ok) return envelope
  const verified = await validateEnvelopeForAgent(deps, agent.value, envelope.value)
  const operationId = crypto.randomUUID()
  const audit = await deps.log.writeAudit({
    actor: context.actor,
    action: input.kind === 'apply' ? 'deploy.apply' : 'deploy.rollback',
    resource: `deploy-proposal:${input.proposalId}`,
    policyDecisionId: authorization.decisionId,
    ...(quorum?.ok ? { quorumProofId: quorum.value.proofId } : {}),
    correlationId: context.correlationId,
    result: verified.ok ? 'allow' : 'blocked'
  })
  if (!audit.ok) return audit
  if (!verified.ok) {
    await deps.log.writeFull({
      level: 'warn',
      message: 'controller rejected signed desired-state envelope',
      correlationId: context.correlationId,
      errorCode: verified.error.code
    })
    const blocked = await deps.store.admitOperation({
      operation: {
        operationId,
        kind: input.kind,
        proposalId: input.proposalId,
        agentId: input.agentId,
        envelope: envelope.value,
        desiredStateDigest: proposal.value.sourceRef.digest,
        actor: context.actor,
        policyDecisionId: authorization.decisionId,
        ...(quorum?.ok ? { quorumProofId: quorum.value.proofId } : {}),
        auditId: audit.value.auditId,
        correlationId: context.correlationId,
        status: 'blocked',
        publicationStatus: 'published',
        createdAt: deps.now(),
        completedAt: deps.now()
      },
      evidence: [],
      eventIntents: []
    })
    if (!blocked.ok) return blocked
    return verified
  }
  const signatureEvidence = await prepareMDeployEvidence(deps, {
    operationId,
    correlationId: context.correlationId,
    auditId: audit.value.auditId,
    evidenceType: 'signature_verification',
    digest: verified.value.payload.source.digest
  })
  if (!signatureEvidence.ok) return signatureEvidence
  const operation: MDeployOperation = {
    operationId,
    kind: input.kind,
    proposalId: input.proposalId,
    agentId: input.agentId,
    envelope: verified.value,
    desiredStateDigest: verified.value.payload.source.digest,
    actor: context.actor,
    policyDecisionId: authorization.decisionId,
    ...(quorum?.ok ? { quorumProofId: quorum.value.proofId } : {}),
    auditId: audit.value.auditId,
    correlationId: context.correlationId,
    status: 'queued',
    publicationStatus: 'pending',
    createdAt: deps.now()
  }
  const startedPayload = {
    schemaVersion: 'mdeploy.reconcile-result@0.1.0',
    operationId,
    agentId: input.agentId,
    desiredStateDigest: operation.desiredStateDigest,
    applyStatus: 'queued',
    publicationStatus: 'published',
    evidenceRefs: []
  } satisfies MDeployReconcileResultV01FromSchema
  const saved = await deps.store.admitOperation({
    operation,
    evidence: [signatureEvidence.value],
    eventIntents: [
      createMDeployEventIntent(
        operationId,
        'mdeploy.evidence.emitted.v0',
        signatureEvidence.value,
        deps.now()
      ),
      createMDeployEventIntent(operationId, 'mdeploy.apply.started.v0', startedPayload, deps.now())
    ]
  })
  if (!saved.ok) return saved
  const publicationStatus = await publicationStatusAfterDurableState(
    deps,
    operationId,
    context.correlationId
  )
  const timeline = await deps.log.writeTimeline({
    summary: `deployment ${input.kind} queued: ${operationId}`,
    subject: `mdeploy.${input.kind}.started`,
    correlationId: context.correlationId
  })
  if (!timeline.ok) {
    await deps.log.writeFull({
      level: 'warn',
      message: `deployment ${input.kind} queued but timeline publication failed`,
      correlationId: context.correlationId,
      errorCode: timeline.error.code
    })
  }
  return ok({ ...saved.value, publicationStatus })
}

/** rollback 使用独立 M-Policy 决策和 Audit 链；它不会复用原 apply 的授权。 */
export async function scheduleMDeployRollback(
  deps: MDeployDeps,
  context: MDeployPublicContext,
  input: { agentId: string; targetDigest: MDeployOperation['desiredStateDigest'] }
): Promise<Result<MDeployOperation, MDeployError>> {
  const authorization = await requireDeploymentAuthorization(
    deps,
    context,
    deploymentPermission.desiredStateRollback,
    `deploy-digest:${input.targetDigest.algorithm}:${input.targetDigest.value}`
  )
  if (isMDeployRouteFailure(authorization)) return err(authorization.body.error)
  const agent = await deps.store.getAgent(input.agentId)
  if (!agent.ok) return agent
  if (!agent.value)
    return err({ code: 'deploy.agent_not_found', message: 'deployment agent not found' })
  const target = await deps.store.findVerifiedEnvelope(input.targetDigest)
  if (!target.ok) return target
  if (!target.value) {
    return err({
      code: 'deploy.rollback_pointer_not_found',
      message: 'verified rollback pointer not found'
    })
  }
  const verified = await validateEnvelopeForAgent(deps, agent.value, target.value)
  const current = await deps.store.getLastSuccessful(input.agentId)
  if (!current.ok) return current
  if (!current.value) {
    return err({
      code: 'deploy.rollback_current_state_not_found',
      message: 'no verified state is available to roll back'
    })
  }
  const audit = await deps.log.writeAudit({
    actor: context.actor,
    action: 'deploy.rollback',
    resource: `deploy-agent:${input.agentId}`,
    policyDecisionId: authorization.decisionId,
    correlationId: context.correlationId,
    result: verified.ok ? 'allow' : 'blocked'
  })
  if (!audit.ok) return audit
  if (!verified.ok) {
    await deps.log.writeFull({
      level: 'warn',
      message: 'controller rejected signed rollback envelope',
      correlationId: context.correlationId,
      errorCode: verified.error.code
    })
    return verified
  }
  const operationId = crypto.randomUUID()
  const signatureEvidence = await prepareMDeployEvidence(deps, {
    operationId,
    correlationId: context.correlationId,
    auditId: audit.value.auditId,
    evidenceType: 'signature_verification',
    digest: verified.value.payload.source.digest
  })
  if (!signatureEvidence.ok) return signatureEvidence
  const operation: MDeployOperation = {
    operationId,
    kind: 'rollback',
    agentId: input.agentId,
    envelope: verified.value,
    desiredStateDigest: verified.value.payload.source.digest,
    previousDigest: current.value.payload.source.digest,
    actor: context.actor,
    policyDecisionId: authorization.decisionId,
    auditId: audit.value.auditId,
    correlationId: context.correlationId,
    status: 'queued',
    publicationStatus: 'pending',
    createdAt: deps.now()
  }
  const startedPayload: MDeployRollbackResultV01FromSchema = {
    schemaVersion: 'mdeploy.rollback-result@0.1.0',
    operationId,
    previousDigest: current.value.payload.source.digest,
    restoredDigest: operation.desiredStateDigest,
    status: 'running',
    publicationStatus: 'pending',
    evidenceRefs: []
  }
  const saved = await deps.store.admitOperation({
    operation,
    evidence: [signatureEvidence.value],
    eventIntents: [
      createMDeployEventIntent(
        operationId,
        'mdeploy.evidence.emitted.v0',
        signatureEvidence.value,
        deps.now()
      ),
      createMDeployEventIntent(
        operationId,
        'mdeploy.rollback.started.v0',
        startedPayload,
        deps.now()
      )
    ]
  })
  if (!saved.ok) return saved
  const publicationStatus = await publicationStatusAfterDurableState(
    deps,
    operationId,
    context.correlationId
  )
  const timeline = await deps.log.writeTimeline({
    summary: `deployment rollback queued: ${operationId}`,
    subject: 'mdeploy.rollback.started',
    correlationId: context.correlationId
  })
  if (!timeline.ok) {
    await deps.log.writeFull({
      level: 'warn',
      message: 'deployment rollback queued but timeline publication failed',
      correlationId: context.correlationId,
      errorCode: timeline.error.code
    })
  }
  return ok({ ...saved.value, publicationStatus })
}
