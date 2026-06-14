import type { CliClient } from '../commands/types.ts'
import type { CliRuntime } from './runtime.ts'

/**
 * 身份客户端直接调用 Core identity 控制面 API，避免在 CLI 层复制鉴权推断逻辑。
 */
export function createIdentityClient(runtime: CliRuntime): NonNullable<CliClient['identity']> {
  const { coreRoutes } = runtime

  return {
    async listActors(): Promise<Array<{ id: string; displayName: string; status: string }>> {
      const result = await coreRoutes.getJson('/api/v0/identity/actors')
      if (!result.ok) throw new Error(result.error.message)
      return result.value as Array<{ id: string; displayName: string; status: string }>
    },
    async getActor(id: string): Promise<{ id: string; displayName: string; status: string }> {
      const result = await coreRoutes.getJson(`/api/v0/identity/actors/${id}`)
      if (!result.ok) throw new Error(result.error.message)
      return result.value as { id: string; displayName: string; status: string }
    },
    async issueToken(input: {
      actor: string
      ttl: string
      purpose: string
    }): Promise<{ jti: string; token: string; expiresAt: string; actor: string }> {
      const result = await coreRoutes.postJson('/api/v0/identity/tokens', { body: input })
      if (!result.ok) throw new Error(result.error.message)
      return result.value as { jti: string; token: string; expiresAt: string; actor: string }
    },
    async inspectToken(jti: string): Promise<{
      jti: string
      actor: string
      status: string
      issuer: string
      audience: string
      issuedAt: string
      expiresAt: string
      issuedBy: string
      purpose: string
    }> {
      const result = await coreRoutes.getJson(`/api/v0/identity/tokens/${jti}`)
      if (!result.ok) throw new Error(result.error.message)
      return result.value as {
        jti: string
        actor: string
        status: string
        issuer: string
        audience: string
        issuedAt: string
        expiresAt: string
        issuedBy: string
        purpose: string
      }
    },
    async revokeToken(
      jti: string,
      input: { reason: string }
    ): Promise<{ jti: string; status: string; revokedAt: string; revokedBy: string }> {
      const result = await coreRoutes.postJson(`/api/v0/identity/tokens/${jti}/revoke`, {
        body: input
      })
      if (!result.ok) throw new Error(result.error.message)
      return result.value as { jti: string; status: string; revokedAt: string; revokedBy: string }
    }
  }
}
