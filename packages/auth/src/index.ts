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

/**
 * MVP 只接受文档里定义过的 actor 集合，避免未知 subject 绕过策略层假装成合法身份。
 */
export function isActorId(value: unknown): value is ActorId {
  return typeof value === 'string' && actors.includes(value as ActorId)
}

function secretBytes(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
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

export type AuthResult = VerifiedActor | AuthError

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
