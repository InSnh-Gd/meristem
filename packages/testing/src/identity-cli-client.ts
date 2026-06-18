import type { CliClient } from '../../../apps/m-cli/src/commands/types.ts'
import { createCliStatusMock } from './cli-status-mock.ts'

export type IdentityActor = {
  id: 'viewer' | 'operator' | 'admin' | 'security-admin'
  displayName: string
  status: 'active' | 'disabled'
  createdAt: string
  updatedAt: string
}

export type ActorToken = {
  jti: string
  actor: IdentityActor['id']
  issuer: 'meristem-local'
  audience: 'meristem-core' | 'meristem-service'
  issuedAt: string
  expiresAt: string
  issuedBy: IdentityActor['id']
  purpose: string
  status: 'active' | 'revoked' | 'expired'
  revokedAt?: string
  revokedBy?: IdentityActor['id']
  revokeReason?: string
}

export type IdentityCliMethods = {
  listActors?(): Promise<{ actors: IdentityActor[] }>
  getActor?(actorId: string): Promise<{ actor: IdentityActor }>
  issueIdentityToken?(input: { actor: string; ttl: string; purpose: string }): Promise<{
    token: string
    jti: string
    actor: string
    audience: string
    issuedAt: string
    expiresAt: string
    issuedBy: string
    purpose: string
    status: string
  }>
  inspectIdentityToken?(jti: string): Promise<{ token: ActorToken }>
  revokeIdentityToken?(jti: string, input: { reason: string }): Promise<{ token: ActorToken }>
}

/**
 * 创建带 identity 方法的 mock CliClient。
 * 只绑定 methods 中提供的方法，status 始终返回共享健康 mock。
 */
export function createIdentityCliClient(methods: IdentityCliMethods): CliClient {
  const listActors = methods.listActors
  const getActor = methods.getActor
  const inspectIdentityToken = methods.inspectIdentityToken
  const revokeIdentityToken = methods.revokeIdentityToken
  const identity = {
    ...(listActors
      ? {
          listActors: async () => {
            const { actors } = await listActors()
            return actors.map(actor => ({
              id: actor.id,
              displayName: actor.displayName,
              status: actor.status
            }))
          }
        }
      : {}),
    ...(getActor
      ? {
          getActor: async (actorId: string) => {
            const { actor } = await getActor(actorId)
            return {
              id: actor.id,
              displayName: actor.displayName,
              status: actor.status
            }
          }
        }
      : {}),
    ...(methods.issueIdentityToken
      ? {
          issueToken: methods.issueIdentityToken
        }
      : {}),
    ...(inspectIdentityToken
      ? {
          inspectToken: async (jti: string) => {
            const { token } = await inspectIdentityToken(jti)
            return { ...token }
          }
        }
      : {}),
    ...(revokeIdentityToken
      ? {
          revokeToken: async (jti: string, input: { reason: string }) => {
            const { token } = await revokeIdentityToken(jti, input)
            return {
              jti: token.jti,
              status: token.status,
              revokedAt: token.revokedAt ?? token.issuedAt,
              revokedBy: token.revokedBy ?? token.issuedBy,
              ...(token.revokeReason ? { revokeReason: token.revokeReason } : {})
            }
          }
        }
      : {})
  } satisfies NonNullable<CliClient['identity']>
  return { status: createCliStatusMock, identity }
}
