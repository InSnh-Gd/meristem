import type { ActorId, Permission } from '../../../../packages/contracts/src/index.ts'
import {
  internalTokenHeaderName,
  validateInternalRequest
} from '../../../../packages/internal-http/src/index.ts'
import { CoreError } from '../core-error.ts'
import { authorize, requireActor } from '../middleware/auth.ts'
import type { CoreDeps, ServiceError } from '../types.ts'
import type { IdentityActorRecord, IdentityTokenRecord } from './identity-schemas.ts'

export function identityErrorStatus(error: ServiceError): 404 | 503 {
  switch (error.code) {
    case 'identity.actor.not_found':
    case 'identity.token.not_found':
      return 404
    default:
      return 503
  }
}

/**
 * Identity 读接口统一走显式 Bearer + M-Policy，避免 actor 元数据路由各自重复拼装鉴权逻辑。
 */
export async function requireIdentityReadAccess(
  deps: CoreDeps,
  input: {
    headers: Record<string, string | undefined>
    resource: string
  }
) {
  const auth = await requireActor(deps, input.headers)
  await authorize(deps, {
    actor: auth.actor,
    action: 'identity:read',
    resource: input.resource,
    correlationId: auth.correlationId
  })
  return auth
}

/**
 * Identity 服务错误统一通过领域映射收敛，保持 lifecycle/token 入口的 HTTP 语义一致。
 */
export function unwrapIdentityResult<T>(
  result: { ok: true; value: T } | { ok: false; error: ServiceError },
  correlationId?: string
): T {
  if (!result.ok) {
    throw new CoreError(
      identityErrorStatus(result.error),
      result.error.code,
      result.error.message,
      correlationId
    )
  }
  return result.value
}

/**
 * Actor / token 读取返回 null 时统一转换成 not_found，避免路由层重复拼装 404 细节。
 */
export function requireIdentityRecord<T>(
  value: T | null,
  input: {
    kind: 'actor' | 'token'
    correlationId: string
  }
): T {
  if (value === null) {
    const subject = input.kind === 'actor' ? 'identity actor' : 'identity token'
    throw new CoreError(
      404,
      `identity.${input.kind}.not_found`,
      `${subject} not found`,
      input.correlationId
    )
  }
  return value
}

export function issueTokenAuditPayload(input: {
  targetActor: ActorId
  ttl: string
  purpose: string
}) {
  return {
    actor: input.targetActor,
    ttl: input.ttl,
    purpose: input.purpose
  }
}

export async function requireIdentityTokenIssueAccess(
  deps: CoreDeps,
  input: {
    actor: ActorId
    headers: Record<string, string | undefined>
  }
) {
  const auth = await requireActor(deps, input.headers)
  const permission = await authorize(deps, {
    actor: auth.actor,
    action: 'identity:token-issue',
    resource: `identity:token-issue:${input.actor}`,
    correlationId: auth.correlationId
  })
  return { auth, permission }
}

export function toIssuedIdentityTokenResponse(
  token: { jti: string; actor: string; token: string; expiresAt: string },
  purpose: string
) {
  return {
    ...token,
    issuer: 'meristem-local' as const,
    audience: 'meristem-core' as const,
    purpose,
    status: 'active' as const
  }
}

export function toInternalIntrospectionResponse(
  requestedJti: string,
  value: { active: boolean; jti?: string; actor?: string }
) {
  const jti = value.jti ?? requestedJti
  return value.actor
    ? { jti, active: value.active, actor: value.actor as ActorId }
    : { jti, active: value.active }
}

/**
 * token 签发统一收口 permission、audit、port 调用与响应整形，路由层只保留 schema 与 201 状态。
 */
export async function issueIdentityToken(
  deps: CoreDeps,
  input: {
    actor: ActorId
    ttl: string
    purpose: string
    headers: Record<string, string | undefined>
  }
) {
  const { auth, permission } = await requireIdentityTokenIssueAccess(deps, {
    actor: input.actor,
    headers: input.headers
  })

  await writeIdentityAudit(deps, {
    actor: auth.actor,
    action: 'identity:token-issue',
    resource: `identity:token:${input.actor}`,
    decisionId: permission.id,
    result: permission.result,
    correlationId: auth.correlationId,
    payload: issueTokenAuditPayload({
      targetActor: input.actor,
      ttl: input.ttl,
      purpose: input.purpose
    })
  })

  const issued = await deps.identity.issueToken({
    actor: input.actor,
    ttl: input.ttl,
    purpose: input.purpose,
    correlationId: auth.correlationId
  })
  const token = unwrapIdentityResult(issued, auth.correlationId)
  return toIssuedIdentityTokenResponse(token, input.purpose)
}

/**
 * internal introspection 统一处理 shared token、fail-soft inactive 回退与 actor/jti 响应整形。
 */
export async function introspectIdentityTokenInternal(
  deps: CoreDeps,
  input: { request: Request; jti: string }
): Promise<
  | { ok: true; value: { jti?: string; active: boolean; actor?: ActorId } }
  | { ok: false; status: 401 | 503; error: { code: string; message: string } }
> {
  const internalAuth = validateIdentityInternalRequest(input.request)
  if (!internalAuth.ok) {
    return {
      ok: false,
      status: internalAuth.error.code === 'internal.unavailable' ? 503 : 401,
      error: internalAuth.error
    }
  }

  const result = await deps.identity.introspect(input.jti)
  if (!result.ok) {
    return { ok: true, value: { jti: input.jti, active: false } }
  }

  return { ok: true, value: toInternalIntrospectionResponse(input.jti, result.value) }
}

export function toIdentityActorRecord(actor: {
  id: string
  displayName: string
  status: string
  createdAt: string
  updatedAt: string
}): IdentityActorRecord {
  return {
    id: actor.id as ActorId,
    displayName: actor.displayName,
    status: actor.status as IdentityActorRecord['status'],
    createdAt: actor.createdAt,
    updatedAt: actor.updatedAt
  }
}

export function toIdentityTokenRecord(token: {
  jti: string
  actor: string
  issuer: string
  audience: string
  issuedAt: string
  expiresAt: string
  issuedBy: string
  purpose: string
  status: string
  revokedAt?: string
  revokedBy?: string
  revokeReason?: string
}): IdentityTokenRecord {
  return {
    jti: token.jti,
    actor: token.actor as ActorId,
    issuer: token.issuer as IdentityTokenRecord['issuer'],
    audience: token.audience as IdentityTokenRecord['audience'],
    issuedAt: token.issuedAt,
    expiresAt: token.expiresAt,
    issuedBy: token.issuedBy as ActorId,
    purpose: token.purpose,
    status: token.status as IdentityTokenRecord['status'],
    ...(token.revokedAt ? { revokedAt: token.revokedAt } : {}),
    ...(token.revokedBy ? { revokedBy: token.revokedBy as ActorId } : {}),
    ...(token.revokeReason ? { revokeReason: token.revokeReason } : {})
  }
}

export function validateIdentityInternalRequest(request: Request) {
  const tokenValue = request.headers.get(internalTokenHeaderName)
  if (!process.env.MERISTEM_INTERNAL_TOKEN) {
    return tokenValue
      ? { ok: true as const }
      : {
          ok: false as const,
          error: { code: 'internal.unauthorized', message: 'invalid internal token' }
        }
  }

  return validateInternalRequest(request.headers)
}

export async function writeIdentityAudit(
  deps: CoreDeps,
  input: {
    actor: ActorId
    action: Permission
    resource: string
    decisionId: string
    result: string
    correlationId: string
    payload?: Record<string, unknown>
  }
) {
  const audit = await deps.log.writeAudit({
    actor: input.actor,
    action: input.action,
    resource: input.resource,
    decisionId: input.decisionId,
    result: input.result,
    correlationId: input.correlationId,
    ...(input.payload ? { payload: input.payload } : {})
  })

  if (!audit.ok) {
    throw new CoreError(503, audit.error.code, audit.error.message, input.correlationId)
  }
}

export async function inspectIdentityToken(
  deps: CoreDeps,
  input: {
    jti: string
    headers: Record<string, string | undefined>
  }
) {
  const auth = await requireActor(deps, input.headers)
  await authorize(deps, {
    actor: auth.actor,
    action: 'identity:token-inspect',
    resource: `identity:token:${input.jti}`,
    correlationId: auth.correlationId
  })

  const result = await deps.identity.inspectToken(input.jti)
  const token = requireIdentityRecord(unwrapIdentityResult(result, auth.correlationId), {
    kind: 'token',
    correlationId: auth.correlationId
  })

  return toIdentityTokenRecord(token)
}

export async function revokeIdentityToken(
  deps: CoreDeps,
  input: {
    jti: string
    reason: string
    headers: Record<string, string | undefined>
  }
) {
  const auth = await requireActor(deps, input.headers)
  const permission = await authorize(deps, {
    actor: auth.actor,
    action: 'identity:token-revoke',
    resource: `identity:token:${input.jti}`,
    correlationId: auth.correlationId
  })

  await writeIdentityAudit(deps, {
    actor: auth.actor,
    action: 'identity:token-revoke',
    resource: `identity:token:${input.jti}`,
    decisionId: permission.id,
    result: permission.result,
    correlationId: auth.correlationId,
    payload: { reason: input.reason }
  })

  const revoked = await deps.identity.revokeToken(input.jti, {
    reason: input.reason,
    correlationId: auth.correlationId
  })
  const token = unwrapIdentityResult(revoked, auth.correlationId)

  // revoke 响应同时返回顶层字段和 token 嵌套字段，保持向后兼容：
  // 旧客户端读取 token.jti/status/revokedAt，新客户端可以直接读取顶层字段。
  const revokedBody = {
    jti: token.jti,
    status: 'revoked' as const,
    revokedAt: token.revokedAt,
    revokedBy: token.revokedBy as ActorId,
    revokeReason: input.reason
  }

  return {
    ...revokedBody,
    token: revokedBody
  }
}
