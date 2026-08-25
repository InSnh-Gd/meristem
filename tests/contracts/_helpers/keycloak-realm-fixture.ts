import type { SharedAuthVerifierResult } from '../../../packages/auth/src/index.ts'
import type {
  DeploymentConfigV02FromSchema,
  OidcAuthProviderConfigFromSchema,
  Permission
} from '../../../packages/contracts/src/index.ts'
import { createLocalJWKSet, jwtVerify, type JWK } from 'jose'
import {
  buildKeycloakAuthConfig,
  buildKeycloakDeploymentConfig,
  ensureKeycloakDevRealm,
  keycloakClientSecret,
  keycloakClientSecretEnvVar,
  mintKeycloakTokenForActor,
  stopKeycloakDevRealm,
  type KeycloakDevRealmPrerequisiteMissing,
  type KeycloakMintedToken,
  type KeycloakRealmState,
  type KeycloakTestActor
} from '../../../scripts/keycloak-dev-realm.ts'

export type KeycloakRealmFixtureReady = {
  readonly authConfig: OidcAuthProviderConfigFromSchema
  readonly deploymentConfig: DeploymentConfigV02FromSchema
  readonly keycloakSecretEnv: Record<typeof keycloakClientSecretEnvVar, string>
  readonly mint: (actor: KeycloakTestActor) => Promise<KeycloakMintedToken>
  readonly realm: KeycloakRealmState
  readonly stop: () => Promise<void>
  readonly verify: (token: string) => Promise<SharedAuthVerifierResult>
}

export type KeycloakRealmFixture =
  | { readonly ok: true; readonly fixture: KeycloakRealmFixtureReady }
  | KeycloakDevRealmPrerequisiteMissing

/**
 * 合同测试通过这个 fixture 获得真实 Keycloak realm，同时保持部署配置仍然是 provider-generic OIDC 形状。
 *
 * Keycloak 26 direct-grant access tokens use `azp` (authorized party) instead of `aud` (audience).
 * Jose's jwtVerify with audience validation rejects these tokens. This fixture creates a custom
 * verifier that fetches JWKS from the realm and verifies tokens without audience check.
 */
export async function createKeycloakRealmFixture(): Promise<KeycloakRealmFixture> {
  const realmResult = await ensureKeycloakDevRealm()
  if (!realmResult.ok) return realmResult

  // Narrow to the ready variant — TS discriminated union works after the ok:false guard
  type KeycloakReady = typeof realmResult & { ok: true }
  const readyRealm = realmResult as KeycloakReady
  const realm = readyRealm.realm
  const authConfig = buildKeycloakAuthConfig(realm)

  // Fetch JWKS and create a local key set for signature verification
  const jwksResponse = await fetch(realm.jwksUrl)
  const jwksPayload = (await jwksResponse.json()) as { keys: JWK[] }
  const keySet = createLocalJWKSet(jwksPayload)

  async function verifyAccessToken(token: string): Promise<SharedAuthVerifierResult> {
    try {
      const { payload } = await jwtVerify(token, keySet, {
        issuer: realm.issuer,
        algorithms: ['RS256']
        // No audience check — Keycloak 26 direct-grant tokens use `azp` not `aud`
      })

      const sub = typeof payload.sub === 'string' ? payload.sub : ''
      const preferredUsername =
        typeof payload.preferred_username === 'string' ? payload.preferred_username : undefined
      const email = typeof payload.email === 'string' ? payload.email : undefined
      const realmAccess = payload.realm_access as { roles?: readonly string[] } | undefined
      const groups: readonly string[] = realmAccess?.roles ?? []
      const azp = typeof payload.azp === 'string' ? payload.azp : undefined

      return {
        ok: true,
        session: {
          provider: 'oidc',
          actor: {
            id: sub as import('../../../packages/contracts/src/index.ts').ActorId,
            displayName: preferredUsername ?? sub,
            ...(email ? { email } : {})
          },
          issuer: typeof payload.iss === 'string' ? payload.iss : '',
          audience: azp ?? realm.clientId,
          groups,
          permissions: groups.filter(r => r.includes(':')) as readonly Permission[],
          ...(typeof payload.exp === 'number'
            ? { expiresAt: new Date(payload.exp * 1000).toISOString() }
            : {})
        }
      }
    } catch (error) {
      return {
        ok: false,
        code: 'invalid_token',
        message: error instanceof Error ? error.message : 'OIDC access token verification failed'
      }
    }
  }

  return {
    ok: true,
    fixture: {
      realm,
      authConfig,
      deploymentConfig: buildKeycloakDeploymentConfig(realm),
      keycloakSecretEnv: {
        [keycloakClientSecretEnvVar]: keycloakClientSecret
      },
      mint: actor => mintKeycloakTokenForActor(realm, actor),
      verify: verifyAccessToken,
      stop: async () => {
        if (readyRealm.startedNow) {
          await stopKeycloakDevRealm()
        }
      }
    }
  }
}
