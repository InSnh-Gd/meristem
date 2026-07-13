import { ok, type Result } from '../../../packages/common/src/result.ts'
import type {
  MDeployDeps,
  MDeployError,
  MDeployEventIntent,
  MDeployPublicationStatus
} from './deps.ts'

/** 事件意图与权威状态一起持久化，实际 dispatch 失败只留下可重试 pending，不改写执行事实。 */
export function createMDeployEventIntent(
  operationId: string,
  subject: string,
  payload: unknown,
  createdAt: string
): MDeployEventIntent {
  return {
    intentId: crypto.randomUUID(),
    operationId,
    subject,
    payload,
    status: 'pending',
    createdAt
  }
}

/** 每次 reconcile 都可重放 pending intent；publisher 需按事件语义容忍至少一次投递。 */
export async function dispatchPendingMDeployEvents(
  deps: MDeployDeps,
  operationId?: string
): Promise<Result<MDeployPublicationStatus, MDeployError>> {
  const pending = await deps.store.listPendingEventIntents(operationId)
  if (!pending.ok) return pending

  let publicationStatus: MDeployPublicationStatus = 'published'
  for (const intent of pending.value) {
    const published = await deps.events.publish(intent.subject, intent.payload)
    if (!published.ok) {
      publicationStatus = 'pending'
      const recorded = await deps.store.recordEventIntentFailure(
        intent.intentId,
        published.error.code
      )
      if (!recorded.ok) return recorded
      await deps.log.writeFull({
        level: 'warn',
        message: `deployment event publication remains pending: ${intent.subject}`,
        correlationId: readCorrelationId(intent.payload) ?? intent.operationId,
        errorCode: published.error.code
      })
      continue
    }
    const marked = await deps.store.markEventIntentPublished(intent.intentId, deps.now())
    if (!marked.ok) return marked
    if (!marked.value) {
      return {
        ok: false,
        error: { code: 'deploy.event_intent_not_found', message: 'event intent not found' }
      }
    }
  }
  return ok(publicationStatus)
}

/** 权威状态已提交后，dispatch 或 outbox bookkeeping 故障只能降级为 pending，不能伪造执行失败。 */
export async function publicationStatusAfterDurableState(
  deps: MDeployDeps,
  operationId: string,
  correlationId: string
): Promise<MDeployPublicationStatus> {
  const dispatched = await dispatchPendingMDeployEvents(deps, operationId)
  if (dispatched.ok) return dispatched.value
  await deps.log.writeFull({
    level: 'warn',
    message: 'deployment event publication remains pending after durable state commit',
    correlationId,
    errorCode: dispatched.error.code
  })
  return 'pending'
}

function readCorrelationId(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const correlationId = Reflect.get(payload, 'correlationId')
  return typeof correlationId === 'string' ? correlationId : undefined
}
