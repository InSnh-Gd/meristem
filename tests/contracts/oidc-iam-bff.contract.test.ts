import { describe, expect, test } from 'bun:test'
import { createMUiBffApp } from '../../services/m-ui-bff/src/app.ts'
import {
  createLocalIamService,
  createOidcLoginTransactionStore,
  type LocalIamAuditFact,
  type OidcAuthorizationCodeClient
} from '../../packages/auth/src/index.ts'

const issuer = 'https://keycloak.example.com/realms/meristem'
const now = new Date('2026-07-24T10:00:00.000Z')

type TestEnvironment = ReturnType<typeof createTestEnvironment>

function createTestEnvironment() {
  const auditFacts: LocalIamAuditFact[] = []
  const iam = createLocalIamService({
    now: () => new Date(now),
    sessionTtlMs: 60_000,
    initialPrincipals: [
      {
        contractVersion: 'oidc-iam-principal@0.1.0',
        principalId: 'principal-security-admin',
        oidcIssuer: issuer,
        oidcSubject: 'security-admin-subject',
        status: 'approved',
        roles: ['security-admin'],
        display: { name: 'Security Administrator' },
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        approvedAt: now.toISOString(),
        approvedBy: 'security-admin'
      }
    ],
    policy: {
      async authorize(input) {
        return input.actorRoles.includes('security-admin')
          ? { ok: true, value: undefined }
          : {
              ok: false,
              error: {
                code: 'policy_denied',
                message: 'A security-admin role is required for local IAM changes'
              }
            }
      }
    },
    audit: {
      async write(fact) {
        auditFacts.push(fact)
        return { ok: true, value: undefined }
      }
    }
  })

  const observedAuthorizations: Array<{
    state: string
    nonce: string
    codeChallenge: string
  }> = []
  const observedExchanges: Array<{ code: string; codeVerifier: string; nonce: string }> = []
  const oidc: OidcAuthorizationCodeClient = {
    async createAuthorizationUrl(input) {
      observedAuthorizations.push(input)
      const url = new URL('https://keycloak.example.com/realms/meristem/protocol/openid-connect/auth')
      url.searchParams.set('state', input.state)
      url.searchParams.set('nonce', input.nonce)
      url.searchParams.set('code_challenge', input.codeChallenge)
      url.searchParams.set('code_challenge_method', 'S256')
      return { ok: true, value: { authorizationUrl: url.toString() } }
    },
    async exchangeAuthorizationCode(input) {
      observedExchanges.push(input)
      if (input.code === 'outage') {
        return {
          ok: false,
          error: { ok: false, code: 'invalid_discovery', message: 'Keycloak is unavailable' }
        }
      }

      return {
        ok: true,
        value: {
          oidcIssuer: issuer,
          oidcSubject: input.code,
          display: {
            email: `${input.code}@example.com`,
            name: `User ${input.code}`,
            preferredUsername: input.code
          }
        }
      }
    }
  }

  const app = createMUiBffApp({
    coreBaseUrl: 'http://unused-core.example.test',
    authMode: 'oidc',
    auth: {
      iam,
      oidc,
      transactions: createOidcLoginTransactionStore({ now: () => new Date(now) })
    }
  })

  return { app, auditFacts, iam, observedAuthorizations, observedExchanges }
}

async function beginLogin(environment: TestEnvironment) {
  const response = await environment.app.handle(
    new Request('http://localhost/api/v0/auth/oidc/login?returnTo=/control-room')
  )
  expect(response.status).toBe(302)
  const location = response.headers.get('location')
  expect(location).not.toBeNull()
  if (location === null) throw new Error('OIDC login redirect location was missing')
  return new URL(location)
}

async function callback(environment: TestEnvironment, code: string) {
  const authorizationUrl = await beginLogin(environment)
  const state = authorizationUrl.searchParams.get('state')
  expect(state).not.toBeNull()
  if (state === null) throw new Error('OIDC state was missing')
  return environment.app.handle(
    new Request(
      `http://localhost/api/v0/auth/oidc/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`
    )
  )
}

async function issueSecurityAdminSession(environment: TestEnvironment) {
  const result = await environment.iam.issueSession({
    principalId: 'principal-security-admin',
    correlationId: 'corr-security-admin-session'
  })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function sessionHeaders(session: { session: { sessionId: string }; csrfToken: string }) {
  return {
    cookie: `__Host-meristem-session=${encodeURIComponent(session.session.sessionId)}`,
    'content-type': 'application/json',
    'x-csrf-token': session.csrfToken
  }
}

describe('OIDC local IAM BFF session contract', () => {
  test('starts authorization-code login with state, nonce, and PKCE before creating a pending principal', async () => {
    const environment = createTestEnvironment()
    const authorizationUrl = await beginLogin(environment)

    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorizationUrl.searchParams.get('state')).toHaveLength(43)
    expect(authorizationUrl.searchParams.get('nonce')).toHaveLength(43)
    expect(environment.observedAuthorizations).toHaveLength(1)
    const observedAuthorization = environment.observedAuthorizations[0]
    if (observedAuthorization === undefined) throw new Error('Expected captured OIDC authorization')

    const response = await environment.app.handle(
      new Request(
        `http://localhost/api/v0/auth/oidc/callback?code=pending-subject&state=${encodeURIComponent(authorizationUrl.searchParams.get('state') ?? '')}`
      )
    )

    expect(response.status).toBe(409)
    expect(response.headers.get('set-cookie')).toBeNull()
    const body = (await response.json()) as {
      kind: string
      principal: { status: string; roles: string[] }
    }
    expect(body.kind).toBe('pending_principal_created')
    expect(body.principal.status).toBe('pending')
    expect(body.principal.roles).toEqual([])
    expect(environment.observedExchanges).toEqual([
      {
        code: 'pending-subject',
        codeVerifier: expect.any(String),
        nonce: observedAuthorization.nonce
      }
    ])
    expect(environment.auditFacts.map(fact => fact.action)).toContain('principal.pending_created')
  })

  test('security-admin approval assigns local roles and allows a cookie-backed session', async () => {
    const environment = createTestEnvironment()
    const pendingResponse = await callback(environment, 'approved-subject')
    const pending = (await pendingResponse.json()) as { principal: { principalId: string } }
    const adminSession = await issueSecurityAdminSession(environment)

    const approval = await environment.app.handle(
      new Request(`http://localhost/api/v0/auth/principals/${pending.principal.principalId}/approve`, {
        method: 'POST',
        headers: sessionHeaders(adminSession),
        body: JSON.stringify({ roles: ['operator'] })
      })
    )

    expect(approval.status).toBe(200)
    const approved = (await approval.json()) as { principal: { status: string; roles: string[] } }
    expect(approved.principal.status).toBe('approved')
    expect(approved.principal.roles).toEqual(['operator'])

    const signedIn = await callback(environment, 'approved-subject')
    expect(signedIn.status).toBe(302)
    const cookie = signedIn.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('__Host-meristem-session=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Path=/')
    expect(cookie).not.toContain('Domain=')
    expect(environment.auditFacts.map(fact => fact.action)).toContain('principal.approved')
    expect(environment.auditFacts.map(fact => fact.action)).toContain('session.issued')
  })

  test('a rejected principal never receives a session', async () => {
    const environment = createTestEnvironment()
    const pendingResponse = await callback(environment, 'rejected-subject')
    const pending = (await pendingResponse.json()) as { principal: { principalId: string } }
    const adminSession = await issueSecurityAdminSession(environment)

    const rejection = await environment.app.handle(
      new Request(`http://localhost/api/v0/auth/principals/${pending.principal.principalId}/reject`, {
        method: 'POST',
        headers: sessionHeaders(adminSession),
        body: JSON.stringify({ reason: 'Identity proof could not be approved' })
      })
    )
    expect(rejection.status).toBe(200)

    const denied = await callback(environment, 'rejected-subject')
    expect(denied.status).toBe(403)
    expect(denied.headers.get('set-cookie')).toBeNull()
    expect(await denied.json()).toMatchObject({ kind: 'denied', reason: 'principal_rejected' })
    expect(environment.auditFacts.map(fact => fact.action)).toContain('principal.rejected')
  })

  test('rejects callbacks whose one-time state is missing or already consumed', async () => {
    const environment = createTestEnvironment()

    const missing = await environment.app.handle(
      new Request('http://localhost/api/v0/auth/oidc/callback?code=subject&state=unknown')
    )
    expect(missing.status).toBe(400)
    expect(await missing.json()).toMatchObject({ error: { code: 'auth.invalid_state' } })

    const login = await beginLogin(environment)
    const state = login.searchParams.get('state')
    if (state === null) throw new Error('Expected OIDC state')
    const first = await environment.app.handle(
      new Request(`http://localhost/api/v0/auth/oidc/callback?code=once&state=${encodeURIComponent(state)}`)
    )
    expect(first.status).toBe(409)
    const replay = await environment.app.handle(
      new Request(`http://localhost/api/v0/auth/oidc/callback?code=once&state=${encodeURIComponent(state)}`)
    )
    expect(replay.status).toBe(400)
  })

  test('rejects legacy Bearer headers while the BFF is in OIDC mode', async () => {
    const environment = createTestEnvironment()
    const response = await environment.app.handle(
      new Request('http://localhost/api/v0/overview', {
        headers: { authorization: 'Bearer local-development-token' }
      })
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'auth.bearer_development_only' } })
  })

  test('does not reflect arbitrary credentialed CORS origins in OIDC mode', async () => {
    const environment = createTestEnvironment()
    const response = await environment.app.handle(
      new Request('http://localhost/health', { headers: { origin: 'https://untrusted.example.test' } })
    )

    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('allows only configured credentialed CORS origins in OIDC mode', async () => {
    const app = createMUiBffApp({
      coreBaseUrl: 'http://unused-core.example.test',
      authMode: 'oidc',
      allowedOrigins: ['https://m-ui.example.test']
    })
    const response = await app.handle(
      new Request('http://localhost/health', { headers: { origin: 'https://m-ui.example.test' } })
    )

    expect(response.headers.get('access-control-allow-origin')).toBe('https://m-ui.example.test')
  })
})
