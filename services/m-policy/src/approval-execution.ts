import type {
  ActorId,
  ApprovalActionResponse,
  ApprovalDetailResponse,
  ApprovalListResponse,
  ApprovalStatus,
  PolicyApproval
} from '../../../packages/contracts/src/index.ts'
import { createEventEnvelope } from '../../../packages/events/src/index.ts'
import { evaluateQuorum } from './approval-decisions.ts'
import { isApprovalExpired, isDuplicateVoteError, withUpdatedStatus } from './approval-helpers.ts'
import type { ApprovalDeps } from './approval-schemas.ts'

type ApprovalErrorCode =
  | 'approval.duplicate_vote'
  | 'approval.expired'
  | 'approval.not_found'
  | 'approval.not_pending'
  | 'approval.self_vote_denied'

export type ApprovalRouteFailure = {
  routeError: true
  status: 403 | 404 | 409
  body: {
    error: {
      code: ApprovalErrorCode
      message: string
    }
  }
}

export function isApprovalRouteFailure(value: unknown): value is ApprovalRouteFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    'routeError' in value &&
    value.routeError === true
  )
}

function approvalEventSubject(status: ApprovalStatus | 'created'): string {
  return `policy.approval.${status}.v0`
}

function approvalFailure(
  status: ApprovalRouteFailure['status'],
  code: ApprovalErrorCode,
  message: string
): ApprovalRouteFailure {
  return {
    routeError: true,
    status,
    body: { error: { code, message } }
  }
}

/**
 * publishApprovalEvent 负责统一审批事件主题和 payload，保证创建/终态顺序稳定。
 */
export async function publishApprovalEvent(
  deps: ApprovalDeps,
  approval: PolicyApproval,
  status: ApprovalStatus | 'created'
): Promise<void> {
  await deps.events.publish(
    approvalEventSubject(status),
    createEventEnvelope({
      type: `policy.approval.${status}`,
      source: 'm-policy',
      subject: approval.id,
      correlationId: approval.operationId,
      payload: {
        approvalId: approval.id,
        policyDecisionId: approval.policyDecisionId,
        originService: approval.originService,
        operationId: approval.operationId,
        requestedBy: approval.requestedBy,
        requiredAction: approval.requiredAction,
        status: approval.status
      }
    })
  )
}

/**
 * createApprovalRecord 复用外部/内部审批创建路径，保持审计、timeline 与事件顺序一致。
 */
export async function createApprovalRecord(
  deps: ApprovalDeps,
  input: Parameters<ApprovalDeps['approvals']['createApproval']>[0],
  actor: ActorId | 'system'
): Promise<{ approval: PolicyApproval }> {
  const approval = await deps.approvals.createApproval(input)
  await deps.log.writeAudit({
    actor,
    action: 'policy.approval.create',
    resource: `approval:${approval.id}`,
    decisionId: approval.policyDecisionId,
    result: 'pending',
    correlationId: approval.operationId
  })
  await deps.log.writeTimeline({
    summary: `approval ${approval.id} created`,
    subject: 'policy.approval.created',
    correlationId: approval.operationId
  })
  await publishApprovalEvent(deps, approval, 'created')
  return { approval }
}

/**
 * expireApproval 将 pending approval 推进到 expired，并补齐审计与事件事实。
 */
export async function expireApproval(
  deps: ApprovalDeps,
  approval: PolicyApproval
): Promise<PolicyApproval> {
  const now = new Date().toISOString()
  const expired = await deps.approvals.updateApprovalStatus(approval.id, 'expired', now)
  const finalApproval = expired ?? withUpdatedStatus(approval, 'expired', now)
  await deps.log.writeAudit({
    actor: 'system',
    action: 'policy.approval.expire',
    resource: `approval:${approval.id}`,
    decisionId: approval.policyDecisionId,
    result: 'expired',
    correlationId: approval.operationId
  })
  await deps.log.writeTimeline({
    summary: `approval ${approval.id} expired`,
    subject: 'policy.approval.expired',
    correlationId: approval.operationId
  })
  await publishApprovalEvent(deps, finalApproval, 'expired')
  return finalApproval
}

/**
 * expireDueApprovals 在读取路径前清理已过期审批，但不会让单条失败阻断整个列表查询。
 */
export async function expireDueApprovals(deps: ApprovalDeps): Promise<void> {
  const pending = await deps.approvals.listApprovals('pending')
  const now = Date.now()
  for (const approval of pending) {
    if (new Date(approval.expiresAt).getTime() < now) {
      try {
        await expireApproval(deps, approval)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        await deps.log.writeFull({
          level: 'error',
          source: 'm-policy',
          message: `expireApproval failed for ${approval.id}: ${message}`,
          correlationId: approval.operationId
        })
      }
    }
  }
}

/**
 * listApprovalsForActor 保持列表接口为只读视图，但会先补偿过期状态。
 */
export async function listApprovalsForActor(deps: ApprovalDeps): Promise<ApprovalListResponse> {
  await expireDueApprovals(deps)
  const approvals = await deps.approvals.listApprovals()
  return { approvals }
}

/**
 * getApprovalDetailForActor 返回审批及投票详情，不存在时返回显式 404 结果。
 */
export async function getApprovalDetailForActor(
  deps: ApprovalDeps,
  id: string
): Promise<ApprovalDetailResponse | null> {
  await expireDueApprovals(deps)
  const approval = await deps.approvals.getApproval(id)
  if (!approval) return null
  const votes = await deps.approvals.getVotes(approval.id)
  return { ...approval, votes }
}

async function loadPendingApproval(
  deps: ApprovalDeps,
  id: string
): Promise<PolicyApproval | ApprovalRouteFailure> {
  const approval = await deps.approvals.getApproval(id)
  if (!approval) return approvalFailure(404, 'approval.not_found', 'approval not found')
  if (approval.status !== 'pending') {
    return approvalFailure(409, 'approval.not_pending', `approval is ${approval.status}`)
  }
  if (isApprovalExpired(approval)) {
    await expireApproval(deps, approval)
    return approvalFailure(409, 'approval.expired', 'approval has expired')
  }
  return approval
}

async function denySelfVote(
  deps: ApprovalDeps,
  approval: PolicyApproval,
  actor: ActorId,
  action: 'approve' | 'reject'
): Promise<ApprovalRouteFailure> {
  await deps.log.writeFull({
    level: 'warn',
    source: 'm-policy',
    message: action === 'approve' ? 'self-approval denied' : 'self-rejection denied',
    payload: { approvalId: approval.id, actor }
  })
  return approvalFailure(
    403,
    'approval.self_vote_denied',
    `original actor cannot ${action} their own operation`
  )
}

async function logDuplicateVote(
  deps: ApprovalDeps,
  approval: PolicyApproval,
  actor: ActorId
): Promise<ApprovalRouteFailure> {
  await deps.log.writeFull({
    level: 'warn',
    source: 'm-policy',
    message: 'duplicate vote attempt',
    payload: { approvalId: approval.id, actor }
  })
  return approvalFailure(409, 'approval.duplicate_vote', 'actor has already voted on this approval')
}

/**
 * approveApprovalForActor 处理 approve 投票、quorum 判定与来源服务恢复回调。
 */
export async function approveApprovalForActor(
  deps: ApprovalDeps,
  input: { id: string; actor: ActorId; reason?: string }
): Promise<ApprovalActionResponse | ApprovalRouteFailure> {
  const approval = await loadPendingApproval(deps, input.id)
  if (isApprovalRouteFailure(approval)) return approval
  if (approval.requestedBy === input.actor) {
    return denySelfVote(deps, approval, input.actor, 'approve')
  }

  try {
    await deps.approvals.addVote(approval.id, input.actor, 'approve', input.reason)
    const votes = await deps.approvals.getVotes(approval.id)
    const terminal = evaluateQuorum(approval, votes)
    if (!terminal) {
      await deps.log.writeAudit({
        actor: input.actor,
        action: 'policy.approval.vote',
        resource: `approval:${approval.id}`,
        result: 'vote_recorded'
      })
      const updatedApproval = await deps.approvals.getApproval(approval.id)
      return {
        approval: updatedApproval ?? approval,
        votes
      }
    }

    const now = new Date().toISOString()
    await deps.approvals.updateApprovalStatus(approval.id, terminal, now)
    await deps.log.writeAudit({
      actor: input.actor,
      action: 'policy.approval.approve',
      resource: `approval:${approval.id}`,
      decisionId: approval.policyDecisionId,
      result: terminal
    })
    await deps.log.writeTimeline({
      summary: `approval ${approval.id} ${terminal}`,
      subject: `policy.approval.${terminal}`,
      correlationId: approval.operationId
    })
    const updatedApproval = await deps.approvals.getApproval(approval.id)
    if (updatedApproval) await publishApprovalEvent(deps, updatedApproval, terminal)
    if (updatedApproval && deps.onApproved && terminal === 'approved') {
      await deps.onApproved(updatedApproval)
    }
    return {
      approval: updatedApproval ?? approval,
      votes
    }
  } catch (error: unknown) {
    if (isDuplicateVoteError(error)) {
      return logDuplicateVote(deps, approval, input.actor)
    }
    throw error
  }
}

/**
 * rejectApprovalForActor 处理 reject 投票、终态写入与来源服务 reject 回调。
 */
export async function rejectApprovalForActor(
  deps: ApprovalDeps,
  input: { id: string; actor: ActorId; reason?: string }
): Promise<ApprovalActionResponse | ApprovalRouteFailure> {
  const approval = await loadPendingApproval(deps, input.id)
  if (isApprovalRouteFailure(approval)) return approval
  if (approval.requestedBy === input.actor) {
    return denySelfVote(deps, approval, input.actor, 'reject')
  }

  try {
    await deps.approvals.addVote(approval.id, input.actor, 'reject', input.reason)
    const now = new Date().toISOString()
    await deps.approvals.updateApprovalStatus(approval.id, 'rejected', now)
    await deps.log.writeAudit({
      actor: input.actor,
      action: 'policy.approval.reject',
      resource: `approval:${approval.id}`,
      decisionId: approval.policyDecisionId,
      result: 'rejected'
    })
    await deps.log.writeTimeline({
      summary: `approval ${approval.id} rejected`,
      subject: 'policy.approval.rejected',
      correlationId: approval.operationId
    })
    const votes = await deps.approvals.getVotes(approval.id)
    const updatedApproval = await deps.approvals.getApproval(approval.id)
    if (updatedApproval) await publishApprovalEvent(deps, updatedApproval, 'rejected')
    if (updatedApproval && deps.onRejected) await deps.onRejected(updatedApproval)
    return {
      approval: updatedApproval ?? approval,
      votes
    }
  } catch (error: unknown) {
    if (isDuplicateVoteError(error)) {
      return logDuplicateVote(deps, approval, input.actor)
    }
    throw error
  }
}
