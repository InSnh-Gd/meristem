import { t } from 'elysia'
import type { ActorId } from '../../../../packages/contracts/src/index.ts'
import { actorIds } from '../../../../packages/contracts/src/index.ts'

export type IdentityActorRecord = {
  id: ActorId
  displayName: string
  status: 'active' | 'disabled'
  createdAt: string
  updatedAt: string
}

export type IdentityTokenRecord = {
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

export const identityActorSchema = t.Object({
  id: t.UnionEnum(actorIds),
  displayName: t.String(),
  status: t.Union([t.Literal('active'), t.Literal('disabled')]),
  createdAt: t.String(),
  updatedAt: t.String()
})

export const actorTokenSchema = t.Object({
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

export const issueTokenBodySchema = t.Object({
  actor: t.UnionEnum(actorIds),
  ttl: t.String({ minLength: 1 }),
  purpose: t.String({ minLength: 1 })
})

export const revokeTokenBodySchema = t.Object({
  reason: t.String({ minLength: 1 })
})

export const tokenParamsSchema = t.Object({
  jti: t.String({ minLength: 1 })
})

export const actorParamsSchema = t.Object({
  id: t.UnionEnum(actorIds)
})

export const internalIntrospectionBodySchema = t.Object({
  jti: t.String({ minLength: 1 })
})

export const identityActorsResponseSchema = t.Object({
  actors: t.Array(identityActorSchema)
})

export const identityActorResponseSchema = t.Object({
  actor: identityActorSchema
})

export const issueTokenResponseSchema = t.Object({
  jti: t.String(),
  token: t.String(),
  expiresAt: t.String(),
  actor: t.UnionEnum(actorIds),
  issuer: t.Literal('meristem-local'),
  audience: t.Literal('meristem-core'),
  purpose: t.String(),
  status: t.Literal('active')
})

export const revokeTokenResponseSchema = t.Object({
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
})

export const internalIntrospectionResponseSchema = t.Object({
  jti: t.Optional(t.String()),
  active: t.Boolean(),
  actor: t.Optional(t.UnionEnum(actorIds))
})
