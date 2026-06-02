import { jwtVerify, SignJWT } from 'jose'
import type { ActorId, ActorTokenV02, IdentityActorV02, TokenIntrospectionResult } from '../../contracts/src/index.ts'

const issuer = 'meristem-local'
const defaultAudience = 'meristem-core'
const serviceAudience = 'meristem-service'
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

const actors: readonly ActorId[] = ['viewer', 'operator', 'admin', 'security-admin']

/**
 * MVP 只接受文档里定义过的 actor 集合，避免未知 subject 绕过策略层假装成合法身份。
 */
export function isActorId(value: unknown): value is ActorId {
  return typeof value === 'string' && actors.includes(value as ActorId)
}

function secretBytes(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

function isIdentityAudience(value: unknown): value is ActorTokenV02['audience'] {
  return value === defaultAudience || value === serviceAudience
}

function parseExpiresInToMs(expiresIn: string): number {
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

function isExpiredJwtError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const errorCode = Reflect.get(error, 'code')
  return error.name === 'JWTExpired' || errorCode === 'ERR_JWT_EXPIRED'
}

function extractIsoClaim(value: unknown, fallbackSeconds?: number): string | null {
  if (typeof value === 'string') {
    return value
  }

  if (typeof fallbackSeconds === 'number' && Number.isFinite(fallbackSeconds)) {
    return new Date(fallbackSeconds * 1_000).toISOString()
  }

  return null
}

function buildActorTokenPayload(payload: Record<string, unknown>): ActorTokenPayload | null {
  if (!isActorId(payload.sub)) {
    return null
  }

  if (typeof payload.jti !== 'string') {
    return null
  }

  if (!isIdentityAudience(payload.aud)) {
    return null
  }

  if (!isActorId(payload.issuedBy)) {
    return null
  }

  if (typeof payload.purpose !== 'string') {
    return null
  }

  const issuedAt = extractIsoClaim(payload.issuedAt, typeof payload.iat === 'number' ? payload.iat : undefined)
  const expiresAt = extractIsoClaim(payload.expiresAt, typeof payload.exp === 'number' ? payload.exp : undefined)

  if (issuedAt === null || expiresAt === null) {
    return null
  }

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

    return {
      ok: true,
      ...actorTokenPayload
    }
  } catch (error) {
    if (isExpiredJwtError(error)) {
      return { ok: false, code: 'expired_token', message: 'JWT has expired' }
    }

    return { ok: false, code: 'invalid_token', message: 'JWT verification failed' }
  }
}

/**
 * 本地 JWT 只承载最小身份信息；角色与权限仍必须回到 M-Policy 和 PostgreSQL 判定。
 */
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

/**
 * Identity v0.2 token 在最小 JWT 之上增加 jti、用途和签发者，供 Core 与 M-* 服务共享验证契约。
 */
export async function mintActorToken(input: MintActorTokenInput): Promise<string> {
  const audience = input.audience ?? defaultAudience
  const expiresIn = input.expiresIn ?? '8h'
  const issuedAtDate = new Date()
  const expiresAtDate = new Date(issuedAtDate.getTime() + parseExpiresInToMs(expiresIn))

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
    .setIssuedAt(Math.floor(issuedAtDate.getTime() / 1_000))
    .setExpirationTime(Math.floor(expiresAtDate.getTime() / 1_000))
    .setJti(input.jti)
    .sign(secretBytes(input.secret))
}

export type AuthResult = VerifiedActor | VerifiedActorToken | AuthError

/**
 * JWT 验证只负责确认 token 本身有效与 actor 合法，不在这里内联权限推导。
 */
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

/**
 * Identity v0.2 验证同时接受 Core 与 M-* service audience，并把完整 token 元数据返回给调用方。
 */
export async function verifyActorToken(token: string, secret: string): Promise<ActorTokenAuthResult> {
  return verifyActorTokenAgainstAudiences(token, secret, [defaultAudience, serviceAudience])
}

/**
 * 兼容契约测试与后续服务接入：允许调用方显式要求某个 audience，避免把错误归因成未知 audience。
 */
export async function verifyIdentityV02Token(input: VerifyIdentityV02TokenInput): Promise<ActorTokenAuthResult> {
  const audiences: readonly ActorTokenV02['audience'][] = input.expectedAudience
    ? [input.expectedAudience]
    : [defaultAudience, serviceAudience]
  return verifyActorTokenAgainstAudiences(input.token, input.secret, audiences)
}

/**
 * introspection 先验证 JWT 形状，再查询 Core revocation 状态；无效或过期 token 不会被报告为 active。
 */
export async function introspectToken(options: IntrospectOptions): Promise<TokenIntrospectionResult> {
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

export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1] ?? null
}

/**
 * 节点 token 使用独立 opaque token，而不是复用操作者 JWT，避免节点运行时身份
 * 和人类操作者身份混成一条边界。
 */
export function mintNodeToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `mnt_${crypto.randomUUID().replaceAll('-', '')}_${suffix}`
}

/**
 * 数据库只保存节点 token 的哈希值，明文 token 只在签发时返回一次。
 */
export async function hashNodeToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
