import type {
  LocalIamError,
  LocalIamPrincipal,
  LocalIamRole,
  LocalIamSessionRead,
  OidcAuthFailure
} from '../../../../packages/auth/src/index.ts'
import { createOidcLoginTransactionStore } from '../../../../packages/auth/src/index.ts'
import type { MUiBffOidcAuthDeps } from '../deps.ts'

const sessionCookieName = '__Host-meristem-session'

export type BffAuthResponse = {
  readonly status: number
  readonly body?: unknown
  readonly location?: string
  readonly sessionCookie?: string
}

type BffAuthenticatedSession = {
  readonly principal: LocalIamPrincipal
  readonly session: LocalIamSessionRead['session']
  readonly csrfToken: string
  readonly sessionCookie?: string
}

function correlationId(): string {
  return `bff-auth-${crypto.randomUUID()}`
}

function sessionCookie(sessionId: string, expiresAt: string): string {
  const maxAge = Math.max(1, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1_000))
  return `${sessionCookieName}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`
}

function clearedSessionCookie(): string {
  return `${sessionCookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
}

function readSessionCookie(header: string | undefined): string | null {
  if (!header) return null
  for (const entry of header.split(';')) {
    const [name, ...valueParts] = entry.trim().split('=')
    if (name !== sessionCookieName) continue
    const value = valueParts.join('=')
    if (!value) return null
    try {
      return decodeURIComponent(value)
    } catch {
      return null
    }
  }
  return null
}

function sameToken(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

function errorStatus(error: LocalIamError): number {
  switch (error.code) {
    case 'principal_not_found':
      return 404
    case 'principal_disabled':
    case 'principal_rejected':
    case 'policy_denied':
      return 403
    case 'session_not_found':
    case 'session_expired':
    case 'session_revoked':
      return 401
    case 'policy_unavailable':
    case 'audit_unavailable':
      return 503
    default:
      return 409
  }
}

function localIamFailure(error: LocalIamError, clearCookie = false): BffAuthResponse {
  return {
    status: errorStatus(error),
    body: { error: { code: `auth.${error.code}`, message: error.message } },
    ...(clearCookie ? { sessionCookie: clearedSessionCookie() } : {})
  }
}

function isProviderUnavailable(error: OidcAuthFailure): boolean {
  return error.code === 'invalid_discovery' || error.code === 'stale_jwks'
}

function providerFailure(error: OidcAuthFailure): BffAuthResponse {
  const unavailable = isProviderUnavailable(error)
  return {
    status: unavailable ? 503 : 401,
    body: {
      error: {
        code: unavailable ? 'auth.keycloak_unavailable' : 'auth.invalid_oidc_token',
        message: unavailable
          ? 'OIDC provider is unavailable'
          : 'OIDC identity could not be verified'
      }
    }
  }
}

function safeReturnTo(value: string | undefined): string | null {
  const fallback = '/control-room'
  if (value === undefined) return fallback
  if (!value.startsWith('/') || value.startsWith('//')) return null
  return value
}

/**
 * BFF auth support 只处理 HTTP 与 local IAM/OIDC 端口之间的编排，
 * 由路由层负责最终 Response 映射，避免 support helper 操作 Elysia response 对象。
 */
export function createBffAuthSupport(auth: MUiBffOidcAuthDeps | undefined) {
  const transactions = auth?.transactions ?? createOidcLoginTransactionStore()

  async function authenticate(
    headers: Record<string, string | undefined>
  ): Promise<BffAuthenticatedSession | BffAuthResponse> {
    if (!auth) {
      return {
        status: 503,
        body: {
          error: { code: 'auth.not_configured', message: 'OIDC session support is unavailable' }
        }
      }
    }
    const sessionId = readSessionCookie(headers.cookie)
    if (!sessionId) {
      return {
        status: 401,
        body: { error: { code: 'auth.session_missing', message: 'A browser session is required' } },
        sessionCookie: clearedSessionCookie()
      }
    }
    const result = await auth.iam.getSession({ sessionId, correlationId: correlationId() })
    if (!result.ok) {
      return localIamFailure(result.error, true)
    }
    return {
      principal: result.value.principal,
      session: result.value.session,
      csrfToken: result.value.csrfToken,
      ...(result.value.kind === 'rotated'
        ? {
            sessionCookie: sessionCookie(
              result.value.session.sessionId,
              result.value.session.expiresAt
            )
          }
        : {})
    }
  }

  async function csrfAuthenticated(
    headers: Record<string, string | undefined>
  ): Promise<BffAuthenticatedSession | BffAuthResponse> {
    const authenticated = await authenticate(headers)
    if ('status' in authenticated) return authenticated
    const csrfToken = headers['x-csrf-token'] ?? headers['X-CSRF-Token']
    if (!csrfToken || !sameToken(csrfToken, authenticated.csrfToken)) {
      return {
        status: 403,
        body: { error: { code: 'auth.csrf_invalid', message: 'CSRF validation failed' } },
        ...(authenticated.sessionCookie ? { sessionCookie: authenticated.sessionCookie } : {})
      }
    }
    return authenticated
  }

  return {
    async startLogin(returnTo: string | undefined): Promise<BffAuthResponse> {
      if (!auth) {
        return {
          status: 503,
          body: {
            error: { code: 'auth.not_configured', message: 'OIDC session support is unavailable' }
          }
        }
      }
      const destination = safeReturnTo(returnTo)
      if (destination === null) {
        return {
          status: 400,
          body: {
            error: { code: 'auth.invalid_return_to', message: 'returnTo must be a local path' }
          }
        }
      }
      const transaction = await transactions.create({ returnTo: destination })
      const authorization = await auth.oidc.createAuthorizationUrl({
        state: transaction.state,
        nonce: transaction.nonce,
        codeChallenge: transaction.codeChallenge
      })
      if (!authorization.ok) {
        if (!isProviderUnavailable(authorization.error)) return providerFailure(authorization.error)
        const invalidated = await auth.iam.invalidateProviderSessions({
          correlationId: correlationId()
        })
        return invalidated.ok
          ? providerFailure(authorization.error)
          : localIamFailure(invalidated.error, true)
      }
      return { status: 302, location: authorization.value.authorizationUrl }
    },

    async completeLogin(input: { code: string; state: string }): Promise<BffAuthResponse> {
      if (!auth) {
        return {
          status: 503,
          body: {
            error: { code: 'auth.not_configured', message: 'OIDC session support is unavailable' }
          }
        }
      }
      const transaction = transactions.consume(input.state)
      if (transaction === null) {
        return {
          status: 400,
          body: {
            error: { code: 'auth.invalid_state', message: 'OIDC state is invalid or expired' }
          }
        }
      }
      const identity = await auth.oidc.exchangeAuthorizationCode({
        code: input.code,
        codeVerifier: transaction.codeVerifier,
        nonce: transaction.nonce
      })
      if (!identity.ok) {
        if (!isProviderUnavailable(identity.error)) return providerFailure(identity.error)
        const invalidated = await auth.iam.invalidateProviderSessions({
          correlationId: correlationId()
        })
        return invalidated.ok
          ? providerFailure(identity.error)
          : localIamFailure(invalidated.error, true)
      }
      const resolved = await auth.iam.resolveLogin({
        identity: identity.value,
        correlationId: correlationId()
      })
      if (!resolved.ok) return localIamFailure(resolved.error)
      if (resolved.value.kind === 'pending_principal_created') {
        return {
          status: 409,
          body: {
            kind: resolved.value.kind,
            principal: resolved.value.principal,
            audit: resolved.value.audit
          }
        }
      }
      if (resolved.value.kind === 'denied') {
        return {
          status: 403,
          body: {
            kind: resolved.value.kind,
            reason: resolved.value.reason,
            principal: resolved.value.principal,
            audit: resolved.value.audit
          }
        }
      }
      const issued = await auth.iam.issueSession({
        principalId: resolved.value.principal.principalId,
        correlationId: correlationId()
      })
      if (!issued.ok) return localIamFailure(issued.error)
      return {
        status: 302,
        location: transaction.returnTo,
        sessionCookie: sessionCookie(issued.value.session.sessionId, issued.value.session.expiresAt)
      }
    },

    async session(headers: Record<string, string | undefined>): Promise<BffAuthResponse> {
      const authenticated = await authenticate(headers)
      if ('status' in authenticated) return authenticated
      return {
        status: 200,
        body: {
          authenticated: true,
          principal: authenticated.principal,
          csrfToken: authenticated.csrfToken,
          expiresAt: authenticated.session.expiresAt
        },
        ...(authenticated.sessionCookie ? { sessionCookie: authenticated.sessionCookie } : {})
      }
    },

    async rotate(headers: Record<string, string | undefined>): Promise<BffAuthResponse> {
      if (!auth) {
        return {
          status: 503,
          body: {
            error: { code: 'auth.not_configured', message: 'OIDC session support is unavailable' }
          }
        }
      }
      const authenticated = await csrfAuthenticated(headers)
      if ('status' in authenticated) return authenticated
      const rotated = await auth.iam.rotateSession({
        sessionId: authenticated.session.sessionId,
        correlationId: correlationId()
      })
      if (!rotated.ok) return localIamFailure(rotated.error, true)
      return {
        status: 200,
        body: {
          authenticated: true,
          principal: rotated.value.principal,
          csrfToken: rotated.value.csrfToken,
          expiresAt: rotated.value.session.expiresAt
        },
        sessionCookie: sessionCookie(
          rotated.value.session.sessionId,
          rotated.value.session.expiresAt
        )
      }
    },

    async logout(headers: Record<string, string | undefined>): Promise<BffAuthResponse> {
      if (!auth) {
        return {
          status: 503,
          body: {
            error: { code: 'auth.not_configured', message: 'OIDC session support is unavailable' }
          }
        }
      }
      const authenticated = await csrfAuthenticated(headers)
      if ('status' in authenticated) return authenticated
      const logout = await auth.iam.logout({
        sessionId: authenticated.session.sessionId,
        correlationId: correlationId()
      })
      if (!logout.ok) {
        return { ...localIamFailure(logout.error, true), sessionCookie: clearedSessionCookie() }
      }
      return {
        status: 200,
        body: {
          kind: 'logged_out',
          sessionId: logout.value.sessionId,
          cookieCleared: true,
          serverSessionDestroyed: true,
          frontChannelOidcLogout: 'skipped',
          audit: logout.value.audit
        },
        sessionCookie: clearedSessionCookie()
      }
    },

    async approve(
      headers: Record<string, string | undefined>,
      principalId: string,
      roles: readonly LocalIamRole[]
    ): Promise<BffAuthResponse> {
      if (!auth)
        return {
          status: 503,
          body: {
            error: { code: 'auth.not_configured', message: 'OIDC session support is unavailable' }
          }
        }
      const authenticated = await csrfAuthenticated(headers)
      if ('status' in authenticated) return authenticated
      const result = await auth.iam.approve({
        principalId,
        actorPrincipalId: authenticated.principal.principalId,
        actorRoles: authenticated.session.rolesSnapshot,
        roles,
        correlationId: correlationId()
      })
      return result.ok
        ? {
            status: 200,
            body: result.value,
            ...(authenticated.sessionCookie ? { sessionCookie: authenticated.sessionCookie } : {})
          }
        : localIamFailure(result.error)
    },

    async reject(
      headers: Record<string, string | undefined>,
      principalId: string,
      reason: string
    ): Promise<BffAuthResponse> {
      if (!auth)
        return {
          status: 503,
          body: {
            error: { code: 'auth.not_configured', message: 'OIDC session support is unavailable' }
          }
        }
      const authenticated = await csrfAuthenticated(headers)
      if ('status' in authenticated) return authenticated
      const result = await auth.iam.reject({
        principalId,
        actorPrincipalId: authenticated.principal.principalId,
        actorRoles: authenticated.session.rolesSnapshot,
        reason,
        correlationId: correlationId()
      })
      return result.ok
        ? {
            status: 200,
            body: result.value,
            ...(authenticated.sessionCookie ? { sessionCookie: authenticated.sessionCookie } : {})
          }
        : localIamFailure(result.error)
    },

    async replaceRoles(
      headers: Record<string, string | undefined>,
      principalId: string,
      roles: readonly LocalIamRole[]
    ): Promise<BffAuthResponse> {
      if (!auth)
        return {
          status: 503,
          body: {
            error: { code: 'auth.not_configured', message: 'OIDC session support is unavailable' }
          }
        }
      const authenticated = await csrfAuthenticated(headers)
      if ('status' in authenticated) return authenticated
      const result = await auth.iam.replaceRoles({
        principalId,
        actorPrincipalId: authenticated.principal.principalId,
        actorRoles: authenticated.session.rolesSnapshot,
        roles,
        correlationId: correlationId()
      })
      return result.ok
        ? {
            status: 200,
            body: result.value,
            ...(authenticated.sessionCookie ? { sessionCookie: authenticated.sessionCookie } : {})
          }
        : localIamFailure(result.error)
    },

    async disable(
      headers: Record<string, string | undefined>,
      principalId: string,
      reason: string
    ): Promise<BffAuthResponse> {
      if (!auth)
        return {
          status: 503,
          body: {
            error: { code: 'auth.not_configured', message: 'OIDC session support is unavailable' }
          }
        }
      const authenticated = await csrfAuthenticated(headers)
      if ('status' in authenticated) return authenticated
      const result = await auth.iam.disable({
        principalId,
        actorPrincipalId: authenticated.principal.principalId,
        actorRoles: authenticated.session.rolesSnapshot,
        reason,
        correlationId: correlationId()
      })
      return result.ok
        ? {
            status: 200,
            body: result.value,
            ...(authenticated.sessionCookie ? { sessionCookie: authenticated.sessionCookie } : {})
          }
        : localIamFailure(result.error)
    }
  }
}

/** 将 support 的显式结果映射为标准 Response，集中处理 cookie 和 redirect header。 */
export function toBffAuthResponse(result: BffAuthResponse): Response {
  const headers = new Headers()
  if (result.location) headers.set('location', result.location)
  if (result.sessionCookie) headers.set('set-cookie', result.sessionCookie)
  if (result.body !== undefined) headers.set('content-type', 'application/json')
  return new Response(result.body === undefined ? null : JSON.stringify(result.body), {
    status: result.status,
    headers
  })
}
