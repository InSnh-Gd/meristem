import type { Result } from '../../../../packages/common/src/result.ts'
import type { ServiceError } from './common.ts'

/**
 * SecretRefPort 仅暴露 metadata 与版本引用，禁止把明文 secret 泄漏给 Core 外部调用方。
 */
export type SecretRefPort = {
  list(): Promise<
    Result<
      Array<{
        id: string
        name: string
        scope: string
        status: string
        createdBy: string
        createdAt: string
        metadata: Record<string, string>
      }>,
      ServiceError
    >
  >
  get(id: string): Promise<
    Result<
      {
        id: string
        name: string
        scope: string
        status: string
        createdBy: string
        createdAt: string
        updatedAt: string
        metadata: Record<string, string>
      } | null,
      ServiceError
    >
  >
  create(input: {
    name: string
    scope: string
    value: string
    metadata?: Record<string, string>
    correlationId: string
  }): Promise<Result<{ id: string; name: string; status: string; createdAt: string }, ServiceError>>
  rotate(
    id: string,
    input: { value: string; reason: string; correlationId: string }
  ): Promise<
    Result<{ id: string; version: string; status: string; rotatedAt: string }, ServiceError>
  >
  disable(
    id: string,
    input: { reason: string; correlationId: string }
  ): Promise<Result<{ id: string; status: string; disabledAt: string }, ServiceError>>
  reference(
    id: string
  ): Promise<
    Result<
      { id: string; currentVersion: string; status: string; metadata: Record<string, string> },
      ServiceError
    >
  >
}
