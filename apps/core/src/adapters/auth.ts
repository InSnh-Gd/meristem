import { and, eq } from 'drizzle-orm'
import { err, ok } from '../../../../packages/common/src/result.ts'
import type { ActorId, Permission } from '../../../../packages/contracts/src/index.ts'
import { type MeristemDb } from '../../../../packages/db/src/client.ts'
import { rolePermissions, userRoles } from '../../../../packages/db/src/schema.ts'
import { verifyLocalToken } from '../../../../packages/auth/src/index.ts'

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
      return verifyLocalToken({ token, secret })
    },
    async getPermissions(actor: ActorId) {
      try {
        const rows = await db
          .select({ permissionId: rolePermissions.permissionId })
          .from(userRoles)
          .innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
          .where(eq(userRoles.userId, actor))
        return ok(rows.map((row) => row.permissionId as Permission))
      } catch {
        return err({ code: "db.unavailable", message: "unable to query permissions" })
      }
    }
  }
}

