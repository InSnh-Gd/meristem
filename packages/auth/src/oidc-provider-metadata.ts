import type { OidcAuthProviderConfigFromSchema } from '../../contracts/src/index.ts'

export const oidcSupportedAlgorithms = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384'] as const
export const defaultClockToleranceSeconds = 30
export const defaultJwksRefreshIntervalMs = 60_000
export const defaultJwksTtlMs = 300_000
export type OidcSupportedAlgorithm = (typeof oidcSupportedAlgorithms)[number]
export type OidcActorSession = {
  subject: string
  groups: readonly string[]
  issuer: string
  expiresAt: string
  displayName?: string
  email?: string
  audience?: string
}
export type OidcLocalIamPrincipalClaims = {
  oidcIssuer: string
  oidcSubject: string
  upstreamGroups: readonly string[]
  expiresAt: string
  displayName?: string
  email?: string
  audience?: string
}
export type OidcDiscoveryDocument = {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  jwksUri: string
}
export type OidcRedactedLogContext = {
  token?: '[redacted]'
  claims?: '[redacted]'
  session?: OidcActorSession
}
export type OidcTokenState = 'active' | 'revoked' | 'introspection_required'
export type OidcDiscoveryFailure = {
  ok: false
  code: 'invalid_discovery'
  message: string
  field?: 'issuer' | 'authorization_endpoint' | 'token_endpoint' | 'jwks_uri'
}
export type OidcBadIssuerFailure = { ok: false; code: 'bad_issuer'; message: string }
export type OidcBadAudienceFailure = { ok: false; code: 'bad_audience'; message: string }
export type OidcUnsupportedAlgorithmFailure = {
  ok: false
  code: 'unsupported_algorithm'
  message: string
  algorithm?: string
}
export type OidcExpiredTokenFailure = { ok: false; code: 'expired_token'; message: string }
export type OidcMissingClaimFailure = {
  ok: false
  code: 'missing_claim'
  message: string
  claim: string
}
export type OidcStaleJwksFailure = {
  ok: false
  code: 'stale_jwks'
  message: string
  cacheAgeMs?: number
}
export type OidcRevokedTokenFailure = { ok: false; code: 'revoked_token'; message: string }
export type OidcIntrospectionRequiredFailure = {
  ok: false
  code: 'introspection_required'
  message: string
}
export type OidcInvalidTokenFailure = { ok: false; code: 'invalid_token'; message: string }
export type OidcAuthFailure =
  | OidcDiscoveryFailure
  | OidcBadIssuerFailure
  | OidcBadAudienceFailure
  | OidcUnsupportedAlgorithmFailure
  | OidcExpiredTokenFailure
  | OidcMissingClaimFailure
  | OidcStaleJwksFailure
  | OidcRevokedTokenFailure
  | OidcIntrospectionRequiredFailure
  | OidcInvalidTokenFailure
export type OidcVerifyResult = { ok: true; session: OidcActorSession } | OidcAuthFailure
export type OidcDiscoveryResult =
  | { ok: true; configuration: OidcDiscoveryDocument }
  | OidcDiscoveryFailure
export type VerifyOidcAccessTokenInput = {
  token: string
  checkTokenState?: (session: OidcActorSession) => Promise<OidcTokenState>
}
export type OidcProviderDependencies = {
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  now?: () => Date
}
export type ClaimsMapping = {
  subjectClaim: string
  groupsClaim: string
  displayNameClaim?: string | undefined
  emailClaim?: string | undefined
  audienceClaim?: string | undefined
}
export type ProviderConfig = {
  issuer: string
  discoveryUrl: string
  audiences: readonly string[]
  allowedAlgorithms: readonly OidcSupportedAlgorithm[]
  claims: ClaimsMapping
  clockToleranceSeconds: number
  jwksRefreshIntervalMs: number
  jwksTtlMs: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
export function isSupportedAlgorithm(value: string): value is OidcSupportedAlgorithm {
  return (oidcSupportedAlgorithms as readonly string[]).includes(value)
}
function normalizeDiscoveryUrl(issuer: string, discoveryUrl?: string): string {
  if (discoveryUrl) return new URL(discoveryUrl).toString()
  const issuerUrl = new URL(issuer)
  const issuerPath = issuerUrl.pathname.replace(/\/$/, '')
  issuerUrl.pathname =
    issuerPath.length === 0
      ? '/.well-known/openid-configuration'
      : `/.well-known/openid-configuration${issuerPath}`
  return issuerUrl.toString()
}
/** 配置在 schema 之后收敛语义，避免空 allowlist 或异常 TTL 进入认证路径。 */
export function normalizeProviderConfig(config: OidcAuthProviderConfigFromSchema): ProviderConfig {
  if (config.audiences.length === 0) throw new Error('OIDC audiences must not be empty')
  const configuredAlgorithms = config.allowedAlgorithms ?? [...oidcSupportedAlgorithms]
  if (configuredAlgorithms.length === 0) throw new Error('OIDC allowedAlgorithms must not be empty')
  for (const algorithm of configuredAlgorithms)
    if (!isSupportedAlgorithm(algorithm))
      throw new Error(`OIDC algorithm is not supported: ${algorithm}`)
  const refreshIntervalMs = config.jwksCache?.refreshIntervalMs ?? defaultJwksRefreshIntervalMs
  const ttlMs = config.jwksCache?.ttlMs ?? defaultJwksTtlMs
  if (!Number.isFinite(refreshIntervalMs) || refreshIntervalMs <= 0)
    throw new Error('OIDC jwksCache.refreshIntervalMs must be a positive number')
  if (!Number.isFinite(ttlMs) || ttlMs <= 0)
    throw new Error('OIDC jwksCache.ttlMs must be a positive number')
  if (refreshIntervalMs > ttlMs)
    throw new Error('OIDC jwksCache.refreshIntervalMs must be less than or equal to ttlMs')
  const clockToleranceSeconds = config.clockToleranceSeconds ?? defaultClockToleranceSeconds
  if (!Number.isFinite(clockToleranceSeconds) || clockToleranceSeconds < 0)
    throw new Error('OIDC clockToleranceSeconds must be zero or positive')
  return {
    issuer: config.issuer,
    discoveryUrl: normalizeDiscoveryUrl(config.issuer, config.discoveryUrl),
    audiences: [...config.audiences],
    allowedAlgorithms: [...configuredAlgorithms],
    claims: {
      subjectClaim: config.claims?.subjectClaim ?? 'sub',
      groupsClaim: config.claims?.groupsClaim ?? 'groups',
      displayNameClaim: config.claims?.displayNameClaim ?? 'preferred_username',
      emailClaim: config.claims?.emailClaim ?? 'email',
      audienceClaim: config.claims?.audienceClaim ?? 'aud'
    },
    clockToleranceSeconds,
    jwksRefreshIntervalMs: refreshIntervalMs,
    jwksTtlMs: ttlMs
  }
}
function invalidDiscovery(
  field: OidcDiscoveryFailure['field'],
  message: string
): OidcDiscoveryFailure {
  return field === undefined
    ? { ok: false, code: 'invalid_discovery', message }
    : { ok: false, code: 'invalid_discovery', field, message }
}
function validateAbsoluteUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    return new URL(value).toString()
  } catch {
    return null
  }
}
/** discovery 文档必须完整给出 issuer / authorization / token / jwks 四个关键入口。 */
export function validateDiscoveryDocument(issuer: string, payload: unknown): OidcDiscoveryResult {
  if (!isRecord(payload))
    return invalidDiscovery('issuer', 'OIDC discovery document must be an object')
  if (payload.issuer !== issuer)
    return invalidDiscovery('issuer', 'OIDC discovery issuer must exactly match configured issuer')
  const authorizationEndpoint = validateAbsoluteUrl(payload.authorization_endpoint)
  if (!authorizationEndpoint)
    return invalidDiscovery('authorization_endpoint', 'OIDC authorization endpoint is required')
  const tokenEndpoint = validateAbsoluteUrl(payload.token_endpoint)
  if (!tokenEndpoint) return invalidDiscovery('token_endpoint', 'OIDC token endpoint is required')
  const jwksUri = validateAbsoluteUrl(payload.jwks_uri)
  if (!jwksUri) return invalidDiscovery('jwks_uri', 'OIDC JWKS URI is required')
  return { ok: true, configuration: { issuer, authorizationEndpoint, tokenEndpoint, jwksUri } }
}
export function isOidcFailure<TSuccess>(
  value: TSuccess | OidcAuthFailure
): value is OidcAuthFailure {
  return isRecord(value) && value.ok === false && typeof value.code === 'string'
}
export function redactOidcAuthMaterial(input: {
  token?: string
  claims?: unknown
  session?: OidcActorSession
}): OidcRedactedLogContext {
  return {
    ...(input.token ? { token: '[redacted]' } : {}),
    ...(input.claims !== undefined ? { claims: '[redacted]' } : {}),
    ...(input.session
      ? {
          session: {
            subject: input.session.subject,
            groups: [...input.session.groups],
            issuer: input.session.issuer,
            expiresAt: input.session.expiresAt
          }
        }
      : {})
  }
}
