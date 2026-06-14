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
  if (!result.ok) {
    throw new CoreError(
      identityErrorStatus(result.error),
      result.error.code,
      result.error.message,
      auth.correlationId
    )
  }
  if (result.value === null) {
    throw new CoreError(
      404,
      'identity.token.not_found',
      'identity token not found',
      auth.correlationId
    )
  }

  return toIdentityTokenRecord(result.value)
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
  if (!revoked.ok) {
    throw new CoreError(
      identityErrorStatus(revoked.error),
      revoked.error.code,
      revoked.error.message,
      auth.correlationId
    )
  }

  // revoke 响应同时返回顶层字段和 token 嵌套字段，保持向后兼容：
  // 旧客户端读取 token.jti/status/revokedAt，新客户端可以直接读取顶层字段。
  const revokedBody = {
    jti: revoked.value.jti,
    status: 'revoked' as const,
    revokedAt: revoked.value.revokedAt,
    revokedBy: revoked.value.revokedBy as ActorId,
    revokeReason: input.reason
  }

  return {
    ...revokedBody,
    token: revokedBody
  }
}
