import type { PolicyDecision } from '../../../../packages/contracts/src/index.ts'
import { CoreError } from '../core-error.ts'
import { authorize, requireActor } from '../middleware/auth.ts'
import { statusCodeForServiceError, tracedEvent } from '../middleware/route-support.ts'
import type { CoreDeps } from '../types.ts'

type ServiceMutationAuth = Awaited<ReturnType<typeof requireActor>> & { permission: PolicyDecision }

export async function requireServiceReadAccess(
  deps: CoreDeps,
  headers: Record<string, string | undefined>,
  resource: string
) {
  const auth = await requireActor(deps, headers)
  await authorize(deps, {
    actor: auth.actor,
    action: 'core:read',
    resource,
    correlationId: auth.correlationId
  })
  return auth
}

export async function requireServiceMutationAccess(
  deps: CoreDeps,
  input: {
    headers: Record<string, string | undefined>
    action: 'service:register' | 'service:reload'
    resource: string
  }
): Promise<ServiceMutationAuth> {
  const auth = await requireActor(deps, input.headers)
  const permission = await authorize(deps, {
    actor: auth.actor,
    action: input.action,
    resource: input.resource,
    correlationId: auth.correlationId
  })
  return { ...auth, permission }
}

export async function writeServiceAuditOrThrow(
  deps: CoreDeps,
  input: {
    actor: ServiceMutationAuth['actor']
    action: 'service:register' | 'service:reload'
    resource: string
    permission: PolicyDecision
    correlationId: string
    payload?: Record<string, unknown>
  }
) {
  const audit = await deps.log.writeAudit({
    actor: input.actor,
    action: input.action,
    resource: input.resource,
    decisionId: input.permission.id,
    result: input.permission.result,
    correlationId: input.correlationId,
    ...(input.payload ? { payload: input.payload } : {})
  })
  if (!audit.ok) {
    throw new CoreError(503, audit.error.code, audit.error.message, input.correlationId)
  }
}

export function unwrapServiceResult<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } },
  correlationId: string
): T {
  if (!result.ok) {
    throw new CoreError(
      statusCodeForServiceError(result.error.code),
      result.error.code,
      result.error.message,
      correlationId
    )
  }
  return result.value
}

export async function publishServiceRegistered(
  deps: CoreDeps,
  service: unknown,
  correlationId: string
) {
  await deps.events.publish(
    'service.lifecycle.registered.v0',
    tracedEvent({
      type: 'service.lifecycle.registered',
      source: 'meristem-core',
      payload: service,
      correlationId
    })
  )
}

export async function publishServiceReloadRequested(
  deps: CoreDeps,
  input: {
    serviceId: string
    correlationId: string
    reason?: string
  }
) {
  await deps.events.publish(
    'service.lifecycle.reload.requested.v0',
    tracedEvent({
      type: 'service.lifecycle.reload.requested',
      source: 'meristem-core',
      payload: {
        serviceId: input.serviceId,
        ...(input.reason ? { reason: input.reason } : {})
      },
      correlationId: input.correlationId
    })
  )
}

export async function writeServiceTimeline(
  deps: CoreDeps,
  input: {
    summary: string
    subject: string
    correlationId: string
  }
) {
  await deps.log.writeTimeline(input)
}

export async function writeServiceReloadFailure(
  deps: CoreDeps,
  correlationId: string,
  error: { code: string; message: string }
) {
  await deps.log.writeFull({
    level: 'warn',
    source: 'meristem-core',
    message: `service reload failed: ${error.message}`,
    correlationId,
    payload: { code: error.code, message: error.message }
  })
}
