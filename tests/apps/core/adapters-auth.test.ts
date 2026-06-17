import { describe, expect, it } from 'bun:test'
import { mintLocalToken } from '../../../packages/auth/src/index.ts'
import { ok } from '../../../packages/common/src/result.ts'
import type { MeristemDb } from '../../../packages/db/src/client.ts'
import { createSessionAuthPort } from '../../../apps/core/src/adapters/auth.ts'

const testSecret = 'test-session-auth-secret'

/**
 * 构造一个满足 createSessionAuthPort 调用链的 fake Drizzle 对象。
 * verify 路径需要 select().from().where().limit() → Promise<array>。
 * getPermissions 路径需要 select().from().innerJoin().where() → Promise<array>。
 */
function createFakeDb(options: {
  tokenStatus?: string | null
  permissions?: string[]
  throwOnPermissions?: boolean
}): MeristemDb {
  const { tokenStatus = null, permissions = [], throwOnPermissions = false } = options

  const verifyChain = {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(tokenStatus !== null ? [{ status: tokenStatus }] : [])
      })
    })
  }

  const permissionChain = {
    from: () => ({
      innerJoin: () => ({
        where: () =>
          throwOnPermissions
            ? Promise.reject(new Error('db connection lost'))
            : Promise.resolve(permissions.map(p => ({ permissionId: p })))
      })
    })
  }

  // 测试通过结构化假对象触达生产 auth adapter 的真实分支逻辑，
  // 不依赖真实 PostgreSQL 连接。
  return {
    select: ((selection: unknown) =>
      selection &&
      typeof selection === 'object' &&
      'permissionId' in (selection as Record<string, unknown>)
        ? permissionChain
        : verifyChain) as unknown as MeristemDb['select']
  } as unknown as MeristemDb
}

describe('createSessionAuthPort', () => {
  describe('verify', () => {
    it('returns verified actor for valid token with no revocation record', async () => {
      const db = createFakeDb({ tokenStatus: null })
      const auth = createSessionAuthPort(db, testSecret)
      const token = await mintLocalToken({ actor: 'operator', secret: testSecret })

      const result = await auth.verify(token)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.actor).toBe('operator')
      }
    })

    it('returns invalid_token when token status is revoked', async () => {
      const db = createFakeDb({ tokenStatus: 'revoked' })
      const auth = createSessionAuthPort(db, testSecret)
      const token = await mintLocalToken({ actor: 'admin', secret: testSecret })

      const result = await auth.verify(token)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('invalid_token')
        expect(result.message).toBe('JWT has been revoked')
      }
    })

    it('returns invalid_token when token status is expired', async () => {
      const db = createFakeDb({ tokenStatus: 'expired' })
      const auth = createSessionAuthPort(db, testSecret)
      const token = await mintLocalToken({ actor: 'viewer', secret: testSecret })

      const result = await auth.verify(token)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('invalid_token')
      }
    })

    it('passes through invalid token errors from JWT verification', async () => {
      const db = createFakeDb({ tokenStatus: null })
      const auth = createSessionAuthPort(db, testSecret)

      const result = await auth.verify('not-a-valid-jwt')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('invalid_token')
      }
    })

    it('allows active token status without revocation', async () => {
      const db = createFakeDb({ tokenStatus: 'active' })
      const auth = createSessionAuthPort(db, testSecret)
      const token = await mintLocalToken({ actor: 'security-admin', secret: testSecret })

      const result = await auth.verify(token)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.actor).toBe('security-admin')
      }
    })
  })

  describe('getPermissions', () => {
    it('returns permission list for actor', async () => {
      const db = createFakeDb({
        permissions: ['task:submit', 'node:register', 'config:publish']
      })
      const auth = createSessionAuthPort(db, testSecret)

      const result = await auth.getPermissions('operator')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toEqual(['task:submit', 'node:register', 'config:publish'])
      }
    })

    it('returns empty array for actor with no permissions', async () => {
      const db = createFakeDb({ permissions: [] })
      const auth = createSessionAuthPort(db, testSecret)

      const result = await auth.getPermissions('viewer')
      expect(result).toEqual(ok([]))
    })

    it('returns db.unavailable error when query throws', async () => {
      const db = createFakeDb({ throwOnPermissions: true })
      const auth = createSessionAuthPort(db, testSecret)

      const result = await auth.getPermissions('admin')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('db.unavailable')
        expect(result.error.message).toBe('unable to query permissions')
      }
    })
  })
})
