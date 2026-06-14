import type { Result } from '../../../../packages/common/src/result.ts'
import type { ServiceError } from './common.ts'

/**
 * ConfigPort 暴露配置草稿、校验、发布、回滚与 apply ack 生命周期，不让路由层操作内部状态机细节。
 */
export type ConfigPort = {
  list(): Promise<
    Result<
      Array<{
        id: string
        configVersion: string
        domain: string
        status: string
        createdBy: string
        createdAt: string
      }>,
      ServiceError
    >
  >
  get(id: string): Promise<
    Result<
      {
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
      } | null,
      ServiceError
    >
  >
  draft(input: {
    domain: string
    payload: unknown
    targetScope?: string[]
    correlationId: string
  }): Promise<
    Result<{ id: string; configVersion: string; status: string; createdAt: string }, ServiceError>
  >
  validate(id: string): Promise<Result<{ id: string; status: string }, ServiceError>>
  publish(
    id: string,
    input: { reason: string; correlationId: string }
  ): Promise<
    Result<
      {
        id: string
        configVersion: string
        status: string
        publishedAt: string
        publishedBy: string
      },
      ServiceError
    >
  >
  rollback(
    id: string,
    input: { toVersion: string; reason: string; correlationId: string }
  ): Promise<Result<{ id: string; status: string }, ServiceError>>
  applyAck(
    id: string,
    input: {
      version: string
      targetService: string
      status: string
      error?: string
      correlationId: string
    }
  ): Promise<Result<{ ackId: string; status: string; ackedAt: string }, ServiceError>>
}
