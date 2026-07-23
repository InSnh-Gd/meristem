import type {
  MNetCredentialLifecycleResultFromSchema,
  MNetJoinCredentialFromSchema
} from '../../../packages/contracts/src/index.ts'
import type { MNetCredentialOperation } from './closed-loop-store.ts'
import type { ClosedLoopWorkflowContext } from './closed-loop-workflow-support.ts'
import { closedLoopFailure, closedLoopFailureFromUnknown } from './closed-loop-workflow-support.ts'
import type { ClosedLoopFailure, ClosedLoopMutationOutcome } from './closed-loop-workflow-types.ts'

type CredentialOperationOutcome =
  | ClosedLoopMutationOutcome<MNetCredentialLifecycleResultFromSchema>
  | ClosedLoopFailure

function completedOperation(operation: MNetCredentialOperation): MNetCredentialOperation {
  const { lastError: _lastError, ...persisted } = operation
  return { ...persisted, state: 'completed' }
}

/**
 * 将外部 SecretProvider 调用包在可恢复的持久化操作内，避免进程中断留下不可解释的凭据状态。
 */
export function createCredentialOperationRunner(context: ClosedLoopWorkflowContext) {
  const { deps, timestamp, commitMutation } = context

  async function recordFailure(
    operation: MNetCredentialOperation,
    code: string,
    message: string
  ): Promise<ClosedLoopFailure> {
    try {
      await deps.store.commit({
        facts: [{ kind: 'credential-operation', value: { ...operation, lastError: code } }],
        eventIntents: []
      })
      return closedLoopFailure(503, code, message, 'retry_pending')
    } catch {
      return closedLoopFailure(
        503,
        'mnet.store.write_failed',
        'M-Net credential recovery state could not be recorded',
        'manual_intervention_required'
      )
    }
  }

  async function completeRotation(
    operation: MNetCredentialOperation,
    replacement: MNetJoinCredentialFromSchema
  ): Promise<CredentialOperationOutcome> {
    const revokedPrevious: MNetJoinCredentialFromSchema = {
      ...operation.previousCredential,
      status: 'revoked',
      revokedAt: timestamp(),
      revokedByAuditId: operation.evidence.audit.auditId
    }
    const result: MNetCredentialLifecycleResultFromSchema = {
      result: 'rotated',
      action: 'rotate',
      credential: replacement,
      previousCredentialId: operation.previousCredential.credentialId,
      existingTunnelsInvalidated: true,
      evidence: operation.evidence,
      correlationId: operation.correlationId
    }
    try {
      return await commitMutation({
        networkId: operation.networkId,
        correlationId: operation.correlationId,
        mutationKind: 'credential-rotated',
        value: result,
        facts: [
          { kind: 'credential-operation', value: completedOperation(operation) },
          { kind: 'credential', value: revokedPrevious },
          { kind: 'credential', value: replacement }
        ],
        events: [{ subject: 'mnet.credential.rotated.v0', payload: result }]
      })
    } catch (error) {
      return closedLoopFailureFromUnknown(error)
    }
  }

  async function completeRevocation(
    operation: MNetCredentialOperation
  ): Promise<CredentialOperationOutcome> {
    const revoked: MNetJoinCredentialFromSchema = {
      ...operation.previousCredential,
      status: 'revoked',
      revokedAt: timestamp(),
      revokedByAuditId: operation.evidence.audit.auditId
    }
    const result: MNetCredentialLifecycleResultFromSchema = {
      result: 'revoked',
      action: 'revoke',
      credential: revoked,
      existingTunnelsInvalidated: true,
      evidence: operation.evidence,
      correlationId: operation.correlationId
    }
    try {
      return await commitMutation({
        networkId: operation.networkId,
        correlationId: operation.correlationId,
        mutationKind: 'credential-revoked',
        value: result,
        facts: [
          { kind: 'credential-operation', value: completedOperation(operation) },
          { kind: 'credential', value: revoked }
        ],
        events: [{ subject: 'mnet.credential.revoked.v0', payload: result }]
      })
    } catch (error) {
      return closedLoopFailureFromUnknown(error)
    }
  }

  async function resume(
    operation: MNetCredentialOperation
  ): Promise<CredentialOperationOutcome> {
    if (operation.action === 'revoke') {
      const revokedSecret = await deps.credentials.revoke({
        credentialId: operation.previousCredential.credentialId,
        credentialRef: operation.previousCredential.credentialRef
      })
      if (!revokedSecret.ok) {
        return recordFailure(operation, revokedSecret.code, revokedSecret.message)
      }
      return completeRevocation(operation)
    }

    if (operation.state === 'pending_secret') {
      const replacementCredentialId = operation.replacementCredentialId
      const replacementExpiresAt = operation.replacementExpiresAt
      if (!replacementCredentialId || !replacementExpiresAt) {
        return recordFailure(
          operation,
          'mnet.credential.operation_invalid',
          'credential rotation recovery metadata is incomplete'
        )
      }
      const rotated = await deps.credentials.rotate({
        credentialId: replacementCredentialId,
        networkId: operation.networkId,
        nodeId: operation.nodeId,
        value: `${crypto.randomUUID()}${crypto.randomUUID()}`
      })
      if (!rotated.ok) return recordFailure(operation, rotated.code, rotated.message)

      const replacement: MNetJoinCredentialFromSchema = {
        ...operation.previousCredential,
        credentialId: replacementCredentialId,
        status: 'issued',
        credentialRef: rotated.credentialRef,
        issuedAt: timestamp(),
        expiresAt: replacementExpiresAt,
        rotatedFromCredentialId: operation.previousCredential.credentialId
      }
      const { lastError: _lastError, ...persisted } = operation
      const next: MNetCredentialOperation = {
        ...persisted,
        state: 'pending_previous_revoke',
        replacementCredential: replacement
      }
      try {
        await deps.store.commit({
          facts: [
            { kind: 'credential-operation', value: next },
            { kind: 'credential', value: replacement }
          ],
          eventIntents: []
        })
      } catch (error) {
        const failure = closedLoopFailureFromUnknown(error)
        return { ...failure, recovery: 'retry_pending' }
      }
      return resume(next)
    }

    if (!operation.replacementCredential) {
      return recordFailure(
        operation,
        'mnet.credential.operation_invalid',
        'credential rotation replacement is missing'
      )
    }
    const revokedSecret = await deps.credentials.revoke({
      credentialId: operation.previousCredential.credentialId,
      credentialRef: operation.previousCredential.credentialRef
    })
    if (!revokedSecret.ok) {
      return recordFailure(operation, revokedSecret.code, revokedSecret.message)
    }
    return completeRotation(operation, operation.replacementCredential)
  }

  async function recoverPending(): Promise<number> {
    const operations = await deps.store.credentialOperations.listPending()
    let completed = 0
    for (const operation of operations) {
      const result = await resume(operation)
      if (result.kind === 'mutation') completed += 1
    }
    return completed
  }

  return { resume, recoverPending }
}
