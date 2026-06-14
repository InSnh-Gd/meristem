import * as Schema from 'effect/Schema'
import { actorIds } from '../literals.ts'

// ActorId is a boundary literal because auth, policy, audit, and BFF session views all share it.
// Source: docs/plans/2026-05-23-effect-projection-hardening.md §2.2
export const ActorIdSchema = Schema.Literal(...actorIds)
export type ActorIdFromSchema = typeof ActorIdSchema.Type

export const IdentityActorStatusSchema = Schema.Literal('active', 'disabled')
export type IdentityActorStatusFromSchema = typeof IdentityActorStatusSchema.Type

export const IdentityTokenStatusSchema = Schema.Literal('active', 'revoked', 'expired')
export type IdentityTokenStatusFromSchema = typeof IdentityTokenStatusSchema.Type

export const IdentityAudienceSchema = Schema.Literal('meristem-core', 'meristem-service')
export type IdentityAudienceFromSchema = typeof IdentityAudienceSchema.Type

export const IdentityActorV02Schema = Schema.Struct({
  id: ActorIdSchema,
  displayName: Schema.String,
  status: IdentityActorStatusSchema,
  createdAt: Schema.String,
  updatedAt: Schema.String
})
export type IdentityActorV02FromSchema = typeof IdentityActorV02Schema.Type

export const ActorTokenV02Schema = Schema.Struct({
  jti: Schema.String,
  actor: ActorIdSchema,
  issuer: Schema.Literal('meristem-local'),
  audience: IdentityAudienceSchema,
  issuedAt: Schema.String,
  expiresAt: Schema.String,
  issuedBy: ActorIdSchema,
  purpose: Schema.String,
  status: IdentityTokenStatusSchema,
  revokedAt: Schema.optional(Schema.String),
  revokedBy: Schema.optional(ActorIdSchema),
  revokeReason: Schema.optional(Schema.String)
})
export type ActorTokenV02FromSchema = typeof ActorTokenV02Schema.Type

export const TokenIntrospectionResultSchema = Schema.Struct({
  active: Schema.Boolean,
  actor: Schema.optional(ActorIdSchema),
  jti: Schema.optional(Schema.String),
  status: Schema.optional(IdentityTokenStatusSchema),
  expiresAt: Schema.optional(Schema.String)
})
export type TokenIntrospectionResultFromSchema = typeof TokenIntrospectionResultSchema.Type

// 身份控制面路径需要集中导出，避免 CLI、Core 路由和后续 M-* 客户端各自硬编码。
export const identityApiRoutes = {
  listActors: '/api/v0/identity/actors',
  getActor: '/api/v0/identity/actors/:id',
  issueToken: '/api/v0/identity/tokens',
  inspectToken: '/api/v0/identity/tokens/:jti',
  revokeToken: '/api/v0/identity/tokens/:jti/revoke',
  introspectToken: '/api/v0/identity/introspect'
} as const

// Eden 侧只承载 HTTP path 形状；外部公开能力仍以 REST/OpenAPI 为源。
export const identityEdenV02Contract = {
  listActors: `GET ${identityApiRoutes.listActors}`,
  getActor: `GET ${identityApiRoutes.getActor}`,
  issueToken: `POST ${identityApiRoutes.issueToken}`,
  inspectToken: `GET ${identityApiRoutes.inspectToken}`,
  revokeToken: `POST ${identityApiRoutes.revokeToken}`,
  introspectToken: `POST ${identityApiRoutes.introspectToken}`
} as const

export const IdentityActorParamsSchema = Schema.Struct({
  id: ActorIdSchema
})
export type IdentityActorParamsFromSchema = typeof IdentityActorParamsSchema.Type

export const ActorTokenParamsSchema = Schema.Struct({
  jti: Schema.String
})
export type ActorTokenParamsFromSchema = typeof ActorTokenParamsSchema.Type

export const IssueActorTokenRequestSchema = Schema.Struct({
  actor: ActorIdSchema,
  audience: Schema.optional(IdentityAudienceSchema),
  expiresIn: Schema.optional(Schema.String),
  purpose: Schema.String
})
export type IssueActorTokenRequestFromSchema = typeof IssueActorTokenRequestSchema.Type

export const IssueActorTokenResponseSchema = Schema.Struct({
  token: Schema.String,
  metadata: ActorTokenV02Schema
})
export type IssueActorTokenResponseFromSchema = typeof IssueActorTokenResponseSchema.Type

export const IssueActorTokenRouteResponseSchema = Schema.Struct({
  jti: Schema.String,
  token: Schema.String,
  expiresAt: Schema.String,
  actor: ActorIdSchema,
  issuer: Schema.Literal('meristem-local'),
  audience: Schema.Literal('meristem-core'),
  purpose: Schema.String,
  status: Schema.Literal('active')
})
export type IssueActorTokenRouteResponseFromSchema = typeof IssueActorTokenRouteResponseSchema.Type

export const IdentityActorListResponseSchema = Schema.Struct({
  actors: Schema.Array(IdentityActorV02Schema)
})
export type IdentityActorListResponseFromSchema = typeof IdentityActorListResponseSchema.Type

export const IdentityActorDetailResponseSchema = Schema.Struct({
  actor: IdentityActorV02Schema
})
export type IdentityActorDetailResponseFromSchema = typeof IdentityActorDetailResponseSchema.Type

export const InspectActorTokenResponseSchema = Schema.Struct({
  token: ActorTokenV02Schema
})
export type InspectActorTokenResponseFromSchema = typeof InspectActorTokenResponseSchema.Type

export const RevokeActorTokenRequestSchema = Schema.Struct({
  reason: Schema.String
})
export type RevokeActorTokenRequestFromSchema = typeof RevokeActorTokenRequestSchema.Type

export const RevokeActorTokenResponseSchema = Schema.Struct({
  token: ActorTokenV02Schema
})
export type RevokeActorTokenResponseFromSchema = typeof RevokeActorTokenResponseSchema.Type

export const RevokedActorTokenSummarySchema = Schema.Struct({
  jti: Schema.String,
  status: Schema.Literal('revoked'),
  revokedAt: Schema.String,
  revokedBy: ActorIdSchema,
  revokeReason: Schema.String
})
export type RevokedActorTokenSummaryFromSchema = typeof RevokedActorTokenSummarySchema.Type

export const RevokeActorTokenCompatResponseSchema = Schema.Struct({
  jti: Schema.String,
  status: Schema.Literal('revoked'),
  revokedAt: Schema.String,
  revokedBy: ActorIdSchema,
  revokeReason: Schema.String,
  token: RevokedActorTokenSummarySchema
})
export type RevokeActorTokenCompatResponseFromSchema =
  typeof RevokeActorTokenCompatResponseSchema.Type

export const TokenIntrospectionRequestSchema = Schema.Struct({
  token: Schema.String
})
export type TokenIntrospectionRequestFromSchema = typeof TokenIntrospectionRequestSchema.Type

export const InternalTokenIntrospectionResponseSchema = Schema.Struct({
  jti: Schema.optional(Schema.String),
  active: Schema.Boolean,
  actor: Schema.optional(ActorIdSchema)
})
export type InternalTokenIntrospectionResponseFromSchema =
  typeof InternalTokenIntrospectionResponseSchema.Type
