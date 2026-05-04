import { jwtVerify, SignJWT } from 'jose'
import type { ActorId } from '../../contracts/src/index.ts'

const issuer = 'meristem-local'
const defaultAudience = 'meristem-core'
const alg = 'HS256'

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

export type AuthError = {
  ok: false
  code: 'missing_token' | 'invalid_token' | 'invalid_actor'
  message: string
}

const actors: readonly ActorId[] = ['viewer', 'operator', 'admin', 'security-admin']

export function isActorId(value: unknown): value is ActorId {
  return typeof value === 'string' && actors.includes(value as ActorId)
}

function secretBytes(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
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

export type AuthResult = VerifiedActor | AuthError

export async function verifyLocalToken(input: { token: string; secret: string }): Promise<AuthResult> {
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

export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1] ?? null
}
