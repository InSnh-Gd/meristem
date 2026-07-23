import type {
  ActorId,
  MNetClosedLoopAuditEvidenceFromSchema,
  MNetClosedLoopEventSubjectFromSchema,
  MNetClosedLoopPublicationFromSchema,
  MNetOperationDeniedFromSchema,
  MNetPolicyEvidenceFromSchema,
  Permission
} from '../../../packages/contracts/src/index.ts'
import {
  MNetClosedLoopStorageError,
  type MNetClosedLoopEventIntent,
  type MNetClosedLoopFactWrite
} from './closed-loop-store.ts'
import type {
  AllowedEvidence,
  ClosedLoopFailure,
  ClosedLoopMutationOutcome,
  MNetClosedLoopDeps,
  PolicyDecision
} from './closed-loop-workflow-types.ts'

export function closedLoopFailure(
  status: ClosedLoopFailure['status'],
  code: string,
  message: string,
  recovery: ClosedLoopFailure['recovery'] = 'no_side_effect'
): ClosedLoopFailure {
  return { kind: 'failure', status, error: { code, message }, recovery }
}

export function closedLoopFailureFromUnknown(error: unknown): ClosedLoopFailure {
  if (error instanceof MNetClosedLoopStorageError) {
    return closedLoopFailure(503, error.code, error.message)
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return closedLoopFailure(503, error.code, 'M-Net dependency is unavailable')
  }
  return closedLoopFailure(503, 'mnet.dependency_failed', 'M-Net dependency is unavailable')
}

function eventType(subject: MNetClosedLoopEventSubjectFromSchema): string {
  return subject.slice(0, -3)
}

function asPayload(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? { detail: value } : {}
}

/** Shared policy, Audit, durable mutation, and at-least-once publication sequencing. */
export function createClosedLoopWorkflowContext(deps: MNetClosedLoopDeps) {
  const now = deps.now ?? (() => new Date())
  const id = deps.id ?? (prefix => `${prefix}-${crypto.randomUUID()}`)

  function timestamp(): string {
    return now().toISOString()
  }

  function markMutation(kind: string): void {
    deps.onMutation?.(kind)
  }

  function policyEvidence(
    decision: PolicyDecision,
    requiredPermission: Permission,
    decidedAt: string
  ): MNetPolicyEvidenceFromSchema {
    return {
      policyDecisionId: decision.id,
      source: 'm-policy',
      outcome: decision.result === 'allow' ? 'allow' : 'deny',
      requiredPermission,
      reason: decision.reasons.join(', ') || decision.result,
      decidedAt
    }
  }

  async function writeAuditEvidence(input: {
    actor: ActorId
    action: string
    resource: string
    result: MNetClosedLoopAuditEvidenceFromSchema['result']
    correlationId: string
    payload?: unknown
  }): Promise<MNetClosedLoopAuditEvidenceFromSchema | ClosedLoopFailure> {
    const auditId = id('audit')
    const writtenAt = timestamp()
    try {
      await deps.log.writeAudit(
        input.actor,
        input.action,
        input.resource,
        input.result,
        input.correlationId,
        { auditId, ...(input.payload === undefined ? {} : { payload: input.payload }) }
      )
      return {
        auditId,
        source: 'm-log-audit',
        action: input.action,
        resource: input.resource,
        actor: input.actor,
        result: input.result,
        writtenAt,
        correlationId: input.correlationId
      }
  } catch {
    return closedLoopFailure(503, 'audit.write_failed', 'Audit write is unavailable')
    }
  }

  async function authorizeAndAudit(input: {
    actor: ActorId
    permission: Permission
    auditAction: string
    resource: string
    correlationId: string
    payload?: unknown
  }): Promise<AllowedEvidence | MNetOperationDeniedFromSchema | ClosedLoopFailure> {
    let decision: PolicyDecision
    const decidedAt = timestamp()
    try {
      decision = await deps.policy.authorize(input.actor, input.permission, input.resource)
  } catch {
    return closedLoopFailure(503, 'policy.unavailable', 'M-Policy is unavailable')
    }
    const policy = policyEvidence(decision, input.permission, decidedAt)
    const allowed = decision.result === 'allow'
    const audit = await writeAuditEvidence({
      actor: input.actor,
      action: input.auditAction,
      resource: input.resource,
      result: allowed ? 'allowed' : 'denied',
      correlationId: input.correlationId,
      payload: { policyDecisionId: decision.id, ...asPayload(input.payload) }
    })
    if ('kind' in audit) return audit
    if (!allowed) {
      return {
        result: 'denied',
        reason: policy.reason,
        policy,
        audit,
        sideEffect: 'none',
        correlationId: input.correlationId
      }
    }
    return {
      policy,
      audit,
      evidence: { policy, audit, log: { correlationId: input.correlationId } }
    }
  }

  async function authorizeRead(input: {
    actor: ActorId
    permission: Permission
    resource: string
  }): Promise<ClosedLoopFailure | null> {
    let decision: PolicyDecision
    try {
      decision = await deps.policy.authorize(input.actor, input.permission, input.resource)
  } catch {
    return closedLoopFailure(503, 'policy.unavailable', 'M-Policy is unavailable')
    }
    return decision.result === 'allow'
      ? null
      : closedLoopFailure(403, 'policy.denied', decision.reasons.join(', ') || decision.result)
  }

  function createEventIntent(input: {
    operationId: string
    networkId: string
    subject: MNetClosedLoopEventSubjectFromSchema
    payload: unknown
    correlationId: string
  }): MNetClosedLoopEventIntent {
    return {
      intentId: id('event-intent'),
      operationId: input.operationId,
      networkId: input.networkId,
      subject: input.subject,
      payload: input.payload,
      correlationId: input.correlationId,
      status: 'pending',
      createdAt: timestamp()
    }
  }

  async function recordTimeline(intent: MNetClosedLoopEventIntent): Promise<void> {
    try {
      await deps.log.writeTimeline(
        `M-Net closed-loop fact: ${intent.subject}`,
        intent.subject,
        intent.correlationId
      )
    } catch (error) {
      try {
        await deps.log.writeFull('warn', 'M-Net timeline write degraded', intent.correlationId, {
          subject: intent.subject,
          error: error instanceof Error ? error.message : String(error)
        })
      } catch (fullLogError) {
        void fullLogError
      }
    }
  }

  async function dispatchPendingEvents(
    operationId?: string,
    fallbackSubjects: readonly MNetClosedLoopEventSubjectFromSchema[] = []
  ): Promise<MNetClosedLoopPublicationFromSchema> {
    let pending: MNetClosedLoopEventIntent[]
    try {
      pending = await deps.store.listPendingEventIntents(operationId)
    } catch (error) {
      void error
      return { status: 'pending', pendingSubjects: [...fallbackSubjects] }
    }
    const pendingSubjects: MNetClosedLoopEventSubjectFromSchema[] = []
    for (const intent of pending) {
      try {
        await deps.events.publish(
          intent.subject,
          eventType(intent.subject),
          intent.payload,
          intent.correlationId
        )
      } catch (error) {
        pendingSubjects.push(intent.subject)
        try {
          await deps.store.recordEventIntentFailure(
            intent.intentId,
            error instanceof Error ? error.message : 'event publish failed'
          )
        } catch (recordError) {
          void recordError
        }
        continue
      }
      try {
        await deps.store.markEventIntentPublished(intent.intentId, timestamp())
      } catch (error) {
        void error
        pendingSubjects.push(intent.subject)
        continue
      }
      await recordTimeline(intent)
    }
    return {
      status: pendingSubjects.length === 0 ? 'published' : 'pending',
      pendingSubjects
    }
  }

  async function commitMutation<T>(input: {
    networkId: string
    correlationId: string
    mutationKind: string
    value: T
    facts: readonly MNetClosedLoopFactWrite[]
    events: readonly {
      subject: MNetClosedLoopEventSubjectFromSchema
      payload: unknown
    }[]
  }): Promise<ClosedLoopMutationOutcome<T>> {
    const operationId = id('operation')
    const intents = input.events.map(event =>
      createEventIntent({
        operationId,
        networkId: input.networkId,
        subject: event.subject,
        payload: event.payload,
        correlationId: input.correlationId
      })
    )
    await deps.store.commit({ facts: input.facts, eventIntents: intents })
    markMutation(input.mutationKind)
    const publication = await dispatchPendingEvents(
      operationId,
      input.events.map(event => event.subject)
    )
    return {
      kind: 'mutation',
      contractVersion: 'mnet-closed-loop-mutation@0.1.0',
      value: input.value,
      publication
    }
  }

  async function publishFacts(input: {
    networkId: string
    correlationId: string
    events: readonly {
      subject: MNetClosedLoopEventSubjectFromSchema
      payload: unknown
    }[]
  }): Promise<MNetClosedLoopPublicationFromSchema> {
    const operationId = id('operation')
    const intents = input.events.map(event =>
      createEventIntent({
        operationId,
        networkId: input.networkId,
        subject: event.subject,
        payload: event.payload,
        correlationId: input.correlationId
      })
    )
    await deps.store.commit({ facts: [], eventIntents: intents })
    return dispatchPendingEvents(
      operationId,
      input.events.map(event => event.subject)
    )
  }

  return {
    deps,
    now,
    id,
    timestamp,
    writeAuditEvidence,
    authorizeAndAudit,
    authorizeRead,
    commitMutation,
    publishFacts,
    dispatchPendingEvents
  }
}

export type ClosedLoopWorkflowContext = ReturnType<typeof createClosedLoopWorkflowContext>
