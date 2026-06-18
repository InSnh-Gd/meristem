import type { ActorId, ActorTokenV02 } from '../../contracts/src/index.ts'

export const issuer = 'meristem-local'
export const defaultAudience = 'meristem-core'
export const serviceAudience = 'meristem-service'
export const alg = 'HS256'

const actors: readonly ActorId[] = ['viewer', 'operator', 'admin', 'security-admin']

export function isActorId(value: unknown): value is ActorId {
  return typeof value === 'string' && actors.includes(value as ActorId)
}

export function secretBytes(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

export function isIdentityAudience(value: unknown): value is ActorTokenV02['audience'] {
  return value === defaultAudience || value === serviceAudience
}

export function parseExpiresInToMs(expiresIn: string): number {
  const numericSeconds = Number(expiresIn)

  if (Number.isFinite(numericSeconds) && numericSeconds > 0) {
    return numericSeconds * 1_000
  }

  const match = /^(\d+)(ms|s|m|h|d)$/.exec(expiresIn)
  if (!match) {
    throw new Error(`Unsupported expiresIn format: ${expiresIn}`)
  }

  const amount = Number(match[1])
  const unit = match[2]

  switch (unit) {
    case 'ms':
      return amount
    case 's':
      return amount * 1_000
    case 'm':
      return amount * 60_000
    case 'h':
      return amount * 3_600_000
    case 'd':
      return amount * 86_400_000
  }

  throw new Error(`Unsupported expiresIn unit: ${String(unit)}`)
}

export function isExpiredJwtError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const errorCode = Reflect.get(error, 'code')
  return error.name === 'JWTExpired' || errorCode === 'ERR_JWT_EXPIRED'
}

export function extractIsoClaim(value: unknown, fallbackSeconds?: number): string | null {
  if (typeof value === 'string') {
    return value
  }

  if (typeof fallbackSeconds === 'number' && Number.isFinite(fallbackSeconds)) {
    return new Date(fallbackSeconds * 1_000).toISOString()
  }

  return null
}

export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1] ?? null
}
