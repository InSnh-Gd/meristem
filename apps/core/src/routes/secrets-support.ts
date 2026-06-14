import { redactSecretsInObject } from '../../../../packages/common/src/secret-redaction.ts'
import type { ActorId, Permission } from '../../../../packages/contracts/src/index.ts'
import {
  internalTokenHeaderName,
  validateInternalRequest
} from '../../../../packages/internal-http/src/index.ts'
import { CoreError } from '../core-error.ts'
import { authorize, requireActor } from '../middleware/auth.ts'
import type { CoreDeps, ServiceError } from '../types.ts'

export function secretErrorStatus(error: ServiceError): 404 | 409 | 500 {
  if (error.code === 'secret.not_found') return 404
  if (error.code === 'secret.invalid_state') return 409
  return 500
}

export function redactSecretRecord<T extends Record<string, unknown>>(record: T): T {
  return redactSecretsInObject(record)
}

export async function requireSecretPermission(
  deps: CoreDeps,
  input: {
    headers: Record<string, string | undefined>
    action: Permission
    resource: string
  }
) {
  const auth = await requireActor(deps, input.headers)
  const decision = await authorize(deps, {
    actor: auth.actor,
    action: input.action,
    resource: input.resource,
    correlationId: auth.correlationId
  })

  return { auth, decision }
}

export async function writeSecretAudit(
  deps: CoreDeps,
  input: {
    actor: ActorId
    action: Permission
    resource: string
    decisionId: string
    result: string
    correlationId: string
    payload: Record<string, unknown>
  }
) {
  const audit = await deps.log.writeAudit({
    actor: input.actor,
    action: input.action,
    resource: input.resource,
    decisionId: input.decisionId,
    result: input.result,
    correlationId: input.correlationId,
    payload: redactSecretRecord(input.payload)
  })

  if (!audit.ok) {
    throw new CoreError(503, audit.error.code, audit.error.message, input.correlationId)
  }
}

export function validateSecretInternalRequest(request: Request, correlationId?: string) {
  const tokenValue = request.headers.get(internalTokenHeaderName)
  const result = process.env.MERISTEM_INTERNAL_TOKEN
    ? validateInternalRequest(request.headers)
    : tokenValue
      ? { ok: true as const }
      : {
          ok: false as const,
          error: { code: 'internal.unauthorized', message: 'invalid internal token' }
        }

  if (!result.ok) {
    const status = result.error.code === 'internal.unavailable' ? 503 : 401
    throw new CoreError(status, result.error.code, result.error.message, correlationId)
  }
}

export async function assertSecretIsMutable(
  deps: CoreDeps,
  input: { id: string; correlationId: string; operation: 'rotate' | 'disable' }
) {
  const current = await deps.secrets.get(input.id)
  if (!current.ok) {
    throw new CoreError(
      secretErrorStatus(current.error),
      current.error.code,
      current.error.message,
      input.correlationId
    )
  }
  if (current.value === null) {
    throw new CoreError(404, 'secret.not_found', 'secretRef not found', input.correlationId)
  }
  if (current.value.status === 'disabled') {
    throw new CoreError(
      409,
      'secret.invalid_state',
      `disabled secretRef cannot be ${input.operation}d`,
      input.correlationId
    )
  }
}
