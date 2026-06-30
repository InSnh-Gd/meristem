import * as Schema from 'effect/Schema'

const NonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1))

/**
 * OIDC/JWKS provider 目前只接受明确 allowlist 的非对称签名算法。
 */
export const OidcSupportedAlgorithmSchema = Schema.Literal(
  'RS256',
  'RS384',
  'RS512',
  'ES256',
  'ES384'
)
export type OidcSupportedAlgorithmFromSchema = typeof OidcSupportedAlgorithmSchema.Type

/**
 * 本地开发 provider 只表示 HS256 本地种子 JWT 模式，不承载生产 OIDC 配置。
 */
export const LocalDevAuthProviderConfigSchema = Schema.Struct({
  provider: Schema.Literal('local-dev')
})
export type LocalDevAuthProviderConfigFromSchema = typeof LocalDevAuthProviderConfigSchema.Type

/**
 * OIDC claims mapper 只允许声明需要映射的字段名，避免把原始 claims 结构扩散到调用方。
 */
export const OidcClaimsMappingSchema = Schema.Struct({
  subjectClaim: Schema.optional(NonEmptyStringSchema),
  groupsClaim: Schema.optional(NonEmptyStringSchema)
})
export type OidcClaimsMappingFromSchema = typeof OidcClaimsMappingSchema.Type

/**
 * JWKS cache 使用 refresh interval + hard TTL，支撑 stale-while-revalidate 语义。
 */
export const OidcJwksCachePolicySchema = Schema.Struct({
  refreshIntervalMs: Schema.optional(Schema.Number),
  ttlMs: Schema.optional(Schema.Number)
})
export type OidcJwksCachePolicyFromSchema = typeof OidcJwksCachePolicySchema.Type

/**
 * 生产 OIDC provider runtime config。
 *
 * - `issuer` 是唯一信任根。
 * - `discoveryUrl` 允许 issuer 带 path 或私有 discovery endpoint 时显式覆盖。
 * - `audiences` / `allowedAlgorithms` 都必须在运行时进一步做非空校验。
 */
export const OidcAuthProviderConfigSchema = Schema.Struct({
  provider: Schema.Literal('oidc'),
  issuer: NonEmptyStringSchema,
  discoveryUrl: Schema.optional(NonEmptyStringSchema),
  audiences: Schema.Array(NonEmptyStringSchema),
  allowedAlgorithms: Schema.optional(Schema.Array(OidcSupportedAlgorithmSchema)),
  claims: Schema.optional(OidcClaimsMappingSchema),
  jwksCache: Schema.optional(OidcJwksCachePolicySchema),
  clockToleranceSeconds: Schema.optional(Schema.Number)
})
export type OidcAuthProviderConfigFromSchema = typeof OidcAuthProviderConfigSchema.Type

/**
 * Auth runtime config 明确区分 local-dev 与 oidc provider，避免生产环境继续把本地模式当隐式默认值。
 */
export const AuthProviderRuntimeConfigSchema = Schema.Union(
  LocalDevAuthProviderConfigSchema,
  OidcAuthProviderConfigSchema
)
export type AuthProviderRuntimeConfigFromSchema = typeof AuthProviderRuntimeConfigSchema.Type
