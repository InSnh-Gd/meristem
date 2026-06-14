import type { Result } from '../../../../packages/common/src/result.ts'
import type { ServiceError } from './common.ts'

/**
 * IdentityPort 收敛 Core 自持 actor 与 token 生命周期，避免外层直接接触身份表结构。
 */
export type IdentityPort = {
  listActors(): Promise<
    Result<
      Array<{
        id: string
        displayName: string
        status: string
        createdAt: string
        updatedAt: string
      }>,
      ServiceError
    >
  >
  getActor(id: string): Promise<
    Result<
      {
        id: string
        displayName: string
        status: string
        createdAt: string
        updatedAt: string
      } | null,
      ServiceError
    >
  >
  issueToken(input: {
    actor: string
    ttl: string
    purpose: string
    correlationId: string
  }): Promise<
    Result<{ jti: string; token: string; expiresAt: string; actor: string }, ServiceError>
  >
  inspectToken(jti: string): Promise<
    Result<
      {
        jti: string
        actor: string
        issuer: string
        audience: string
        issuedAt: string
        expiresAt: string
        issuedBy: string
        purpose: string
        status: string
        revokedAt?: string
        revokedBy?: string
        revokeReason?: string
      } | null,
      ServiceError
    >
  >
  revokeToken(
    jti: string,
    input: { reason: string; correlationId: string }
  ): Promise<
    Result<{ jti: string; status: string; revokedAt: string; revokedBy: string }, ServiceError>
  >
  introspect(
    jti: string
  ): Promise<Result<{ active: boolean; actor?: string; jti?: string }, ServiceError>>
}
