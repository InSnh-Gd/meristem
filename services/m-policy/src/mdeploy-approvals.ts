import { Elysia, t } from 'elysia'
import type { ActorId, PolicyApproval } from '../../../packages/contracts/src/index.ts'
import { actorIds, mDeployApproverActorIds } from '../../../packages/contracts/src/index.ts'
import { validateInternalRequest } from '../../../packages/internal-http/src/index.ts'
import { approveApprovalForActor, rejectApprovalForActor } from './approval-execution.ts'
import type { ApprovalDeps } from './approval-schemas.ts'

type MDeployApprovalFailure = {
  status: 403 | 404 | 409 | 503
  error: { code: string; message: string }
}

async function findMDeployApproval(
  deps: ApprovalDeps,
  proposalId: string
): Promise<PolicyApproval | null> {
  const approvals = await deps.approvals.listApprovals()
  return (
    approvals.find(
      approval => approval.originService === 'm-deploy' && approval.operationId === proposalId
    ) ?? null
  )
}

async function ensureMDeployApproval(
  deps: ApprovalDeps,
  input: {
    proposalId: string
    proposalActor: ActorId
    policyDecisionId: string
    expiresAt: string
  }
): Promise<PolicyApproval> {
  const existing = await findMDeployApproval(deps, input.proposalId)
  if (existing) return existing
  return deps.approvals.createApproval({
    policyDecisionId: input.policyDecisionId,
    originService: 'm-deploy',
    operationId: input.proposalId,
    requestedBy: input.proposalActor,
    requiredAction: 'multi_approval',
    quorumRequired: 2,
    expiresAt: input.expiresAt
  })
}

async function recordMDeployVote(
  deps: ApprovalDeps,
  input: {
    proposalId: string
    proposalActor: ActorId
    policyDecisionId: string
    actor: ActorId
    result: 'approve' | 'reject'
    expiresAt: string
  }
): Promise<
  | {
      approvalId: string
      proposalStatus: 'pending' | 'approved' | 'rejected'
      policyDecisionId: string
      timestamp: string
    }
  | MDeployApprovalFailure
> {
  const permission =
    input.result === 'approve' ? 'policy:approval-approve' : 'policy:approval-reject'
  if (
    !mDeployApproverActorIds.includes(input.actor) ||
    !(await deps.authorize(input.actor, permission, `deploy-proposal:${input.proposalId}`))
  ) {
    return {
      status: 403,
      error: { code: 'policy.approver_ineligible', message: 'actor is not an eligible approver' }
    }
  }
  const approval = await ensureMDeployApproval(deps, input)
  const outcome =
    input.result === 'approve'
      ? await approveApprovalForActor(deps, { id: approval.id, actor: input.actor })
      : await rejectApprovalForActor(deps, { id: approval.id, actor: input.actor })
  if ('routeError' in outcome) {
    return { status: outcome.status, error: outcome.body.error }
  }
  const latest = outcome.approval
  return {
    approvalId: outcome.votes.at(-1)?.id ?? latest.id,
    proposalStatus:
      latest.status === 'approved' || latest.status === 'rejected' ? latest.status : 'pending',
    policyDecisionId: latest.policyDecisionId,
    timestamp: outcome.votes.at(-1)?.createdAt ?? latest.updatedAt
  }
}

async function proveMDeployQuorum(
  deps: ApprovalDeps,
  proposalId: string
): Promise<
  | { proofId: string; proposalId: string; approvers: [string, string]; issuedAt: string }
  | MDeployApprovalFailure
> {
  const approval = await findMDeployApproval(deps, proposalId)
  if (!approval) {
    return { status: 404, error: { code: 'policy.quorum_not_found', message: 'quorum not found' } }
  }
  const votes = await deps.approvals.getVotes(approval.id)
  const approvers = [
    ...new Set(
      votes
        .filter(vote => vote.vote === 'approve' && mDeployApproverActorIds.includes(vote.actor))
        .map(vote => vote.actor)
    )
  ]
  if (
    approval.status !== 'approved' ||
    approval.quorumRequired !== 2 ||
    approvers.length !== 2 ||
    approvers[0] === undefined ||
    approvers[1] === undefined
  ) {
    return {
      status: 409,
      error: {
        code: 'policy.quorum_not_satisfied',
        message: 'production apply requires exactly two distinct eligible approvers'
      }
    }
  }
  return {
    proofId: approval.id,
    proposalId,
    approvers: [approvers[0], approvers[1]],
    issuedAt: approval.completedAt ?? approval.updatedAt
  }
}

const errorSchema = t.Object({ error: t.Object({ code: t.String(), message: t.String() }) })

/** Internal M-Deploy exchange delegates voter eligibility and quorum ownership to M-Policy. */
export function createMDeployApprovalRoutes(deps: ApprovalDeps) {
  return new Elysia({ prefix: '/internal/v0/policy/mdeploy' })
    .post(
      '/approvals/:proposalId/votes',
      async ({ params, body, headers, status }) => {
        const internal = validateInternalRequest(headers)
        if (!internal.ok) return status(401, { error: internal.error })
        try {
          const result = await recordMDeployVote(deps, { proposalId: params.proposalId, ...body })
          if ('error' in result) return status(result.status, { error: result.error })
          return result
        } catch (error) {
          return status(503, {
            error: {
              code: 'policy.unavailable',
              message: error instanceof Error ? error.message : 'M-Policy unavailable'
            }
          })
        }
      },
      {
        params: t.Object({ proposalId: t.String({ minLength: 1 }) }),
        body: t.Object({
          proposalActor: t.UnionEnum(actorIds),
          policyDecisionId: t.String({ minLength: 1 }),
          actor: t.UnionEnum(actorIds),
          result: t.Union([t.Literal('approve'), t.Literal('reject')]),
          expiresAt: t.String({ minLength: 1 })
        }),
        response: {
          200: t.Object({
            approvalId: t.String(),
            proposalStatus: t.Union([
              t.Literal('pending'),
              t.Literal('approved'),
              t.Literal('rejected')
            ]),
            policyDecisionId: t.String(),
            timestamp: t.String()
          }),
          401: errorSchema,
          403: errorSchema,
          404: errorSchema,
          409: errorSchema,
          503: errorSchema
        }
      }
    )
    .post(
      '/approvals/:proposalId/quorum',
      async ({ params, headers, status }) => {
        const internal = validateInternalRequest(headers)
        if (!internal.ok) return status(401, { error: internal.error })
        try {
          const result = await proveMDeployQuorum(deps, params.proposalId)
          if ('error' in result) return status(result.status, { error: result.error })
          return result
        } catch (error) {
          return status(503, {
            error: {
              code: 'policy.unavailable',
              message: error instanceof Error ? error.message : 'M-Policy unavailable'
            }
          })
        }
      },
      {
        params: t.Object({ proposalId: t.String({ minLength: 1 }) }),
        response: {
          200: t.Object({
            proofId: t.String(),
            proposalId: t.String(),
            approvers: t.Tuple([t.String(), t.String()]),
            issuedAt: t.String()
          }),
          401: errorSchema,
          403: errorSchema,
          404: errorSchema,
          409: errorSchema,
          503: errorSchema
        }
      }
    )
}

export { proveMDeployQuorum, recordMDeployVote }
