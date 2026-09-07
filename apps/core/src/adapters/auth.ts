import { eq } from 'drizzle-orm'
import {
  createOidcAuthProvider,
  oidcSupportedAlgorithms,
  verifyLocalToken,
  type OidcActorSession,
  type OidcSupportedAlgorithm
} from '../../../../packages/auth/src/index.ts'
import type { OidcAuthProviderConfigFromSchema } from '../../../../packages/contracts/src/index.ts'
import { err, ok } from '../../../../packages/common/src/result.ts'
import type { ActorId, Permission } from '../../../../packages/contracts/src/index.ts'
import type { MeristemDb } from '../../../../packages/db/src/client.ts'
import { actorTokens, rolePermissions, userRoles } from '../../../../packages/db/src/schema.ts'

/**
 * JWT 密钥缺失直接阻断进程启动，避免 Core 在无认证边界的状态下对外提供写接口。
 */
function requiredSecret(): string {
  const secret = process.env.MERISTEM_JWT_SECRET
  if (!secret) throw new Error('MERISTEM_JWT_SECRET is required')
  return secret
}

/**
 * Auth 端口只包装本地 JWT 验证器，不在这里追加角色推导或数据库查询。
 */
export function createJwtAuthPort(secret = requiredSecret()) {
  return {
    async verify(token: string) {
      return verifyLocalToken({ token, secret })
    }
  }
}

/**
 * createSessionAuthPort 为 UI 和 BFF 提供独立的 JWT 认证与 RBAC 权限查询组合。
 * 它复用 createJwtAuthPort 的 token 验证逻辑，并追加 getPermissions
 * 以从 PostgreSQL 权威表读取角色的完整权限列表。
 */
export function createSessionAuthPort(db: MeristemDb, secret = requiredSecret()) {
  return {
    async verify(token: string) {
      const verified = await verifyLocalToken({ token, secret })
      if (!verified.ok) return verified
      const [managedToken] = await db
        .select({ status: actorTokens.status })
        .from(actorTokens)
        .where(eq(actorTokens.jti, verified.jti))
        .limit(1)
      if (managedToken?.status === 'revoked' || managedToken?.status === 'expired') {
        return {
          ok: false as const,
          code: 'invalid_token' as const,
          message: 'JWT has been revoked'
        }
      }
      return verified
    },
    async getPermissions(actor: ActorId) {
      try {
        const rows = await db
          .select({ permissionId: rolePermissions.permissionId })
          .from(userRoles)
          .innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
          .where(eq(userRoles.userId, actor))
        return ok(rows.map(row => row.permissionId as Permission))
      } catch {
        return err({ code: 'db.unavailable', message: 'unable to query permissions' })
      }
    }
  }
}

/** OIDC groups → Meristem actor 的映射顺序：先命中先得，未命中按最小权限 viewer 处理。 */
const OIDC_GROUP_ACTOR_ORDER: readonly ActorId[] = [
  'security-admin',
  'break-glass-reviewer',
  'admin',
  'operator',
  'viewer'
]

export function actorFromOidcSession(session: OidcActorSession): ActorId {
  for (const candidate of OIDC_GROUP_ACTOR_ORDER) {
    if (session.groups.includes(candidate)) return candidate
  }
  return 'viewer'
}

/**
 * 生产 OIDC/JWT 认证端口：本地受管 token 优先（运维铸造/吊销路径），
 * 未命中且配置了 OIDC 时按 discovery + JWKS 验证上游 access token 并映射 actor。
 * 本地与上游两条路径都 fail-closed：任何失败都返回显式错误码而不是放行。
 */
export function createOidcSessionAuthPort(
  db: MeristemDb,
  options: {
    localSecret: string
    oidcConfig: OidcAuthProviderConfigFromSchema
    /** 注入式 provider；生产默认按配置创建，测试注入受控实现。 */
    oidcProvider?: ReturnType<typeof createOidcAuthProvider>
  }
) {
  const oidc = options.oidcProvider ?? createOidcAuthProvider(options.oidcConfig)
  const sessionPort = createSessionAuthPort(db, options.localSecret)
  return {
    async verify(token: string) {
      const local = await sessionPort.verify(token)
      if (local.ok) return local
      const result = await oidc.verifyAccessToken({ token })
      if (result.ok) {
        return { ok: true as const, actor: actorFromOidcSession(result.session) }
      }
      return {
        ok: false as const,
        code: result.code,
        message: result.message
      }
    },
    getPermissions: sessionPort.getPermissions
  }
}

/** 从环境变量组装 OIDC provider 配置；未配置 issuer 时返回 null（保持本地认证模式）。 */
export function oidcConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): OidcAuthProviderConfigFromSchema | null {
  const issuer = env.MERISTEM_OIDC_ISSUER
  const audiences =
    env.MERISTEM_OIDC_AUDIENCES?.split(',')
      .map(a => a.trim())
      .filter(a => a) ?? []
  const allowedAlgorithms =
    env.MERISTEM_OIDC_ALLOWED_ALGORITHMS?.split(',')
      .map(a => a.trim())
      .filter(a => a) ?? []
  if (!issuer || audiences.length === 0 || allowedAlgorithms.length === 0) return null
  // 只保留 provider 支持的算法字面量，未知算法在装配期被丢弃而不是运行期失败
  const supportedAlgorithms = allowedAlgorithms.filter(algorithm =>
    (oidcSupportedAlgorithms as readonly string[]).includes(algorithm)
  ) as OidcSupportedAlgorithm[]
  if (supportedAlgorithms.length === 0) return null
  return {
    provider: 'oidc' as const,
    issuer,
    ...(env.MERISTEM_OIDC_DISCOVERY_URL ? { discoveryUrl: env.MERISTEM_OIDC_DISCOVERY_URL } : {}),
    audiences,
    allowedAlgorithms: supportedAlgorithms
  }
}
