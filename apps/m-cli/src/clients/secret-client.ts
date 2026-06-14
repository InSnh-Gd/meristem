import type { CliClient } from '../commands/types.ts'
import type { CliRuntime } from './runtime.ts'

/**
 * 密钥客户端通过 Core secret 控制面 API 操作密钥生命周期。
 */
export function createSecretClient(runtime: CliRuntime): NonNullable<CliClient['secret']> {
  const { coreRoutes } = runtime

  return {
    async list(): Promise<
      Array<{
        id: string
        name: string
        scope: string
        status: string
        createdBy: string
        createdAt: string
      }>
    > {
      const result = await coreRoutes.getJson('/api/v0/secrets')
      if (!result.ok) throw new Error(result.error.message)
      return result.value as Array<{
        id: string
        name: string
        scope: string
        status: string
        createdBy: string
        createdAt: string
      }>
    },
    async get(id: string): Promise<{
      id: string
      name: string
      scope: string
      status: string
      createdBy: string
      createdAt: string
      updatedAt: string
      metadata: Record<string, string>
    }> {
      const result = await coreRoutes.getJson(`/api/v0/secrets/${id}`)
      if (!result.ok) throw new Error(result.error.message)
      return result.value as {
        id: string
        name: string
        scope: string
        status: string
        createdBy: string
        createdAt: string
        updatedAt: string
        metadata: Record<string, string>
      }
    },
    async create(input: {
      name: string
      scope: string
      value: string
      metadata?: Record<string, string>
    }): Promise<{ id: string; name: string; status: string; createdAt: string }> {
      const result = await coreRoutes.postJson('/api/v0/secrets', { body: input })
      if (!result.ok) throw new Error(result.error.message)
      return result.value as { id: string; name: string; status: string; createdAt: string }
    },
    async rotate(
      id: string,
      input: { value: string; reason: string }
    ): Promise<{ id: string; version: string; status: string; rotatedAt: string }> {
      const result = await coreRoutes.postJson(`/api/v0/secrets/${id}/rotate`, { body: input })
      if (!result.ok) throw new Error(result.error.message)
      return result.value as { id: string; version: string; status: string; rotatedAt: string }
    },
    async disable(
      id: string,
      input: { reason: string }
    ): Promise<{ id: string; status: string; disabledAt: string }> {
      const result = await coreRoutes.postJson(`/api/v0/secrets/${id}/disable`, { body: input })
      if (!result.ok) throw new Error(result.error.message)
      return result.value as { id: string; status: string; disabledAt: string }
    }
  }
}
