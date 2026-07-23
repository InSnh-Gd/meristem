import type {
  ActorId,
  MNetCredentialLifecycleResultFromSchema,
  MNetJoinApprovalResultFromSchema,
  MNetJoinCredentialFromSchema,
  MNetOperationDeniedFromSchema,
  MNetPendingJoinRequestFromSchema
} from '../../../packages/contracts/src/index.ts'
import { createCredentialOperationRunner } from './closed-loop-credential-operation.ts'
import type { MNetCredentialOperation } from './closed-loop-store.ts'
import type { ClosedLoopWorkflowContext } from './closed-loop-workflow-support.ts'
import {
  closedLoopFailure,
  closedLoopFailureFromUnknown
} from './closed-loop-workflow-support.ts'
import type {
  ClosedLoopFailure,
  ClosedLoopMutationOutcome,
  SubmitJoinInput
} from './closed-loop-workflow-types.ts'

type JoinDecisionInput =
  | {
      actor: ActorId
      requestId: string
      decision: 'approve'
      credentialExpiresAt: string
    }
  | {
      actor: ActorId
      requestId: string
      decision: 'reject'
      reason: string
    }

/** Join decisions and credentials share one workflow because approval issues the first credential. */
export function createJoinCredentialWorkflow(context: ClosedLoopWorkflowContext) {
  const { deps, id, now, timestamp, authorizeAndAudit, commitMutation } = context
  const credentialOperation = createCredentialOperationRunner(context)

  async function submitJoinRequest(
    input: SubmitJoinInput
  ): Promise<
    | ClosedLoopMutationOutcome<MNetPendingJoinRequestFromSchema>
    | MNetOperationDeniedFromSchema
    | ClosedLoopFailure
  > {
    const { correlationId, ...storedInput } = input
    const gated = await authorizeAndAudit({
      actor: input.requestedBy,
      permission: 'network:join',
      auditAction: 'mnet.join.request',
      resource: `network:${input.networkId}:join:${input.requestId}`,
      correlationId,
      payload: { nodeId: input.nodeId }
    })
    if ('kind' in gated || 'result' in gated) return gated
    const request: MNetPendingJoinRequestFromSchema = {
      ...storedInput,
      status: 'pending',
      requestedAt: timestamp()
    }
    try {
      return await commitMutation({
        networkId: request.networkId,
        correlationId,
        mutationKind: 'join-requested',
        value: request,
        facts: [{ kind: 'join', value: request }],
        events: [{ subject: 'mnet.join.requested.v0', payload: request }]
      })
    } catch (error) {
      return closedLoopFailureFromUnknown(error)
    }
  }

  async function decideJoinRequest(
    input: JoinDecisionInput
  ): Promise<
    | ClosedLoopMutationOutcome<MNetJoinApprovalResultFromSchema>
    | MNetOperationDeniedFromSchema
    | ClosedLoopFailure
  > {
    const request = await deps.store.joins.get(input.requestId)
    if (!request) return closedLoopFailure(404, 'mnet.join.not_found', 'join request not found')
    if (request.status !== 'pending') {
      return closedLoopFailure(409, 'mnet.join.not_pending', 'join request is no longer pending')
    }
    if (Date.parse(request.expiresAt) <= now().getTime()) {
      return closedLoopFailure(409, 'mnet.join.expired', 'join request has expired')
    }

    const correlationId = id('correlation')
    const approving = input.decision === 'approve'
    const gated = await authorizeAndAudit({
      actor: input.actor,
      permission: 'network:join',
      auditAction: approving ? 'mnet.join.approve' : 'mnet.join.reject',
      resource: `network:${request.networkId}:join:${request.requestId}`,
      correlationId,
      payload: approving ? { nodeId: request.nodeId } : { nodeId: request.nodeId, reason: input.reason }
    })
    if ('kind' in gated || 'result' in gated) return gated

    if (!approving) {
      const rejectedRequest: MNetPendingJoinRequestFromSchema = {
        ...request,
        status: 'rejected',
        policyDecisionId: gated.policy.policyDecisionId
      }
      const rejected: MNetJoinApprovalResultFromSchema = {
        result: 'rejected',
        request: rejectedRequest,
        credential: null,
        evidence: gated.evidence,
        correlationId
      }
      try {
        return await commitMutation({
          networkId: request.networkId,
          correlationId,
          mutationKind: 'join-rejected',
          value: rejected,
          facts: [{ kind: 'join', value: rejectedRequest }],
          events: [{ subject: 'mnet.join.rejected.v0', payload: rejected }]
        })
      } catch (error) {
        return closedLoopFailureFromUnknown(error)
      }
    }

    const credentialId = id('mnet-credential')
    const issued = await deps.credentials.issue({
      credentialId,
      networkId: request.networkId,
      nodeId: request.nodeId,
      value: `${crypto.randomUUID()}${crypto.randomUUID()}`
    })
    if (!issued.ok) return closedLoopFailure(503, issued.code, issued.message)
    const credential: MNetJoinCredentialFromSchema = {
      credentialId,
      nodeId: request.nodeId,
      networkId: request.networkId,
      profileVersion: request.requestedProfileVersion,
      status: 'issued',
      credentialRef: issued.credentialRef,
      issuedAt: timestamp(),
      expiresAt: input.credentialExpiresAt
    }
    const approvedRequest: MNetPendingJoinRequestFromSchema = {
      ...request,
      status: 'approved',
      policyDecisionId: gated.policy.policyDecisionId
    }
    const approved: MNetJoinApprovalResultFromSchema = {
      result: 'approved',
      request: approvedRequest,
      credential,
      evidence: gated.evidence,
      correlationId
    }
    const lifecycle: MNetCredentialLifecycleResultFromSchema = {
      result: 'issued',
      action: 'issue',
      credential,
      existingTunnelsInvalidated: false,
      evidence: gated.evidence,
      correlationId
    }
    try {
      return await commitMutation({
        networkId: request.networkId,
        correlationId,
        mutationKind: 'join-approved',
        value: approved,
        facts: [
          { kind: 'credential', value: credential },
          { kind: 'join', value: approvedRequest }
        ],
        events: [
          { subject: 'mnet.join.approved.v0', payload: approved },
          { subject: 'mnet.credential.issued.v0', payload: lifecycle }
        ]
      })
    } catch (error) {
      const failure = closedLoopFailureFromUnknown(error)
      return { ...failure, recovery: 'manual_intervention_required' }
    }
  }

  async function rotateCredential(input: {
    actor: ActorId
    credentialId: string
    expiresAt: string
    reason: string
  }): Promise<
    | ClosedLoopMutationOutcome<MNetCredentialLifecycleResultFromSchema>
    | MNetOperationDeniedFromSchema
    | ClosedLoopFailure
  > {
    const previous = await deps.store.credentials.get(input.credentialId)
    if (!previous) {
      return closedLoopFailure(404, 'mnet.credential.not_found', 'credential not found')
    }
    if (previous.status !== 'issued' && previous.status !== 'active') {
      return closedLoopFailure(409, 'mnet.credential.inactive', 'credential cannot be rotated')
    }
    const correlationId = id('correlation')
    const gated = await authorizeAndAudit({
      actor: input.actor,
      permission: 'secret:rotate',
      auditAction: 'mnet.credential.rotate',
      resource: `network:${previous.networkId}:credential:${previous.credentialId}`,
      correlationId,
      payload: { reason: input.reason }
    })
    if ('kind' in gated || 'result' in gated) return gated

    const operation: MNetCredentialOperation = {
      operationId: id('credential-operation'),
      action: 'rotate',
      state: 'pending_secret',
      networkId: previous.networkId,
      nodeId: previous.nodeId,
      previousCredential: previous,
      replacementCredentialId: id('mnet-credential'),
      replacementExpiresAt: input.expiresAt,
      evidence: gated.evidence,
      correlationId,
      createdAt: timestamp()
    }
    const rotatingPrevious: MNetJoinCredentialFromSchema = { ...previous, status: 'rotating' }
    try {
      const claimed = await deps.store.claimCredentialTransition({
        credentialId: previous.credentialId,
        expectedStatuses: [previous.status],
        facts: [
          { kind: 'credential', value: rotatingPrevious },
          { kind: 'credential-operation', value: operation }
        ]
      })
      if (!claimed) {
        return closedLoopFailure(
          409,
          'mnet.credential.transition_conflict',
          'credential state changed during rotation'
        )
      }
    } catch (error) {
      const failure = closedLoopFailureFromUnknown(error)
      return { ...failure, recovery: 'no_side_effect' }
    }
    return credentialOperation.resume(operation)
  }

  async function revokeCredential(input: {
    actor: ActorId
    credentialId: string
    reason: string
  }): Promise<
    | ClosedLoopMutationOutcome<MNetCredentialLifecycleResultFromSchema>
    | MNetOperationDeniedFromSchema
    | ClosedLoopFailure
  > {
    const credential = await deps.store.credentials.get(input.credentialId)
    if (!credential) {
      return closedLoopFailure(404, 'mnet.credential.not_found', 'credential not found')
    }
    if (credential.status !== 'issued' && credential.status !== 'active') {
      return closedLoopFailure(409, 'mnet.credential.inactive', 'credential cannot be revoked')
    }
    const correlationId = id('correlation')
    const gated = await authorizeAndAudit({
      actor: input.actor,
      permission: 'secret:disable',
      auditAction: 'mnet.credential.revoke',
      resource: `network:${credential.networkId}:credential:${credential.credentialId}`,
      correlationId,
      payload: { reason: input.reason }
    })
    if ('kind' in gated || 'result' in gated) return gated

    const operation: MNetCredentialOperation = {
      operationId: id('credential-operation'),
      action: 'revoke',
      state: 'pending_secret',
      networkId: credential.networkId,
      nodeId: credential.nodeId,
      previousCredential: credential,
      evidence: gated.evidence,
      correlationId,
      createdAt: timestamp()
    }
    try {
      const claimed = await deps.store.claimCredentialTransition({
        credentialId: credential.credentialId,
        expectedStatuses: [credential.status],
        facts: [
          { kind: 'credential', value: { ...credential, status: 'rotating' } },
          { kind: 'credential-operation', value: operation }
        ]
      })
      if (!claimed) {
        return closedLoopFailure(
          409,
          'mnet.credential.transition_conflict',
          'credential state changed during revocation'
        )
      }
    } catch (error) {
      return closedLoopFailureFromUnknown(error)
    }
    return credentialOperation.resume(operation)
  }

  async function isTunnelEligible(networkId: string, nodeId: string): Promise<boolean> {
    const pendingOperation = (await deps.store.credentialOperations.listPending()).some(
      operation => operation.networkId === networkId && operation.nodeId === nodeId
    )
    if (pendingOperation) return false
    const credentials = await deps.store.credentials.listByNetwork(networkId)
    const current = credentials
      .filter(
        credential =>
          credential.nodeId === nodeId &&
          (credential.status === 'issued' || credential.status === 'active')
      )
      .sort((left, right) => Date.parse(right.issuedAt) - Date.parse(left.issuedAt))[0]
    return Boolean(current && Date.parse(current.expiresAt) > now().getTime())
  }

  return {
    submitJoinRequest,
    decideJoinRequest,
    rotateCredential,
    revokeCredential,
    recoverPendingCredentialOperations: credentialOperation.recoverPending,
    isTunnelEligible
  }
}
