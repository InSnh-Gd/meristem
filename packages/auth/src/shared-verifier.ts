import type {
  ActorId,
  AuthProviderRuntimeConfigFromSchema,
  Permission
} from '../../contracts/src/index.ts'
import { verifyLocalToken } from './actor-tokens.ts'
import { createOidcAuthProvider, type OidcAuthProviderDeps } from './oidc-provider.ts'
import type { OidcActorSession, OidcAuthFailure } from './oidc-provider-support.ts'
import { defaultAudience, isActorId, issuer } from './shared.ts'

export type SharedAuthVerifierFailure = {
  ok: false
  code:
    | 'missing_token'
    | 'invalid_token'
    | 'invalid_actor'
    | 'expired_token'
    | OidcAuthFailure['code']
  message: string
}

export type SharedAuthSession = {
  provider: AuthProviderRuntimeConfigFromSchema['provider']
  actor: {
    id: ActorId
    displayName: string
    email?: string
  }
  issuer: string
  audience: string
  groups: readonly string[]
  permissions: readonly Permission[]
  expiresAt?: string
  tokenId?: string
}

export type SharedAuthVerifierResult =
  | {
      ok: true
      session: SharedAuthSession
    }
  | SharedAuthVerifierFailure

export type SharedAuthVerifierReadiness =
  | { ok: true }
  | Extract<SharedAuthVerifierResult, { ok: false }>

export type SharedAuthVerifierInput = {
  auth: AuthProviderRuntimeConfigFromSchema
  localDev?: {
    jwtSecret?: string
  }
  oidc?: OidcAuthProviderDeps
}

export type SharedAuthVerifier = {
  verify(token: string): Promise<SharedAuthVerifierResult>
  checkReadiness(): Promise<SharedAuthVerifierReadiness>
}

function failure(input: {
  code: SharedAuthVerifierFailure['code']
  message: string
}): SharedAuthVerifierFailure {
  return { ok: false, code: input.code, message: input.message }
}

function permissionsFromGroups(): readonly Permission[] {
  return []
}

function oidcSessionToShared(session: OidcActorSession): SharedAuthVerifierResult {
  if (!isActorId(session.subject)) {
    return failure({
      code: 'invalid_actor',
      message: 'OIDC subject does not map to a known Meristem actor'
    })
  }

  return {
    ok: true,
    session: {
      provider: 'oidc',
      actor: {
        id: session.subject,
        displayName: session.displayName ?? session.subject,
        ...(session.email ? { email: session.email } : {})
      },
      issuer: session.issuer,
      audience: session.audience ?? defaultAudience,
      groups: session.groups,
      permissions: permissionsFromGroups(),
      expiresAt: session.expiresAt
    }
  }
}

function localSessionToShared(input: { actor: ActorId; jti: string }): SharedAuthVerifierResult {
  return {
    ok: true,
    session: {
      provider: 'local-dev',
      actor: {
        id: input.actor,
        displayName: input.actor
      },
      issuer,
      audience: defaultAudience,
      groups: [],
      permissions: [],
      tokenId: input.jti
    }
  }
}

function mapOidcFailure(result: OidcAuthFailure): SharedAuthVerifierFailure {
  return failure({ code: result.code, message: result.message })
}

/**
 * 共享认证边界只按部署配置选择一个 verifier，避免生产 OIDC 路径隐式回落到本地 JWT。
 */
export function createSharedAuthVerifier(input: SharedAuthVerifierInput): SharedAuthVerifier {
  if (input.auth.provider === 'oidc') {
    const oidcProvider = createOidcAuthProvider(input.auth, input.oidc)
    return {
      async verify(token) {
        const result = await oidcProvider.verifyAccessToken({ token })
        if (!result.ok) return mapOidcFailure(result)
        return oidcSessionToShared(result.session)
      },
      async checkReadiness() {
        const result = await oidcProvider.discoverConfiguration()
        if (result.ok) return { ok: true }
        return mapOidcFailure(result)
      }
    }
  }

  return {
    async verify(token) {
      const secret = input.localDev?.jwtSecret
      if (!secret) {
        return failure({
          code: 'invalid_token',
          message: 'local-dev auth provider requires an explicit JWT secret'
        })
      }
      const result = await verifyLocalToken({ token, secret })
      if (!result.ok) return failure({ code: result.code, message: result.message })
      return localSessionToShared({ actor: result.actor, jti: result.jti })
    },
    async checkReadiness() {
      if (input.localDev?.jwtSecret) return { ok: true }
      return failure({
        code: 'invalid_token',
        message: 'local-dev auth provider requires an explicit JWT secret'
      })
    }
  }
}
