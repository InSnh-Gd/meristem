import { Elysia, t } from 'elysia'
import type { ActorId, ApprovalActionResponse, ApprovalDetailResponse, ApprovalListResponse, ApprovalStatus, CreateApprovalResponse, Permission, PolicyApproval, PolicyApprovalVote } from '../../../../packages/contracts/src/index.ts'
import { extractBearerToken } from '../../../../packages/auth/src/index.ts'
import { createEventEnvelope } from '../../../../packages/events/src/index.ts'
import { withExtractedSpan } from '../../../../packages/telemetry/src/index.ts'
import { validateInternalRequest } from '../../../../packages/internal-http/src/index.ts'

import type { ApprovalDeps } from './ports.ts'
import { apiErrorSchema, approvalActionSchema, approvalListSchema, approvalSchema, approvalWithVotesSchema, createApprovalSchema } from './schemas.ts'

/**
 * 从 Bearer token 提取 actor，外部审批 API 统一使用 JWT 身份而非 internal token。
 */
async function requireExternalActor(deps: ApprovalDeps, headers: Record<string, string | undefined>): Promise<ActorId> {
  const token = extractBearerToken(headers.authorization)
  if (!token) throw Object.assign(new Error('Bearer token is required'), { status: 401, code: 'auth.missing_token' })
  const verified = await deps.auth.verify(token)
  if (!verified.ok) throw Object.assign(new Error(verified.message), { status: 401, code: verified.code })
  return verified.actor
}

/**
 * 外部审批 API 必须显式校验 M-Policy 权限，不能只依赖 JWT actor 身份。
 */
async function requireApprovalPermission(deps: ApprovalDeps, headers: Record<string, string | undefined>, permission: Permission): Promise<ActorId> {
  const actor = await requireExternalActor(deps, headers)
  const permissions = await deps.permissionsForActor(actor)
  if (!permissions.includes(permission)) {
    await deps.log.writeFull({ level: 'warn', source: 'm-policy', message: 'approval permission denied', payload: { actor, permission } })
    throw Object.assign(new Error(`missing permission: ${permission}`), { status: 403, code: 'approval.permission_denied' })
  }
  return actor
}

/**
 * evaluateQuorum 根据当前投票状态判断审批是否达到 quorum。
 * manual_review 只需一票 approve；multi_approval 需要两个不同 security-admin 的 approve。
 * 任何一票 reject 立即拒绝。
 */
function evaluateQuorum(approval: PolicyApproval, votes: PolicyApprovalVote[]): ApprovalStatus | null {
  const rejectVotes = votes.filter((v) => v.vote === 'reject')
  if (rejectVotes.length > 0) return 'rejected'

  const approveVotes = votes.filter((v) => v.vote === 'approve')
  if (approveVotes.length >= approval.quorumRequired) return 'approved'

  return null
}

/**
 * M-Policy 外部审批 REST API，Bearer auth + M-Policy 权限。
 * 审批状态转换和 resume 行为通过 onApproved 回调通知来源服务。
 */
export function createApprovalRoutes(deps: ApprovalDeps) {
  return new Elysia()
    .onError(({ error, set }) => {
      const maybe = error as Error & { status?: number; code?: string }
      if (maybe.status && maybe.code) {
        set.status = maybe.status
        return { error: { code: maybe.code, message: maybe.message } }
      }
      return undefined
    })
    // 内部审批创建入口只允许 M-Task 等内部服务调用；M-Policy 仍是 approval queue 的唯一写入者。
    .post(
      '/internal/v0/policy/approvals',
      async ({ body, headers, status }) => {
        const auth = validateInternalRequest(headers)
        if (!auth.ok) return status(401, { error: auth.error })

        return withExtractedSpan('m-policy', 'm-policy.approval.create', headers, async () => {
          const approval = await deps.approvals.createApproval(body)
          await deps.log.writeAudit({ actor: 'system', action: 'policy.approval.create', resource: `approval:${approval.id}`, decisionId: approval.policyDecisionId, result: 'pending', correlationId: approval.operationId })
          await deps.log.writeTimeline({ summary: `approval ${approval.id} created`, subject: 'policy.approval.created', correlationId: approval.operationId })
          await deps.events.publish('policy.approval.created.v0', createEventEnvelope({
            type: 'policy.approval.created',
            source: 'm-policy',
            correlationId: approval.operationId,
            payload: {
              approvalId: approval.id,
              policyDecisionId: approval.policyDecisionId,
              originService: approval.originService,
              operationId: approval.operationId,
              requestedBy: approval.requestedBy,
              requiredAction: approval.requiredAction,
              quorumRequired: approval.quorumRequired
            }
          }))
          return { approval } satisfies CreateApprovalResponse
        })
      },
      {
        body: createApprovalSchema,
        response: {
          200: t.Object({ approval: approvalSchema }),
          401: apiErrorSchema
        }
      }
    )
    // 审批列表读取不在 Audit Log 路径上，只返回当前状态。
    .get(
      '/api/v0/policy/approvals',
      async ({ headers, status }) => {
        const actor = await requireApprovalPermission(deps, headers, 'policy:approval-read')
        return withExtractedSpan('m-policy', 'm-policy.approval.list', headers, async () => {
          const approvals = await deps.approvals.listApprovals()
          return { approvals } satisfies ApprovalListResponse
        })
      },
      {
        response: {
          200: approvalListSchema,
          401: apiErrorSchema
        }
      }
    )
    // 审批详情读取不在 Audit Log 路径上。
    .get(
      '/api/v0/policy/approvals/:id',
      async ({ params, headers, status }) => {
        const actor = await requireApprovalPermission(deps, headers, 'policy:approval-read')
        return withExtractedSpan('m-policy', 'm-policy.approval.get', headers, async () => {
          const approval = await deps.approvals.getApproval(params.id)
          if (!approval) return status(404, { error: { code: 'approval.not_found', message: 'approval not found' } })
          const votes = await deps.approvals.getVotes(approval.id)
          return { ...approval, votes } satisfies ApprovalDetailResponse
        })
      },
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        response: {
          200: approvalWithVotesSchema,
          401: apiErrorSchema,
          404: apiErrorSchema
        }
      }
    )
    // 审批投票：security-admin 可以 approve。
    // 每个 actor 只能投一次票；原始操作者不能 approve 自己的操作。
    // 投票后检查 quorum，达到则触发 onApproved 回调。
    .post(
      '/api/v0/policy/approvals/:id/approve',
      async ({ params, body, headers, status }) => {
        const actor = await requireApprovalPermission(deps, headers, 'policy:approval-approve')
        return withExtractedSpan('m-policy', 'm-policy.approval.approve', headers, async () => {
          const approval = await deps.approvals.getApproval(params.id)
          if (!approval) return status(404, { error: { code: 'approval.not_found', message: 'approval not found' } })
          if (approval.status !== 'pending') return status(409, { error: { code: 'approval.not_pending', message: `approval is ${approval.status}` } })
          if (new Date(approval.expiresAt) < new Date()) {
            await deps.approvals.updateApprovalStatus(approval.id, 'expired')
            await deps.log.writeTimeline({ summary: `approval ${approval.id} expired`, subject: 'policy.approval.expired', correlationId: approval.operationId })
            return status(409, { error: { code: 'approval.expired', message: 'approval has expired' } })
          }
          if (approval.requestedBy === actor) {
            await deps.log.writeFull({ level: 'warn', source: 'm-policy', message: 'self-approval denied', payload: { approvalId: approval.id, actor } })
            return status(403, { error: { code: 'approval.self_vote_denied', message: 'original actor cannot approve their own operation' } })
          }
          try {
            const vote = await deps.approvals.addVote(approval.id, actor, 'approve', body.reason)
            const votes = await deps.approvals.getVotes(approval.id)
            const terminal = evaluateQuorum(approval, votes)
            if (terminal) {
              const now = new Date().toISOString()
              await deps.approvals.updateApprovalStatus(approval.id, terminal, now)
              await deps.log.writeAudit({ actor, action: 'policy.approval.approve', resource: `approval:${approval.id}`, decisionId: approval.policyDecisionId, result: terminal })
              await deps.log.writeTimeline({ summary: `approval ${approval.id} ${terminal}`, subject: `policy.approval.${terminal}`, correlationId: approval.operationId })
              await deps.events.publish(`policy.approval.${terminal}.v0`, createEventEnvelope({
                type: `policy.approval.${terminal}`,
                source: 'm-policy',
                correlationId: approval.operationId,
                payload: { approvalId: approval.id, policyDecisionId: approval.policyDecisionId, operationId: approval.operationId }
              }))
              const updatedApproval = await deps.approvals.getApproval(approval.id)
              if (updatedApproval && deps.onApproved && terminal === 'approved') {
                await deps.onApproved(updatedApproval)
              }
              return { approval: updatedApproval ?? approval, votes } satisfies ApprovalActionResponse
            }
            await deps.log.writeAudit({ actor, action: 'policy.approval.vote', resource: `approval:${approval.id}`, result: 'vote_recorded' })
            const updatedApproval = await deps.approvals.getApproval(approval.id)
            return { approval: updatedApproval ?? approval, votes } satisfies ApprovalActionResponse
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error)
            if (message.includes('duplicate')) {
              await deps.log.writeFull({ level: 'warn', source: 'm-policy', message: 'duplicate vote attempt', payload: { approvalId: approval.id, actor } })
              return status(409, { error: { code: 'approval.duplicate_vote', message: 'actor has already voted on this approval' } })
            }
            throw error
          }
        })
      },
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        body: t.Object({ reason: t.Optional(t.String()) }),
        response: {
          200: approvalActionSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema
        }
      }
    )
    // 拒绝投票：security-admin 可以 reject，一票即拒绝。
    .post(
      '/api/v0/policy/approvals/:id/reject',
      async ({ params, body, headers, status }) => {
        const actor = await requireApprovalPermission(deps, headers, 'policy:approval-reject')
        return withExtractedSpan('m-policy', 'm-policy.approval.reject', headers, async () => {
          const approval = await deps.approvals.getApproval(params.id)
          if (!approval) return status(404, { error: { code: 'approval.not_found', message: 'approval not found' } })
          if (approval.status !== 'pending') return status(409, { error: { code: 'approval.not_pending', message: `approval is ${approval.status}` } })
          if (new Date(approval.expiresAt) < new Date()) {
            await deps.approvals.updateApprovalStatus(approval.id, 'expired')
            return status(409, { error: { code: 'approval.expired', message: 'approval has expired' } })
          }
          if (approval.requestedBy === actor) {
            await deps.log.writeFull({ level: 'warn', source: 'm-policy', message: 'self-rejection denied', payload: { approvalId: approval.id, actor } })
            return status(403, { error: { code: 'approval.self_vote_denied', message: 'original actor cannot reject their own operation' } })
          }
          try {
            const vote = await deps.approvals.addVote(approval.id, actor, 'reject', body.reason)
            const now = new Date().toISOString()
            await deps.approvals.updateApprovalStatus(approval.id, 'rejected', now)
            await deps.log.writeAudit({ actor, action: 'policy.approval.reject', resource: `approval:${approval.id}`, decisionId: approval.policyDecisionId, result: 'rejected' })
            await deps.log.writeTimeline({ summary: `approval ${approval.id} rejected`, subject: 'policy.approval.rejected', correlationId: approval.operationId })
            await deps.events.publish('policy.approval.rejected.v0', createEventEnvelope({
              type: 'policy.approval.rejected',
              source: 'm-policy',
              correlationId: approval.operationId,
              payload: { approvalId: approval.id, policyDecisionId: approval.policyDecisionId, operationId: approval.operationId }
            }))
            const votes = await deps.approvals.getVotes(approval.id)
            const updatedApproval = await deps.approvals.getApproval(approval.id)
            return { approval: updatedApproval ?? approval, votes } satisfies ApprovalActionResponse
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error)
            if (message.includes('duplicate')) {
              await deps.log.writeFull({ level: 'warn', source: 'm-policy', message: 'duplicate vote attempt', payload: { approvalId: approval.id, actor } })
              return status(409, { error: { code: 'approval.duplicate_vote', message: 'actor has already voted on this approval' } })
            }
            throw error
          }
        })
      },
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        body: t.Object({ reason: t.Optional(t.String()) }),
        response: {
          200: approvalActionSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema
        }
      }
    )
}

export type ApprovalRoutes = ReturnType<typeof createApprovalRoutes>
