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

/**
 * Secret 领域错误需要保留 not_found / invalid_state 的 HTTP 语义，其他实现错误默认按 500 收敛。
 */
export function unwrapSecretResult<T>(
  result: { ok: true; value: T } | { ok: false; error: ServiceError },
  correlationId?: string
): T {
  if (!result.ok) {
    throw new CoreError(
      secretErrorStatus(result.error),
      result.error.code,
      result.error.message,
      correlationId
    )
  }
  return result.value
}

/**
 * get/reference 返回 null 时统一转换成 404，避免各路由重复拼装 not_found 错误。
 */
export function requireSecretRecord<T>(
  value: T | null,
  input: { correlationId?: string; message?: string }
): T {
  if (value === null) {
    throw new CoreError(
      404,
      'secret.not_found',
      input.message ?? 'secretRef not found',
      input.correlationId
    )
  }
  return value
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

/**
 * Secret 高风险突变统一遵循 permission → audit → 可变性检查(可选) → port mutate → error unwrap 的顺序。
 */
export async function runSecretMutation<T>(
  deps: CoreDeps,
  input: {
    headers: Record<string, string | undefined>
    action: Permission
    resource: string
    auditPayload: Record<string, unknown>
    before?: (correlationId: string) => Promise<void>
    run: (
      correlationId: string
    ) => Promise<{ ok: true; value: T } | { ok: false; error: ServiceError }>
  }
): Promise<T> {
  const { auth, decision } = await requireSecretPermission(deps, {
    headers: input.headers,
    action: input.action,
    resource: input.resource
  })
  await writeSecretAudit(deps, {
    actor: auth.actor,
    action: input.action,
    resource: input.resource,
    decisionId: decision.id,
    result: decision.result,
    correlationId: auth.correlationId,
    payload: input.auditPayload
  })
  if (input.before) {
    await input.before(auth.correlationId)
  }
  return unwrapSecretResult(await input.run(auth.correlationId), auth.correlationId)
}

/**
 * internal reference 调用统一做 token 校验、result unwrap、null→404 和 redaction。
 */
export async function resolveInternalSecretReference(
  deps: CoreDeps,
  input: { id: string; request: Request }
) {
  validateSecretInternalRequest(input.request)
  const result = await deps.secrets.reference(input.id)
  const secret = requireSecretRecord(unwrapSecretResult(result), {
    message: 'secretRef not found'
  })
  return redactSecretRecord(secret)
}

/**
 * unsupported internal secret routes 统一先过 shared token，再 fail-closed 返回显式 404。
 */
export function rejectUnavailableInternalSecretRoute(request: Request): never {
  validateSecretInternalRequest(request)
  throw new CoreError(
    404,
    'secret.internal_route_not_found',
    'internal secret disable route is not available'
  )
}
