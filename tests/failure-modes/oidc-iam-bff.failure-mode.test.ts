import { describe, expect, test } from 'bun:test'
import { createMUiBffApp } from '../../services/m-ui-bff/src/app.ts'
import {
  createLocalIamService,
  createOidcLoginTransactionStore,
  type LocalIamAuditFact,
  type OidcAuthorizationCodeClient
} from '../../packages/auth/src/index.ts'

const issuer = 'https://keycloak.example.com/realms/meristem'

function createEnvironment() {
  let now = new Date('2026-07-24T10:00:00.000Z')
  let failAudit = false
  const auditFacts: LocalIamAuditFact[] = []
  const iam = createLocalIamService({
    now: () => new Date(now),
    sessionTtlMs: 1_000,
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
      },
      {
        contractVersion: 'oidc-iam-principal@0.1.0',
        principalId: 'principal-operator',
        oidcIssuer: issuer,
        oidcSubject: 'operator-subject',
        status: 'approved',
        roles: ['operator'],
        display: { name: 'Operator' },
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
          : { ok: false, error: { code: 'policy_denied', message: 'Security-admin required' } }
      }
    },
    audit: {
      async write(fact) {
        if (failAudit) {
          return { ok: false, error: { code: 'audit_unavailable', message: 'M-Log is unavailable' } }
        }
        auditFacts.push(fact)
        return { ok: true, value: undefined }
      }
    }
  })
  const oidc: OidcAuthorizationCodeClient = {
    async createAuthorizationUrl(input) {
      const url = new URL('https://keycloak.example.com/login')
      url.searchParams.set('state', input.state)
      return { ok: true, value: { authorizationUrl: url.toString() } }
    },
    async exchangeAuthorizationCode(input) {
      if (input.code === 'outage') {
        return {
          ok: false,
          error: { ok: false, code: 'invalid_discovery', message: 'provider unavailable' }
        }
      }
      if (input.code === 'bad-token') {
        return { ok: false, error: { ok: false, code: 'invalid_token', message: 'token rejected' } }
      }
      return {
        ok: true,
        value: {
          oidcIssuer: issuer,
          oidcSubject: input.code,
          display: { name: input.code }
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

  return {
    app,
    auditFacts,
    iam,
    advance(milliseconds: number) {
      now = new Date(now.getTime() + milliseconds)
    },
    setAuditFailure(value: boolean) {
      failAudit = value
    }
  }
}

async function issueSession(environment: ReturnType<typeof createEnvironment>, principalId: string) {
  const result = await environment.iam.issueSession({ principalId, correlationId: `corr-${principalId}` })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function headersFor(session: { session: { sessionId: string }; csrfToken: string }, csrf = true) {
  return {
    cookie: `__Host-meristem-session=${encodeURIComponent(session.session.sessionId)}`,
    'content-type': 'application/json',
    ...(csrf ? { 'x-csrf-token': session.csrfToken } : {})
  }
}

async function authorizationState(app: ReturnType<typeof createMUiBffApp>) {
  const response = await app.handle(
    new Request('http://localhost/api/v0/auth/oidc/login?returnTo=/control-room')
  )
  const location = response.headers.get('location')
  if (location === null) throw new Error('Missing authorization redirect')
  const state = new URL(location).searchParams.get('state')
  if (state === null) throw new Error('Missing state')
  return state
}

describe('OIDC local IAM BFF failure modes', () => {
  test('rejects cross-site mutations without a synchronizer CSRF token', async () => {
    const environment = createEnvironment()
    const session = await issueSession(environment, 'principal-operator')

    const response = await environment.app.handle(
      new Request('http://localhost/api/v0/auth/logout', {
        method: 'POST',
        headers: headersFor(session, false)
      })
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'auth.csrf_invalid' } })
    const active = await environment.iam.getSession({
      sessionId: session.session.sessionId,
      correlationId: 'corr-csrf-check'
    })
    expect(active.ok).toBe(true)
  })

  test('expires server-side sessions and clears the browser cookie', async () => {
    const environment = createEnvironment()
    const session = await issueSession(environment, 'principal-operator')
    environment.advance(1_001)

    const response = await environment.app.handle(
      new Request('http://localhost/api/v0/auth/session', {
        headers: { cookie: `__Host-meristem-session=${session.session.sessionId}` }
      })
    )

    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(await response.json()).toMatchObject({ error: { code: 'auth.session_expired' } })
  })

  test('role removal revokes existing sessions instead of silently shrinking permissions', async () => {
    const environment = createEnvironment()
    const operatorSession = await issueSession(environment, 'principal-operator')
    const adminSession = await issueSession(environment, 'principal-security-admin')

    const roleChange = await environment.app.handle(
      new Request('http://localhost/api/v0/auth/principals/principal-operator/roles', {
        method: 'PUT',
        headers: headersFor(adminSession),
        body: JSON.stringify({ roles: [] })
      })
    )
    expect(roleChange.status).toBe(200)

    const afterRevocation = await environment.app.handle(
      new Request('http://localhost/api/v0/auth/session', {
        headers: { cookie: `__Host-meristem-session=${operatorSession.session.sessionId}` }
      })
    )
    expect(afterRevocation.status).toBe(401)
    expect(await afterRevocation.json()).toMatchObject({ error: { code: 'auth.session_revoked' } })
    expect(environment.auditFacts.map(fact => fact.action)).toContain('principal.roles_revoked')
    expect(environment.auditFacts.map(fact => fact.action)).toContain('session.revoked')
  })

  test('partial session-revocation Audit failure never leaves an audited session active', async () => {
    const auditedSessionIds: string[] = []
    let revocationWrites = 0
    const iam = createLocalIamService({
      initialPrincipals: [
        {
          contractVersion: 'oidc-iam-principal@0.1.0',
          principalId: 'principal-operator',
          oidcIssuer: issuer,
          oidcSubject: 'operator-subject',
          status: 'approved',
          roles: ['operator'],
          display: { name: 'Operator' },
          createdAt: '2026-07-24T10:00:00.000Z',
          updatedAt: '2026-07-24T10:00:00.000Z',
          approvedAt: '2026-07-24T10:00:00.000Z',
          approvedBy: 'security-admin'
        }
      ],
      policy: { async authorize() { return { ok: true, value: undefined } } },
      audit: {
        async write(fact) {
          if (fact.action === 'session.revoked') {
            revocationWrites += 1
            if (revocationWrites === 2) {
              return { ok: false, error: { code: 'audit_unavailable', message: 'M-Log unavailable' } }
            }
            if (fact.sessionId !== undefined) auditedSessionIds.push(fact.sessionId)
          }
          return { ok: true, value: undefined }
        }
      }
    })
    const first = await iam.issueSession({ principalId: 'principal-operator', correlationId: 'corr-first' })
    const second = await iam.issueSession({ principalId: 'principal-operator', correlationId: 'corr-second' })
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) throw new Error('Expected active operator sessions')

    const result = await iam.replaceRoles({
      principalId: 'principal-operator',
      actorPrincipalId: 'principal-security-admin',
      actorRoles: ['security-admin'],
      roles: [],
      correlationId: 'corr-role-revoke'
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'audit_unavailable' } })

    const firstRead = await iam.getSession({ sessionId: first.value.session.sessionId, correlationId: 'corr-check-first' })
    const secondRead = await iam.getSession({ sessionId: second.value.session.sessionId, correlationId: 'corr-check-second' })
    expect(firstRead).toMatchObject({ ok: false, error: { code: 'session_revoked' } })
    expect(secondRead.ok).toBe(true)
    expect(auditedSessionIds).toEqual([first.value.session.sessionId])
  })

  test('role grants rotate active sessions before their expanded role snapshot becomes visible', async () => {
    const environment = createEnvironment()
    const operatorSession = await issueSession(environment, 'principal-operator')
    const adminSession = await issueSession(environment, 'principal-security-admin')

    const roleChange = await environment.app.handle(
      new Request('http://localhost/api/v0/auth/principals/principal-operator/roles', {
        method: 'PUT',
        headers: headersFor(adminSession),
        body: JSON.stringify({ roles: ['operator', 'viewer'] })
      })
    )
    expect(roleChange.status).toBe(200)

    const refreshed = await environment.app.handle(
      new Request('http://localhost/api/v0/auth/session', {
        headers: { cookie: `__Host-meristem-session=${operatorSession.session.sessionId}` }
      })
    )
    expect(refreshed.status).toBe(200)
    expect(refreshed.headers.get('set-cookie')).toContain('__Host-meristem-session=')
    expect(environment.auditFacts.map(fact => fact.action)).toContain('principal.roles_assigned')
    expect(environment.auditFacts.map(fact => fact.action)).toContain('session.rotated')

    const previous = await environment.app.handle(
      new Request('http://localhost/api/v0/auth/session', {
        headers: { cookie: `__Host-meristem-session=${operatorSession.session.sessionId}` }
      })
    )
    expect(previous.status).toBe(401)
  })

  test('rotates an active session only after validating the server-bound CSRF token', async () => {
    const environment = createEnvironment()
    const session = await issueSession(environment, 'principal-operator')

    const rotated = await environment.app.handle(
      new Request('http://localhost/api/v0/auth/session/rotate', {
        method: 'POST',
        headers: headersFor(session)
      })
    )
    expect(rotated.status).toBe(200)
    expect(rotated.headers.get('set-cookie')).toContain('__Host-meristem-session=')
    const body = (await rotated.json()) as { csrfToken: string }
    expect(body.csrfToken).not.toBe(session.csrfToken)

    const previous = await environment.app.handle(
      new Request('http://localhost/api/v0/auth/session', {
        headers: { cookie: `__Host-meristem-session=${session.session.sessionId}` }
      })
    )
    expect(previous.status).toBe(401)
  })

  test('disabled local accounts block both current and future OIDC sessions', async () => {
    const environment = createEnvironment()
    const operatorSession = await issueSession(environment, 'principal-operator')
    const adminSession = await issueSession(environment, 'principal-security-admin')

    const disable = await environment.app.handle(
      new Request('http://localhost/api/v0/auth/principals/principal-operator/disable', {
        method: 'POST',
        headers: headersFor(adminSession),
        body: JSON.stringify({ reason: 'Account disabled for investigation' })
      })
    )
    expect(disable.status).toBe(200)

    const current = await environment.app.handle(
      new Request('http://localhost/api/v0/auth/session', {
        headers: { cookie: `__Host-meristem-session=${operatorSession.session.sessionId}` }
      })
    )
    expect(current.status).toBe(401)
    expect(await current.json()).toMatchObject({ error: { code: 'auth.session_revoked' } })

    const state = await authorizationState(environment.app)
    const future = await environment.app.handle(
      new Request(
        `http://localhost/api/v0/auth/oidc/callback?code=operator-subject&state=${encodeURIComponent(state)}`
      )
    )
    expect(future.status).toBe(403)
    expect(await future.json()).toMatchObject({ kind: 'denied', reason: 'principal_disabled' })
    expect(environment.auditFacts.map(fact => fact.action)).toContain('principal.disabled')
  })

  test('provider outage revokes active sessions and returns a typed fail-closed error', async () => {
    const environment = createEnvironment()
    const session = await issueSession(environment, 'principal-operator')
    const state = await authorizationState(environment.app)

    const outage = await environment.app.handle(
      new Request(
        `http://localhost/api/v0/auth/oidc/callback?code=outage&state=${encodeURIComponent(state)}`
      )
    )
    expect(outage.status).toBe(503)
    expect(await outage.json()).toMatchObject({ error: { code: 'auth.keycloak_unavailable' } })

    const afterOutage = await environment.app.handle(
      new Request('http://localhost/api/v0/auth/session', {
        headers: { cookie: `__Host-meristem-session=${session.session.sessionId}` }
      })
    )
    expect(afterOutage.status).toBe(401)
    expect(environment.auditFacts.map(fact => fact.action)).toContain('provider.unavailable')
  })

  test('invalid OIDC material fails the login without revoking unrelated server sessions', async () => {
    const environment = createEnvironment()
    const session = await issueSession(environment, 'principal-operator')
    const state = await authorizationState(environment.app)

    const rejected = await environment.app.handle(
      new Request(
        `http://localhost/api/v0/auth/oidc/callback?code=bad-token&state=${encodeURIComponent(state)}`
      )
    )
    expect(rejected.status).toBe(401)
    expect(await rejected.json()).toMatchObject({ error: { code: 'auth.invalid_oidc_token' } })

    const stillActive = await environment.app.handle(
      new Request('http://localhost/api/v0/auth/session', {
        headers: { cookie: `__Host-meristem-session=${session.session.sessionId}` }
      })
    )
    expect(stillActive.status).toBe(200)
  })

  test('Audit unavailability blocks JIT principal creation and maps to a typed server failure', async () => {
    const environment = createEnvironment()
    environment.setAuditFailure(true)
    const firstState = await authorizationState(environment.app)

    const blocked = await environment.app.handle(
      new Request(
        `http://localhost/api/v0/auth/oidc/callback?code=audit-pending&state=${encodeURIComponent(firstState)}`
      )
    )
    expect(blocked.status).toBe(503)
    expect(blocked.headers.get('set-cookie')).toBeNull()
    expect(await blocked.json()).toMatchObject({ error: { code: 'auth.audit_unavailable' } })

    environment.setAuditFailure(false)
    const secondState = await authorizationState(environment.app)
    const retried = await environment.app.handle(
      new Request(
        `http://localhost/api/v0/auth/oidc/callback?code=audit-pending&state=${encodeURIComponent(secondState)}`
      )
    )
    expect(retried.status).toBe(409)
  })

  test('logout destroys the server session, clears the cookie, and writes an audit fact', async () => {
    const environment = createEnvironment()
    const session = await issueSession(environment, 'principal-operator')

    const response = await environment.app.handle(
      new Request('http://localhost/api/v0/auth/logout', {
        method: 'POST',
        headers: headersFor(session)
      })
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(await response.json()).toMatchObject({
      kind: 'logged_out',
      serverSessionDestroyed: true,
      cookieCleared: true
    })
    expect(environment.auditFacts.map(fact => fact.action)).toContain('session.logout')
  })
})
