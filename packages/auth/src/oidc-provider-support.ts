import { fromUnixTime } from 'date-fns'
import {
  createLocalJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
  type JWTVerifyResult
} from 'jose'
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

export type OidcBadIssuerFailure = {
  ok: false
  code: 'bad_issuer'
  message: string
}

export type OidcBadAudienceFailure = {
  ok: false
  code: 'bad_audience'
  message: string
}

export type OidcUnsupportedAlgorithmFailure = {
  ok: false
  code: 'unsupported_algorithm'
  message: string
  algorithm?: string
}

export type OidcExpiredTokenFailure = {
  ok: false
  code: 'expired_token'
  message: string
}

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

export type OidcRevokedTokenFailure = {
  ok: false
  code: 'revoked_token'
  message: string
}

export type OidcIntrospectionRequiredFailure = {
  ok: false
  code: 'introspection_required'
  message: string
}

export type OidcInvalidTokenFailure = {
  ok: false
  code: 'invalid_token'
  message: string
}

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

export type OidcVerifyResult =
  | {
      ok: true
      session: OidcActorSession
    }
  | OidcAuthFailure

export type OidcDiscoveryResult =
  | {
      ok: true
      configuration: OidcDiscoveryDocument
    }
  | OidcDiscoveryFailure

export type VerifyOidcAccessTokenInput = {
  token: string
  checkTokenState?: (session: OidcActorSession) => Promise<OidcTokenState>
}

export type OidcProviderDependencies = {
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  now?: () => Date
}

export type CachedJwks = {
  jwks: JSONWebKeySet
  keySet: ReturnType<typeof createLocalJWKSet>
  fetchedAtMs: number
  refreshAfterMs: number
  expiresAtMs: number
}

export type ClaimsMapping = {
  subjectClaim: string
  groupsClaim: string
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
  if (discoveryUrl) {
    return new URL(discoveryUrl).toString()
  }

  const issuerUrl = new URL(issuer)
  const issuerPath = issuerUrl.pathname.replace(/\/$/, '')
  issuerUrl.pathname = issuerPath.length === 0
    ? '/.well-known/openid-configuration'
    : `/.well-known/openid-configuration${issuerPath}`
  return issuerUrl.toString()
}

/**
 * 运行时配置在 schema 之外继续做语义收敛，避免空 allowlist 或异常 TTL 悄悄进入生产路径。
 */
export function normalizeProviderConfig(config: OidcAuthProviderConfigFromSchema): ProviderConfig {
  if (config.audiences.length === 0) {
    throw new Error('OIDC audiences must not be empty')
  }

  const configuredAlgorithms = config.allowedAlgorithms ?? [...oidcSupportedAlgorithms]
  if (configuredAlgorithms.length === 0) {
    throw new Error('OIDC allowedAlgorithms must not be empty')
  }

  for (const algorithm of configuredAlgorithms) {
    if (!isSupportedAlgorithm(algorithm)) {
      throw new Error(`OIDC algorithm is not supported: ${algorithm}`)
    }
  }

  const refreshIntervalMs = config.jwksCache?.refreshIntervalMs ?? defaultJwksRefreshIntervalMs
  const ttlMs = config.jwksCache?.ttlMs ?? defaultJwksTtlMs
  if (!Number.isFinite(refreshIntervalMs) || refreshIntervalMs <= 0) {
    throw new Error('OIDC jwksCache.refreshIntervalMs must be a positive number')
  }
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error('OIDC jwksCache.ttlMs must be a positive number')
  }
  if (refreshIntervalMs > ttlMs) {
    throw new Error('OIDC jwksCache.refreshIntervalMs must be less than or equal to ttlMs')
  }

  const clockToleranceSeconds = config.clockToleranceSeconds ?? defaultClockToleranceSeconds
  if (!Number.isFinite(clockToleranceSeconds) || clockToleranceSeconds < 0) {
    throw new Error('OIDC clockToleranceSeconds must be zero or positive')
  }

  return {
    issuer: config.issuer,
    discoveryUrl: normalizeDiscoveryUrl(config.issuer, config.discoveryUrl),
    audiences: [...config.audiences],
    allowedAlgorithms: [...configuredAlgorithms],
    claims: {
      subjectClaim: config.claims?.subjectClaim ?? 'sub',
      groupsClaim: config.claims?.groupsClaim ?? 'groups'
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
  if (typeof value !== 'string') {
    return null
  }

  try {
    return new URL(value).toString()
  } catch {
    return null
  }
}

/**
 * discovery 文档必须完整给出 issuer / authorization / token / jwks 四个关键入口。
 */
export function validateDiscoveryDocument(
  issuer: string,
  payload: unknown
): OidcDiscoveryResult {
  if (!isRecord(payload)) {
    return invalidDiscovery('issuer', 'OIDC discovery document must be an object')
  }

  if (payload.issuer !== issuer) {
    return invalidDiscovery('issuer', 'OIDC discovery issuer must exactly match configured issuer')
  }

  const authorizationEndpoint = validateAbsoluteUrl(payload.authorization_endpoint)
  if (!authorizationEndpoint) {
    return invalidDiscovery('authorization_endpoint', 'OIDC authorization endpoint is required')
  }

  const tokenEndpoint = validateAbsoluteUrl(payload.token_endpoint)
  if (!tokenEndpoint) {
    return invalidDiscovery('token_endpoint', 'OIDC token endpoint is required')
  }

  const jwksUri = validateAbsoluteUrl(payload.jwks_uri)
  if (!jwksUri) {
    return invalidDiscovery('jwks_uri', 'OIDC JWKS URI is required')
  }

  return {
    ok: true,
    configuration: {
      issuer,
      authorizationEndpoint,
      tokenEndpoint,
      jwksUri
    }
  }
}

function missingClaim(claim: string): OidcMissingClaimFailure {
  return {
    ok: false,
    code: 'missing_claim',
    claim,
    message: `OIDC token is missing required claim: ${claim}`
  }
}

function mapGroupsClaim(value: unknown, claimName: string): readonly string[] | OidcMissingClaimFailure {
  if (typeof value === 'string') {
    return [value]
  }

  if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
    return [...value]
  }

  return missingClaim(claimName)
}

/**
 * claims mapper 只暴露 subject / groups / issuer / expiry，禁止把原始 token claims 继续带出 provider。
 */
export function mapVerifiedPayloadToSession(
  payload: JWTPayload,
  claims: ClaimsMapping
): OidcActorSession | OidcMissingClaimFailure {
  const subjectValue = payload[claims.subjectClaim]
  if (typeof subjectValue !== 'string' || subjectValue.length === 0) {
    return missingClaim(claims.subjectClaim)
  }

  const groups = mapGroupsClaim(payload[claims.groupsClaim], claims.groupsClaim)
  if (isOidcFailure(groups)) {
    return groups
  }

  if (typeof payload.iss !== 'string') {
    return missingClaim('iss')
  }

  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    return missingClaim('exp')
  }

  return {
    subject: subjectValue,
    groups,
    issuer: payload.iss,
    expiresAt: fromUnixTime(payload.exp).toISOString()
  }
}

/**
 * jose 的 claim 失败要收敛到 Meristem 的显式错误码，供调用方做 fail-closed 分支。
 */
export function mapClaimValidationFailure(token: string, error: unknown): OidcAuthFailure {
  const errorName = error instanceof Error ? error.name : ''
  const claim = isRecord(error) && typeof error.claim === 'string' ? error.claim : undefined

  if (errorName === 'JWTExpired') {
    return { ok: false, code: 'expired_token', message: 'OIDC access token has expired' }
  }

  const payload = (() => {
    try {
      return decodeJwt(token)
    } catch {
      return null
    }
  })()

  if (claim === 'iss') {
    if (!payload || typeof payload.iss !== 'string') {
      return missingClaim('iss')
    }
    return { ok: false, code: 'bad_issuer', message: 'OIDC access token issuer is not allowed' }
  }

  if (claim === 'aud') {
    if (!payload || payload.aud === undefined) {
      return missingClaim('aud')
    }
    return { ok: false, code: 'bad_audience', message: 'OIDC access token audience is not allowed' }
  }

  if (claim === 'exp') {
    if (!payload || typeof payload.exp !== 'number') {
      return missingClaim('exp')
    }
    return { ok: false, code: 'expired_token', message: 'OIDC access token has expired' }
  }

  return {
    ok: false,
    code: 'invalid_token',
    message: error instanceof Error ? error.message : 'OIDC access token verification failed'
  }
}

export function cacheAgeMs(cache: CachedJwks | null, nowMs: number): number | undefined {
  return cache ? nowMs - cache.fetchedAtMs : undefined
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

export function readProtectedAlgorithm(token: string): string | null {
  try {
    const protectedHeader = decodeProtectedHeader(token)
    return typeof protectedHeader.alg === 'string' ? protectedHeader.alg : null
  } catch {
    return null
  }
}

export async function verifyJwtWithJwks(input: {
  token: string
  jwks: CachedJwks
  config: ProviderConfig
  nowMs: number
}): Promise<JWTVerifyResult<JWTPayload> | OidcAuthFailure> {
  try {
    return await jwtVerify(input.token, input.jwks.keySet, {
      issuer: input.config.issuer,
      audience: [...input.config.audiences],
      algorithms: [...input.config.allowedAlgorithms],
      clockTolerance: input.config.clockToleranceSeconds,
      currentDate: new Date(input.nowMs)
    })
  } catch (error) {
    return mapClaimValidationFailure(input.token, error)
  }
}
