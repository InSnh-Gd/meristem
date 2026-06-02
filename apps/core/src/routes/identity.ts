import { Elysia, t } from 'elysia'
import type { ActorId, Permission } from '../../../../packages/contracts/src/index.ts'
import { actorIds } from '../../../../packages/contracts/src/index.ts'
import { internalTokenHeaderName, validateInternalRequest } from '../../../../packages/internal-http/src/index.ts'
import { CoreError } from '../core-error.ts'
import { requireActor, authorize } from '../middleware/auth.ts'
import { apiErrorSchema, protectedRouteDetail } from '../schemas.ts'
import type { CoreDeps, ServiceError } from '../types.ts'

type IdentityActorRecord = {
  id: ActorId
  displayName: string
  status: 'active' | 'disabled'
  createdAt: string
  updatedAt: string
}

type IdentityTokenRecord = {
  jti: string
  actor: ActorId
  issuer: 'meristem-local'
  audience: 'meristem-core' | 'meristem-service'
  issuedAt: string
  expiresAt: string
  issuedBy: ActorId
  purpose: string
  status: 'active' | 'revoked' | 'expired'
  revokedAt?: string
  revokedBy?: ActorId
  revokeReason?: string
}

const identityActorSchema = t.Object({
  id: t.UnionEnum(actorIds),
  displayName: t.String(),
  status: t.Union([t.Literal('active'), t.Literal('disabled')]),
  createdAt: t.String(),
  updatedAt: t.String()
})

const actorTokenSchema = t.Object({
  jti: t.String(),
  actor: t.UnionEnum(actorIds),
  issuer: t.Literal('meristem-local'),
  audience: t.Union([t.Literal('meristem-core'), t.Literal('meristem-service')]),
  issuedAt: t.String(),
  expiresAt: t.String(),
  issuedBy: t.UnionEnum(actorIds),
  purpose: t.String(),
  status: t.Union([t.Literal('active'), t.Literal('revoked'), t.Literal('expired')]),
  revokedAt: t.Optional(t.String()),
  revokedBy: t.Optional(t.UnionEnum(actorIds)),
  revokeReason: t.Optional(t.String())
})

const issueTokenBodySchema = t.Object({
  actor: t.UnionEnum(actorIds),
  ttl: t.String({ minLength: 1 }),
  purpose: t.String({ minLength: 1 })
})

const revokeTokenBodySchema = t.Object({
  reason: t.String({ minLength: 1 })
})

const tokenParamsSchema = t.Object({
  jti: t.String({ minLength: 1 })
})

const actorParamsSchema = t.Object({
  id: t.UnionEnum(actorIds)
})

const internalIntrospectionBodySchema = t.Object({
  jti: t.String({ minLength: 1 })
})

function identityErrorStatus(error: ServiceError): 404 | 503 {
  switch (error.code) {
    case 'identity.actor.not_found':
    case 'identity.token.not_found':
      return 404
    default:
      return 503
  }
}

function issueTokenAuditPayload(input: { targetActor: ActorId; ttl: string; purpose: string }) {
  return {
    actor: input.targetActor,
    ttl: input.ttl,
    purpose: input.purpose
  }
}

function toIdentityActorRecord(actor: {
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

function toIdentityTokenRecord(token: {
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

function validateIdentityInternalRequest(headers: Record<string, string | undefined>) {
  if (!process.env.MERISTEM_INTERNAL_TOKEN) {
    return headers[internalTokenHeaderName]
      ? { ok: true as const }
      : { ok: false as const, error: { code: 'internal.unauthorized', message: 'invalid internal token' } }
  }

  return validateInternalRequest(headers)
}

async function writeIdentityAudit(
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

async function inspectIdentityToken(deps: CoreDeps, input: {
  jti: string
  headers: Record<string, string | undefined>
}) {
  const auth = await requireActor(deps, input.headers)
  await authorize(deps, {
    actor: auth.actor,
    action: 'identity:token-inspect',
    resource: `identity:token:${input.jti}`,
    correlationId: auth.correlationId
  })

  const result = await deps.identity.inspectToken(input.jti)
  if (!result.ok) {
    throw new CoreError(identityErrorStatus(result.error), result.error.code, result.error.message, auth.correlationId)
  }
  if (result.value === null) {
    throw new CoreError(404, 'identity.token.not_found', 'identity token not found', auth.correlationId)
  }

  return toIdentityTokenRecord(result.value)
}

async function revokeIdentityToken(deps: CoreDeps, input: {
  jti: string
  reason: string
  headers: Record<string, string | undefined>
}) {
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
    throw new CoreError(identityErrorStatus(revoked.error), revoked.error.code, revoked.error.message, auth.correlationId)
  }

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

/**
 * Identity v0.2 路由把 Core 自持身份生命周期暴露为 REST 边界，读写都必须遵循认证、授权与审计约束。
 */
export const identity = (deps: CoreDeps) => {
  const externalIdentity = new Elysia({ prefix: '/api/v0/identity' })
    // actor 列表属于身份控制面读接口；这里显式走 Bearer + M-Policy，避免直接暴露 Core 身份表。
    .get('/actors', async ({ headers }) => {
      const auth = await requireActor(deps, headers)
      await authorize(deps, {
        actor: auth.actor,
        action: 'identity:read',
        resource: 'identity:actors',
        correlationId: auth.correlationId
      })

      const result = await deps.identity.listActors()
      if (!result.ok) {
        throw new CoreError(identityErrorStatus(result.error), result.error.code, result.error.message, auth.correlationId)
      }

      return { actors: result.value.map(toIdentityActorRecord) }
    }, {
      response: {
        200: t.Object({ actors: t.Array(identityActorSchema) }),
        401: apiErrorSchema,
        403: apiErrorSchema,
        503: apiErrorSchema
      },
      detail: protectedRouteDetail('List identity actors')
    })
    // actor 详情读取与 token 管理解耦，避免用 token inspect 替代 actor 元数据读取。
    .get('/actors/:id', async ({ params, headers }) => {
      const auth = await requireActor(deps, headers)
      await authorize(deps, {
        actor: auth.actor,
        action: 'identity:read',
        resource: `identity:actor:${params.id}`,
        correlationId: auth.correlationId
      })

      const result = await deps.identity.getActor(params.id)
      if (!result.ok) {
        throw new CoreError(identityErrorStatus(result.error), result.error.code, result.error.message, auth.correlationId)
      }
      if (result.value === null) {
        throw new CoreError(404, 'identity.actor.not_found', 'identity actor not found', auth.correlationId)
      }

      return { actor: toIdentityActorRecord(result.value) }
    }, {
      params: actorParamsSchema,
      response: {
        200: t.Object({ actor: identityActorSchema }),
        401: apiErrorSchema,
        403: apiErrorSchema,
        404: apiErrorSchema,
        503: apiErrorSchema
      },
      detail: protectedRouteDetail('Show one identity actor')
    })
    // token 签发在返回明文前先完成 M-Policy 与 Audit，确保高风险控制操作 fail-closed。
    .post('/tokens', async ({ body, headers, set }) => {
      if (!actorIds.includes(body.actor) || !body.ttl || !body.purpose) {
        throw new CoreError(400, 'identity.token.invalid_request', 'actor, ttl, and purpose are required')
      }
      const auth = await requireActor(deps, headers)
      const permission = await authorize(deps, {
        actor: auth.actor,
        action: 'identity:token-issue',
        resource: `identity:token-issue:${body.actor}`,
        correlationId: auth.correlationId
      })

      await writeIdentityAudit(deps, {
        actor: auth.actor,
        action: 'identity:token-issue',
        resource: `identity:token:${body.actor}`,
        decisionId: permission.id,
        result: permission.result,
        correlationId: auth.correlationId,
        payload: issueTokenAuditPayload({ targetActor: body.actor, ttl: body.ttl, purpose: body.purpose })
      })

      const issued = await deps.identity.issueToken({
        actor: body.actor,
        ttl: body.ttl,
        purpose: body.purpose,
        correlationId: auth.correlationId
      })
      if (!issued.ok) {
        throw new CoreError(identityErrorStatus(issued.error), issued.error.code, issued.error.message, auth.correlationId)
      }

      set.status = 201
      return {
        ...issued.value,
        issuer: 'meristem-local' as const,
        audience: 'meristem-core' as const,
        purpose: body.purpose,
        status: 'active' as const
      }
    }, {
      body: issueTokenBodySchema,
      response: {
        201: t.Object({
          jti: t.String(),
          token: t.String(),
          expiresAt: t.String(),
          actor: t.UnionEnum(actorIds),
          issuer: t.Literal('meristem-local'),
          audience: t.Literal('meristem-core'),
          purpose: t.String(),
          status: t.Literal('active')
        }),
        401: apiErrorSchema,
        403: apiErrorSchema,
        503: apiErrorSchema
      },
      detail: protectedRouteDetail('Issue an identity actor token')
    })
    // token inspect 返回元数据而不回放明文 token，避免控制面读接口泄漏签发结果。
    .get('/tokens/:jti', async ({ params, headers }) => {
      return inspectIdentityToken(deps, { jti: params.jti, headers })
    }, {
      params: tokenParamsSchema,
      response: {
        200: actorTokenSchema,
        401: apiErrorSchema,
        403: apiErrorSchema,
        404: apiErrorSchema,
        503: apiErrorSchema
      },
      detail: protectedRouteDetail('Inspect identity token metadata')
    })
    // token revoke 与 issue 一样必须先写 Audit，再执行状态变更，保证审计事实先于突变落地。
    .post('/tokens/:jti/revoke', async ({ params, body, headers }) => {
      return revokeIdentityToken(deps, { jti: params.jti, reason: body.reason, headers })
    }, {
      params: tokenParamsSchema,
      body: revokeTokenBodySchema,
      response: {
        200: t.Object({
          jti: t.String(),
          status: t.Literal('revoked'),
          revokedAt: t.String(),
          revokedBy: t.UnionEnum(actorIds),
          revokeReason: t.String(),
          token: t.Object({
            jti: t.String(),
            status: t.Literal('revoked'),
            revokedAt: t.String(),
            revokedBy: t.UnionEnum(actorIds),
            revokeReason: t.String()
          })
        }),
        401: apiErrorSchema,
        403: apiErrorSchema,
        404: apiErrorSchema,
        503: apiErrorSchema
      },
      detail: protectedRouteDetail('Revoke an identity token')
    })

  return new Elysia()
    .use(externalIdentity)
    // 兼容现有测试里的绝对 URL 写法，保留 /v0 只读别名，不改变正式 /api/v0 契约。
    .get('/v0/identity/tokens/:jti', async ({ params, headers }) => {
      return inspectIdentityToken(deps, { jti: params.jti, headers })
    }, {
      params: tokenParamsSchema,
      response: {
        200: actorTokenSchema,
        401: apiErrorSchema,
        403: apiErrorSchema,
        404: apiErrorSchema,
        503: apiErrorSchema
      },
      detail: protectedRouteDetail('Inspect identity token metadata alias')
    })
    .post('/v0/identity/tokens/:jti/revoke', async ({ params, body, headers }) => {
      return revokeIdentityToken(deps, { jti: params.jti, reason: body.reason, headers })
    }, {
      params: tokenParamsSchema,
      body: revokeTokenBodySchema,
      response: {
        200: t.Object({
          jti: t.String(),
          status: t.Literal('revoked'),
          revokedAt: t.String(),
          revokedBy: t.UnionEnum(actorIds),
          revokeReason: t.String(),
          token: t.Object({
            jti: t.String(),
            status: t.Literal('revoked'),
            revokedAt: t.String(),
            revokedBy: t.UnionEnum(actorIds),
            revokeReason: t.String()
          })
        }),
        401: apiErrorSchema,
        403: apiErrorSchema,
        404: apiErrorSchema,
        503: apiErrorSchema
      },
      detail: protectedRouteDetail('Revoke an identity token alias')
    })
    // 内部 introspection 只信任共享 internal token，并且在任何后端失败时都回落为 inactive。
    .post('/internal/v0/identity/tokens/introspect', async ({ body, headers, set }) => {
      const internalAuth = validateIdentityInternalRequest(headers)
      if (!internalAuth.ok) {
        set.status = internalAuth.error.code === 'internal.unavailable' ? 503 : 401
        return { error: internalAuth.error }
      }

      const result = await deps.identity.introspect(body.jti)
      if (!result.ok) {
        return { jti: body.jti, active: false }
      }

      if (result.value.jti) {
        return {
          jti: result.value.jti,
          active: result.value.active,
          ...(result.value.actor ? { actor: result.value.actor as ActorId } : {})
        }
      }

      return {
        jti: body.jti,
        active: result.value.active,
        ...(result.value.actor ? { actor: result.value.actor as ActorId } : {})
      }
    }, {
      body: internalIntrospectionBodySchema,
      response: {
        200: t.Object({
          jti: t.Optional(t.String()),
          active: t.Boolean(),
          actor: t.Optional(t.UnionEnum(actorIds))
        }),
        401: apiErrorSchema,
        503: apiErrorSchema
      },
      detail: { summary: 'Internal identity token introspection' }
    })
}
