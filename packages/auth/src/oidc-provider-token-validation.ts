import { fromUnixTime } from 'date-fns'
import {
  type createLocalJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  type JSONWebKeySet,
  type JWTPayload,
  type JWTVerifyResult,
  jwtVerify
} from 'jose'
import type {
  ClaimsMapping,
  OidcActorSession,
  OidcAuthFailure,
  OidcLocalIamPrincipalClaims,
  OidcMissingClaimFailure,
  ProviderConfig
} from './oidc-provider-metadata.ts'
import { isOidcFailure } from './oidc-provider-metadata.ts'

export type CachedJwks = {
  jwks: JSONWebKeySet
  keySet: ReturnType<typeof createLocalJWKSet>
  fetchedAtMs: number
  refreshAfterMs: number
  expiresAtMs: number
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
function missingClaim(claim: string): OidcMissingClaimFailure {
  return {
    ok: false,
    code: 'missing_claim',
    claim,
    message: `OIDC token is missing required claim: ${claim}`
  }
}
function mapGroupsClaim(
  value: unknown,
  claimName: string
): readonly string[] | OidcMissingClaimFailure {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return [...value]
  return missingClaim(claimName)
}
function getClaimPath(payload: JWTPayload, claimPath: string): unknown {
  let current: unknown = payload
  for (const segment of claimPath.split('.')) {
    if (!isRecord(current) || !(segment in current)) return undefined
    current = current[segment]
  }
  return current
}
function optionalStringClaim(
  payload: JWTPayload,
  claimPath: string | undefined
): string | undefined {
  if (!claimPath) return undefined
  const value = getClaimPath(payload, claimPath)
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
function mapAudienceClaim(payload: JWTPayload, claimPath: string | undefined): string | undefined {
  const value = claimPath ? getClaimPath(payload, claimPath) : payload.aud
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const first = value.find(item => typeof item === 'string')
    return typeof first === 'string' ? first : undefined
  }
  return undefined
}
/** claims mapper 只输出安全会话字段，禁止将原始 token claims 带出 provider。 */
export function mapVerifiedPayloadToSession(
  payload: JWTPayload,
  claims: ClaimsMapping
): OidcActorSession | OidcMissingClaimFailure {
  const subjectValue = getClaimPath(payload, claims.subjectClaim)
  if (typeof subjectValue !== 'string' || subjectValue.length === 0)
    return missingClaim(claims.subjectClaim)
  const groups = mapGroupsClaim(getClaimPath(payload, claims.groupsClaim), claims.groupsClaim)
  if (isOidcFailure(groups)) return groups
  if (typeof payload.iss !== 'string') return missingClaim('iss')
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return missingClaim('exp')
  const displayName = optionalStringClaim(payload, claims.displayNameClaim)
  const email = optionalStringClaim(payload, claims.emailClaim)
  const audience = mapAudienceClaim(payload, claims.audienceClaim)
  return {
    subject: subjectValue,
    groups,
    issuer: payload.iss,
    expiresAt: fromUnixTime(payload.exp).toISOString(),
    ...(displayName ? { displayName } : {}),
    ...(email ? { email } : {}),
    ...(audience ? { audience } : {})
  }
}
export function oidcSessionToLocalIamClaims(
  session: OidcActorSession
): OidcLocalIamPrincipalClaims {
  return {
    oidcIssuer: session.issuer,
    oidcSubject: session.subject,
    upstreamGroups: [...session.groups],
    expiresAt: session.expiresAt,
    ...(session.displayName ? { displayName: session.displayName } : {}),
    ...(session.email ? { email: session.email } : {}),
    ...(session.audience ? { audience: session.audience } : {})
  }
}
/** jose 校验失败被收敛为明确错误码，供调用方 fail-closed。 */
export function mapClaimValidationFailure(token: string, error: unknown): OidcAuthFailure {
  const errorName = error instanceof Error ? error.name : ''
  const claim = isRecord(error) && typeof error.claim === 'string' ? error.claim : undefined
  if (errorName === 'JWTExpired')
    return { ok: false, code: 'expired_token', message: 'OIDC access token has expired' }
  let payload: JWTPayload | null = null
  try {
    payload = decodeJwt<JWTPayload>(token)
  } catch {
    payload = null
  }
  if (claim === 'iss')
    return !payload || typeof payload.iss !== 'string'
      ? missingClaim('iss')
      : { ok: false, code: 'bad_issuer', message: 'OIDC access token issuer is not allowed' }
  if (claim === 'aud')
    return !payload || payload.aud === undefined
      ? missingClaim('aud')
      : { ok: false, code: 'bad_audience', message: 'OIDC access token audience is not allowed' }
  if (claim === 'exp')
    return !payload || typeof payload.exp !== 'number'
      ? missingClaim('exp')
      : { ok: false, code: 'expired_token', message: 'OIDC access token has expired' }
  return {
    ok: false,
    code: 'invalid_token',
    message: error instanceof Error ? error.message : 'OIDC access token verification failed'
  }
}
export function cacheAgeMs(cache: CachedJwks | null, nowMs: number): number | undefined {
  return cache ? nowMs - cache.fetchedAtMs : undefined
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
