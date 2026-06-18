import { addMilliseconds, getUnixTime } from 'date-fns'
import { jwtVerify, SignJWT } from 'jose'
import type {
  ActorId,
  ActorTokenV02,
  IdentityActorV02,
  TokenIntrospectionResult
} from '../../contracts/src/index.ts'
import {
  defaultAudience,
  extractIsoClaim,
  isActorId,
  isExpiredJwtError,
  isIdentityAudience,
  issuer,
  parseExpiresInToMs,
  secretBytes,
  serviceAudience,
  alg
} from './shared.ts'

export type MintLocalTokenInput = {
  actor: ActorId
  secret: string
  audience?: string
  expiresIn?: string
}

export type VerifiedActor = {
  ok: true
  actor: ActorId
  jti: string
}

export type MintActorTokenInput = {
  actor: IdentityActorV02['id']
  secret: string
  jti: string
  audience?: ActorTokenV02['audience']
  expiresIn?: string
  issuedBy: IdentityActorV02['id']
  purpose: string
}

export type ActorTokenPayload = {
  jti: string
  actor: IdentityActorV02['id']
  issuer: 'meristem-local'
  audience: ActorTokenV02['audience']
  issuedAt: string
  expiresAt: string
  issuedBy: IdentityActorV02['id']
  purpose: string
}

export type IntrospectOptions = {
  token: string
  secret: string
  checkRevocation: (jti: string) => Promise<boolean>
}

export type VerifyIdentityV02TokenInput = {
  token: string
  secret: string
  expectedAudience?: ActorTokenV02['audience']
}

type VerifiedActorToken = {
  ok: true
} & ActorTokenPayload

type ActorTokenAuthResult = VerifiedActorToken | AuthError

export type AuthError = {
  ok: false
  code: 'missing_token' | 'invalid_token' | 'invalid_actor' | 'expired_token'
  message: string
}

function buildActorTokenPayload(payload: Record<string, unknown>): ActorTokenPayload | null {
  if (!isActorId(payload.sub)) return null
  if (typeof payload.jti !== 'string') return null
  if (!isIdentityAudience(payload.aud)) return null
  if (!isActorId(payload.issuedBy)) return null
  if (typeof payload.purpose !== 'string') return null

  const issuedAt = extractIsoClaim(
    payload.issuedAt,
    typeof payload.iat === 'number' ? payload.iat : undefined
  )
  const expiresAt = extractIsoClaim(
    payload.expiresAt,
    typeof payload.exp === 'number' ? payload.exp : undefined
  )
  if (issuedAt === null || expiresAt === null) return null

  return {
    jti: payload.jti,
    actor: payload.sub,
    issuer,
    audience: payload.aud,
    issuedAt,
    expiresAt,
    issuedBy: payload.issuedBy,
    purpose: payload.purpose
  }
}

async function verifyActorTokenAgainstAudiences(
  token: string,
  secret: string,
  audiences: readonly ActorTokenV02['audience'][]
): Promise<ActorTokenAuthResult> {
  try {
    const { payload } = await jwtVerify(token, secretBytes(secret), {
      audience: [...audiences],
      issuer
    })

    const actorTokenPayload = buildActorTokenPayload(payload)
    if (actorTokenPayload === null) {
      return { ok: false, code: 'invalid_token', message: 'Identity v0.2 JWT claims are invalid' }
    }

    return { ok: true, ...actorTokenPayload }
  } catch (error) {
    if (isExpiredJwtError(error)) {
      return { ok: false, code: 'expired_token', message: 'JWT has expired' }
    }

    return { ok: false, code: 'invalid_token', message: 'JWT verification failed' }
  }
}

export async function mintLocalToken(input: MintLocalTokenInput): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg })
    .setIssuer(issuer)
    .setAudience(input.audience ?? defaultAudience)
    .setSubject(input.actor)
    .setIssuedAt()
    .setExpirationTime(input.expiresIn ?? '8h')
    .setJti(crypto.randomUUID())
    .sign(secretBytes(input.secret))
}

export async function mintActorToken(input: MintActorTokenInput): Promise<string> {
  const audience = input.audience ?? defaultAudience
  const expiresIn = input.expiresIn ?? '8h'
  const issuedAtDate = new Date()
  const expiresAtDate = addMilliseconds(issuedAtDate, parseExpiresInToMs(expiresIn))

  return new SignJWT({
    issuedAt: issuedAtDate.toISOString(),
    expiresAt: expiresAtDate.toISOString(),
    issuedBy: input.issuedBy,
    purpose: input.purpose
  })
    .setProtectedHeader({ alg })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(input.actor)
    .setIssuedAt(getUnixTime(issuedAtDate))
    .setExpirationTime(getUnixTime(expiresAtDate))
    .setJti(input.jti)
    .sign(secretBytes(input.secret))
}

export type AuthResult = VerifiedActor | VerifiedActorToken | AuthError

export async function verifyLocalToken(input: {
  token: string
  secret: string
}): Promise<AuthResult> {
  try {
    const { payload } = await jwtVerify(input.token, secretBytes(input.secret), {
      audience: defaultAudience,
      issuer
    })

    if (!isActorId(payload.sub)) {
      return { ok: false, code: 'invalid_actor', message: 'JWT subject is not a known MVP actor' }
    }

    if (typeof payload.jti !== 'string') {
      return { ok: false, code: 'invalid_token', message: 'JWT jti is required' }
    }

    return { ok: true, actor: payload.sub, jti: payload.jti }
  } catch {
    return { ok: false, code: 'invalid_token', message: 'JWT verification failed' }
  }
}

export async function verifyActorToken(
  token: string,
  secret: string
): Promise<ActorTokenAuthResult> {
  return verifyActorTokenAgainstAudiences(token, secret, [defaultAudience, serviceAudience])
}

export async function verifyIdentityV02Token(
  input: VerifyIdentityV02TokenInput
): Promise<ActorTokenAuthResult> {
  const audiences: readonly ActorTokenV02['audience'][] = input.expectedAudience
    ? [input.expectedAudience]
    : [defaultAudience, serviceAudience]
  return verifyActorTokenAgainstAudiences(input.token, input.secret, audiences)
}

export async function introspectToken(
  options: IntrospectOptions
): Promise<TokenIntrospectionResult> {
  const verified = await verifyActorToken(options.token, options.secret)

  if (!verified.ok) {
    if (verified.code === 'expired_token') {
      return { active: false, status: 'expired' }
    }

    return { active: false }
  }

  const revoked = await options.checkRevocation(verified.jti)
  if (revoked) {
    return { active: false, status: 'revoked' }
  }

  return {
    active: true,
    actor: verified.actor,
    jti: verified.jti,
    status: 'active',
    expiresAt: verified.expiresAt
  }
}
