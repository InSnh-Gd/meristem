import type { CliClient } from '../commands/types.ts'
import type { CliRuntime } from './runtime.ts'

/**
 * 配置客户端通过 Core config 控制面 API 操作配置记录和发布生命周期。
 */
export function createConfigClient(runtime: CliRuntime): NonNullable<CliClient['config']> {
  const { coreRoutes } = runtime

  return {
    async list(): Promise<
      Array<{
        id: string
        configVersion: string
        domain: string
        status: string
        createdBy: string
        createdAt: string
      }>
    > {
      const result = await coreRoutes.getJson('/api/v0/configs')
      if (!result.ok) throw new Error(result.error.message)
      return result.value as Array<{
        id: string
        configVersion: string
        domain: string
        status: string
        createdBy: string
        createdAt: string
      }>
    },
    async get(id: string): Promise<{
      id: string
      configVersion: string
      schemaVersion: string
      configHash: string
      domain: string
      targetScope: string[]
      status: string
      payload: unknown
      createdBy: string
      createdAt: string
      publishedBy?: string
      publishedAt?: string
      rollbackVersion?: string
      updatedAt: string
    }> {
      const result = await coreRoutes.getJson(`/api/v0/configs/${id}`)
      if (!result.ok) throw new Error(result.error.message)
      return result.value as {
        id: string
        configVersion: string
        schemaVersion: string
        configHash: string
        domain: string
        targetScope: string[]
        status: string
        payload: unknown
        createdBy: string
        createdAt: string
        publishedBy?: string
        publishedAt?: string
        rollbackVersion?: string
        updatedAt: string
      }
    },
    async draft(input: {
      domain: string
      payload: unknown
      targetScope?: string[]
    }): Promise<{ id: string; configVersion: string; status: string; createdAt: string }> {
      const result = await coreRoutes.postJson('/api/v0/configs/drafts', { body: input })
      if (!result.ok) throw new Error(result.error.message)
      return result.value as {
        id: string
        configVersion: string
        status: string
        createdAt: string
      }
    },
    async validate(id: string): Promise<{ id: string; status: string }> {
      const result = await coreRoutes.postJson(`/api/v0/configs/${id}/validate`)
      if (!result.ok) throw new Error(result.error.message)
      return result.value as { id: string; status: string }
    },
    async publish(
      id: string,
      input: { reason: string }
    ): Promise<{
      id: string
      configVersion: string
      status: string
      publishedAt: string
      publishedBy: string
    }> {
      const result = await coreRoutes.postJson(`/api/v0/configs/${id}/publish`, { body: input })
      if (!result.ok) throw new Error(result.error.message)
      return result.value as {
        id: string
        configVersion: string
        status: string
        publishedAt: string
        publishedBy: string
      }
    },
    async rollback(
      id: string,
      input: { toVersion: string; reason: string }
    ): Promise<{ id: string; status: string }> {
      const result = await coreRoutes.postJson(`/api/v0/configs/${id}/rollback`, { body: input })
      if (!result.ok) throw new Error(result.error.message)
      return result.value as { id: string; status: string }
    }
  }
}
