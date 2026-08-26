import { describe, expect, it } from 'bun:test'
import { validateDiscoveryDocument } from '../../../packages/auth/src/oidc-provider-metadata.ts'
import { mapVerifiedPayloadToSession } from '../../../packages/auth/src/oidc-provider-token-validation.ts'

const issuer = 'https://keycloak.example.com/realms/meristem'

describe('OIDC provider support characterization', () => {
  it('maps complete discovery metadata into the provider configuration', () => {
    const result = validateDiscoveryDocument(issuer, {
      issuer,
      authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
      token_endpoint: `${issuer}/protocol/openid-connect/token`,
      jwks_uri: `${issuer}/protocol/openid-connect/certs`
    })

    expect(result).toEqual({
      ok: true,
      configuration: {
        issuer,
        authorizationEndpoint: `${issuer}/protocol/openid-connect/auth`,
        tokenEndpoint: `${issuer}/protocol/openid-connect/token`,
        jwksUri: `${issuer}/protocol/openid-connect/certs`
      }
    })
  })

  it('maps missing JWKS metadata to the exact discovery failure', () => {
    const result = validateDiscoveryDocument(issuer, {
      issuer,
      authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
      token_endpoint: `${issuer}/protocol/openid-connect/token`
    })

    expect(result).toEqual({
      ok: false,
      code: 'invalid_discovery',
      field: 'jwks_uri',
      message: 'OIDC JWKS URI is required'
    })
  })

  it('maps verified claims into a redaction-safe actor session', () => {
    const result = mapVerifiedPayloadToSession(
      {
        sub: 'operator-1',
        groups: ['operator', 'network-admin'],
        iss: issuer,
        exp: 1_800_000_000,
        preferred_username: 'Meristem Operator',
        email: 'operator@example.com',
        aud: 'meristem-m-ui-bff'
      },
      {
        subjectClaim: 'sub',
        groupsClaim: 'groups',
        displayNameClaim: 'preferred_username',
        emailClaim: 'email',
        audienceClaim: 'aud'
      }
    )

    expect(result).toEqual({
      subject: 'operator-1',
      groups: ['operator', 'network-admin'],
      issuer,
      expiresAt: '2027-01-15T08:00:00.000Z',
      displayName: 'Meristem Operator',
      email: 'operator@example.com',
      audience: 'meristem-m-ui-bff'
    })
  })

  it('maps a missing groups claim to the exact tagged failure', () => {
    const result = mapVerifiedPayloadToSession(
      { sub: 'operator-1', iss: issuer, exp: 1_800_000_000 },
      { subjectClaim: 'sub', groupsClaim: 'groups' }
    )

    expect(result).toEqual({
      ok: false,
      code: 'missing_claim',
      claim: 'groups',
      message: 'OIDC token is missing required claim: groups'
    })
  })
})
