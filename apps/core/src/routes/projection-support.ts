import type {
  ActorId,
  BackfillParams,
  Permission,
  PolicyDecision,
  ProjectionCursor
} from '../../../../packages/contracts/src/index.ts'
import { CoreError } from '../core-error.ts'
import { authorize, requireActor } from '../middleware/auth.ts'
import { statusCodeForServiceError } from '../middleware/route-support.ts'
import type { CoreDeps } from '../types.ts'

export type ProjectionControlContext = {
  actor: ActorId
  correlationId: string
  permission: PolicyDecision
  action: Permission
  resource: string
}

export async function requireProjectionReadAccess(
  deps: CoreDeps,
  headers: Record<string, string | undefined>,
  resource: string
) {
  const auth = await requireActor(deps, headers)
  await authorize(deps, {
    actor: auth.actor,
    action: 'projection:read',
    resource,
    correlationId: auth.correlationId
  })
  return auth
}

export async function requireProjectionControlAccess(
  deps: CoreDeps,
  input: {
    headers: Record<string, string | undefined>
    action: Permission
    resource: string
  }
): Promise<ProjectionControlContext> {
  const auth = await requireActor(deps, input.headers)
  const permission = await authorize(deps, {
    actor: auth.actor,
    action: input.action,
    resource: input.resource,
    correlationId: auth.correlationId
  })
  return {
    actor: auth.actor,
    correlationId: auth.correlationId,
    permission,
    action: input.action,
    resource: input.resource
  }
}

export async function writeProjectionControlAudit(
  deps: CoreDeps,
  context: ProjectionControlContext,
  payload: Record<string, unknown>
) {
  const audit = await deps.log.writeAudit({
    actor: context.actor,
    action: context.action,
    resource: context.resource,
    decisionId: context.permission.id,
    result: context.permission.result,
    correlationId: context.correlationId,
    payload
  })
  if (!audit.ok) {
    throw new CoreError(503, audit.error.code, audit.error.message, context.correlationId)
  }
}

export async function writeProjectionControlFailure(
  deps: CoreDeps,
  context: Pick<ProjectionControlContext, 'actor' | 'action' | 'resource' | 'correlationId'>,
  error: { code: string; message: string }
) {
  await deps.log.writeFull({
    level: 'warn',
    source: 'meristem-core',
    message: 'projection control failed',
    correlationId: context.correlationId,
    payload: {
      actor: context.actor,
      action: context.action,
      resource: context.resource,
      code: error.code,
      message: error.message
    }
  })
}

export function throwProjectionServiceError(
  error: { code: string; message: string },
  correlationId: string
): never {
  throw new CoreError(
    statusCodeForServiceError(error.code),
    error.code,
    error.message,
    correlationId
  )
}

export function optionalCursorPayload(cursor: ProjectionCursor | null) {
  return cursor ? { factId: cursor.factId, timestamp: cursor.timestamp } : null
}

export function toBackfillParams(body: {
  index: string
  from?: ProjectionCursor
  to?: ProjectionCursor
  batchSize: number | string
  targetVersion?: string
}): BackfillParams {
  return {
    index: body.index,
    from: body.from ?? null,
    to: body.to ?? null,
    batchSize: Number(body.batchSize),
    ...(body.targetVersion ? { targetVersion: body.targetVersion } : {})
  }
}

export async function writeProjectionTimeline(
  deps: CoreDeps,
  input: {
    summary: string
    subject: string
    correlationId: string
  }
) {
  await deps.log.writeTimeline(input)
}

/**
 * Projection 只读端点统一收敛 access、失败日志与 service error throw，路由只保留响应 schema。
 */
export async function runProjectionRead<T>(
  deps: CoreDeps,
  input: {
    headers: Record<string, string | undefined>
    resource: string
    run: () => Promise<{ ok: true; value: T } | { ok: false; error: { code: string; message: string } }>
  }
): Promise<T> {
  const auth = await requireProjectionReadAccess(deps, input.headers, input.resource)
  const result = await input.run()
  if (!result.ok) {
    await writeProjectionControlFailure(
      deps,
      {
        actor: auth.actor,
        action: 'projection:read',
        resource: input.resource,
        correlationId: auth.correlationId
      },
      result.error
    )
    throwProjectionServiceError(result.error, auth.correlationId)
  }
  return result.value
}

/**
 * Projection 控制端点统一执行 access、audit、service error 收口和 timeline 记录，压缩路由层编排。
 */
export async function runProjectionControl<T>(
  deps: CoreDeps,
  input: {
    headers: Record<string, string | undefined>
    action: Permission
    resource: string
    auditPayload: Record<string, unknown>
    timeline: { summary: string; subject: string }
    run: () => Promise<{ ok: true; value: T } | { ok: false; error: { code: string; message: string } }>
  }
): Promise<T> {
  const auth = await requireProjectionControlAccess(deps, {
    headers: input.headers,
    action: input.action,
    resource: input.resource
  })
  await writeProjectionControlAudit(deps, auth, input.auditPayload)
  const result = await input.run()
  if (!result.ok) {
    await writeProjectionControlFailure(deps, auth, result.error)
    throwProjectionServiceError(result.error, auth.correlationId)
  }
  await writeProjectionTimeline(deps, {
    summary: input.timeline.summary,
    subject: input.timeline.subject,
    correlationId: auth.correlationId
  })
  return result.value
}
