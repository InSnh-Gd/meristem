import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type {
  OidcAuthProviderConfigFromSchema,
  OidcIamProviderConfigV01FromSchema
} from '../../contracts/src/index.ts'
import { err, ok, type Result } from '../../common/src/result.ts'
import {
  createOidcAuthProvider,
  type OidcAuthFailure,
  type OidcAuthProviderDeps
} from './oidc-provider.ts'
import type { LocalIamIdentity } from './local-iam-types.ts'

export type OidcAuthorizationCodeClient = {
  createAuthorizationUrl(input: {
    readonly state: string
    readonly nonce: string
    readonly codeChallenge: string
  }): Promise<Result<{ readonly authorizationUrl: string }, OidcAuthFailure>>
  exchangeAuthorizationCode(input: {
    readonly code: string
    readonly codeVerifier: string
    readonly nonce: string
  }): Promise<Result<LocalIamIdentity, OidcAuthFailure>>
}

export type OidcAuthorizationCodeClientOptions = {
  readonly provider: OidcIamProviderConfigV01FromSchema
  readonly fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  readonly verifier?: OidcAuthProviderDeps
}

const OidcTokenResponseSchema = Type.Object(
  {
    id_token: Type.String({ minLength: 1 })
  },
  { additionalProperties: true }
)

function invalidTokenFailure(message: string): OidcAuthFailure {
  return { ok: false, code: 'invalid_token', message }
}

function unavailableFailure(message: string): OidcAuthFailure {
  return { ok: false, code: 'invalid_discovery', message }
}

function toRuntimeProviderConfig(
  provider: OidcIamProviderConfigV01FromSchema
): OidcAuthProviderConfigFromSchema {
  return {
    provider: 'oidc',
    issuer: provider.issuer,
    discoveryUrl: `${provider.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
    audiences: [provider.clientId]
  }
}

/**
 * Authorization Code + PKCE client 将 token 交换和 nonce 校验固定在 BFF 侧。
 * 成功后只返回 local IAM 所需的 issuer、subject 和显示属性，原始 token 不会离开本函数。
 */
export function createOidcAuthorizationCodeClient(
  options: OidcAuthorizationCodeClientOptions
): OidcAuthorizationCodeClient {
  const verifier = options.fetch ? { ...options.verifier, fetch: options.fetch } : options.verifier
  const provider = createOidcAuthProvider(toRuntimeProviderConfig(options.provider), verifier)
  const fetchImpl = options.fetch ?? fetch

  return {
    async createAuthorizationUrl(input) {
      const discovery = await provider.discoverConfiguration()
      if (!discovery.ok) return err(discovery)
      const url = new URL(discovery.configuration.authorizationEndpoint)
      url.searchParams.set('client_id', options.provider.clientId)
      url.searchParams.set('redirect_uri', options.provider.redirectUri)
      url.searchParams.set('response_type', options.provider.responseType)
      url.searchParams.set('scope', options.provider.scopes.join(' '))
      url.searchParams.set('state', input.state)
      url.searchParams.set('nonce', input.nonce)
      url.searchParams.set('code_challenge', input.codeChallenge)
      url.searchParams.set('code_challenge_method', 'S256')
      return ok({ authorizationUrl: url.toString() })
    },

    async exchangeAuthorizationCode(input) {
      const discovery = await provider.discoverConfiguration()
      if (!discovery.ok) return err(discovery)
      try {
        const body = new URLSearchParams({
          grant_type: 'authorization_code',
          code: input.code,
          redirect_uri: options.provider.redirectUri,
          client_id: options.provider.clientId,
          code_verifier: input.codeVerifier
        })
        const response = await fetchImpl(discovery.configuration.tokenEndpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body
        })
        if (!response.ok) {
          return err(invalidTokenFailure('OIDC authorization code exchange was rejected'))
        }
        const payload: unknown = await response.json()
        if (!Value.Check(OidcTokenResponseSchema, payload)) {
          return err(invalidTokenFailure('OIDC token response is missing id_token'))
        }
        const verified = await provider.verifyIdToken({
          token: payload.id_token,
          nonce: input.nonce
        })
        if (!verified.ok) return err(verified)
        return ok({
          oidcIssuer: verified.session.issuer,
          oidcSubject: verified.session.subject,
          display: {
            ...(verified.session.email ? { email: verified.session.email } : {}),
            ...(verified.session.displayName ? { name: verified.session.displayName } : {})
          }
        })
      } catch {
        return err(unavailableFailure('OIDC authorization code exchange is unavailable'))
      }
    }
  }
}
