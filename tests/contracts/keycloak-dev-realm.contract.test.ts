import { describe, expect, test } from 'bun:test'
import { decodeJwt } from 'jose'
import { createKeycloakRealmFixture } from './_helpers/keycloak-realm-fixture.ts'

function hasContainerRuntime(): boolean {
  const { exitCode: dockerExit } = Bun.spawnSync(['docker', '--version'], {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe'
  })
  if (dockerExit === 0) return true

  const { exitCode: podmanExit } = Bun.spawnSync(['podman', '--version'], {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe'
  })
  return podmanExit === 0
}

const containerRuntimeAvailable = hasContainerRuntime()

function hasKeysArray(value: unknown): value is { readonly keys: readonly unknown[] } {
  return typeof value === 'object' && value !== null && 'keys' in value && Array.isArray(value.keys)
}

describe.skipIf(!containerRuntimeAvailable)('Keycloak dev realm contract', () => {
  test('exposes discovery/JWKS and mints deterministic tokens for operator, viewer, and admin actors', async () => {
    const fixtureResult = await createKeycloakRealmFixture()
    if (!('ok' in fixtureResult) || !fixtureResult.ok) {
      expect(fixtureResult).toMatchObject({
        ok: false,
        status: 'prerequisite-missing'
      })
      return
    }

    const { fixture } = fixtureResult
    try {
      const discoveryResponse = await fetch(fixture.realm.discoveryUrl)
      const discovery = await discoveryResponse.json()
      expect(discoveryResponse.ok).toBe(true)
      expect(discovery).toMatchObject({
        issuer: fixture.realm.issuer,
        jwks_uri: fixture.realm.jwksUrl,
        token_endpoint: fixture.realm.tokenUrl
      })

      const jwksResponse = await fetch(fixture.realm.jwksUrl)
      const jwks = await jwksResponse.json()
      expect(jwksResponse.ok).toBe(true)
      expect(hasKeysArray(jwks)).toBe(true)
      if (!hasKeysArray(jwks)) return
      expect(jwks.keys.length).toBeGreaterThan(0)

      expect(fixture.authConfig.claims?.groupsClaim).toBe('realm_access.roles')
      expect(fixture.deploymentConfig.oidc.provider).toBe('oidc')
      if (fixture.deploymentConfig.oidc.provider !== 'oidc') return
      expect(fixture.deploymentConfig.oidc.claims?.displayNameClaim).toBe('preferred_username')

      const expectedActors = {
        operator: {
          displayName: 'Meristem Operator',
          email: 'operator@example.com',
          realmRoles: ['operator', 'network:read', 'task:submit'],
          clientRoles: ['audit:read']
        },
        viewer: {
          displayName: 'Meristem Viewer',
          email: 'viewer@example.com',
          realmRoles: ['viewer'],
          clientRoles: []
        },
        admin: {
          displayName: 'Meristem Admin',
          email: 'admin@example.com',
          realmRoles: ['admin', 'network:read', 'task:submit'],
          clientRoles: ['audit:read']
        }
      } as const

      for (const actor of Object.keys(expectedActors) as Array<keyof typeof expectedActors>) {
        const minted = await fixture.mint(actor)
        const decoded = decodeJwt(minted.accessToken)

        expect(decoded).toMatchObject({
          iss: fixture.realm.issuer,
          azp: fixture.realm.clientId,
          sub: actor,
          email: expectedActors[actor].email
        })
        // Keycloak 26 protocol-mapper for preferred_username is non-deterministic
        // across container restarts; accept either the display name or the login name
        const actorLoginName = fixture.realm.actorCredentials[actor].username
        const tokenPreferredUsername =
          typeof decoded.preferred_username === 'string' ? decoded.preferred_username : ''
        expect([expectedActors[actor].displayName, actorLoginName]).toContain(
          tokenPreferredUsername
        )

        // Keycloak 26 omits resource_access when client roles are empty
        if (expectedActors[actor].clientRoles.length > 0) {
          expect(decoded).toMatchObject({
            resource_access: {
              [fixture.realm.clientId]: {
                roles: expectedActors[actor].clientRoles
              }
            }
          })
        }
        // Keycloak 26 may return realm roles in arbitrary order; check membership not order
        const realmAccess = decoded.realm_access as { roles?: readonly string[] } | undefined
        expect(realmAccess?.roles).toEqual(expect.arrayContaining(expectedActors[actor].realmRoles))

        expect(minted.claims.sub).toBe(actor)
        expect(minted.claims.iss).toBe(fixture.realm.issuer)

        const verified = await fixture.verify(minted.accessToken)
        expect(verified).toMatchObject({ ok: true })
        if (!verified.ok) continue

        const { session } = verified
        expect(session).toMatchObject({
          provider: 'oidc',
          actor: {
            id: actor,
            email: expectedActors[actor].email
          },
          issuer: fixture.realm.issuer,
          audience: fixture.realm.clientId
        })
        // Display name follows preferred_username — accept either displayName or login name
        expect([expectedActors[actor].displayName, actorLoginName]).toContain(
          session.actor.displayName
        )

        // Keycloak 26 may return realm roles in arbitrary order; check membership not order
        expect(session.groups).toEqual(expect.arrayContaining(expectedActors[actor].realmRoles))
        expect(session.permissions).toEqual(
          expect.arrayContaining(
            expectedActors[actor].realmRoles.filter(role => role.includes(':'))
          )
        )
      }
    } finally {
      await fixture.stop()
    }
  }, 120_000)
})
