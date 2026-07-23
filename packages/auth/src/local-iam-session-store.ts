import { OidcIamContractVersions, oidcIamCookiePolicyV01 } from '../../contracts/src/index.ts'
import { err, ok, type Result } from '../../common/src/result.ts'
import {
  copyPrincipal,
  copySession,
  hasRoleRemoval,
  localIamStateFailure,
  sameRoles,
  type LocalIamAuditFact,
  type LocalIamAuditFactInput,
  type LocalIamError,
  type LocalIamIssuedSession,
  type LocalIamLogout,
  type LocalIamPrincipal,
  type LocalIamSession,
  type LocalIamSessionRead
} from './local-iam-types.ts'

type StoredSession = {
  session: LocalIamSession
  csrfToken: string
  rotationRequired: boolean
}

type LocalIamSessionStoreOptions = {
  readonly now: () => Date
  readonly sessionTtlMs: number
  readonly getPrincipal: (principalId: string) => LocalIamPrincipal | null
  readonly auditFact: (input: LocalIamAuditFactInput) => LocalIamAuditFact
  readonly writeAudit: (fact: LocalIamAuditFact) => Promise<Result<LocalIamAuditFact, LocalIamError>>
}

export type LocalIamSessionStore = {
  issueSession(input: {
    readonly principal: LocalIamPrincipal
    readonly correlationId: string
  }): Promise<Result<LocalIamIssuedSession, LocalIamError>>
  getSession(input: {
    readonly sessionId: string
    readonly correlationId: string
  }): Promise<Result<LocalIamSessionRead, LocalIamError>>
  rotateSession(input: {
    readonly sessionId: string
    readonly correlationId: string
  }): Promise<Result<LocalIamSessionRead, LocalIamError>>
  logout(input: {
    readonly sessionId: string
    readonly correlationId: string
  }): Promise<Result<LocalIamLogout, LocalIamError>>
  revokeForPrincipal(input: {
    readonly principal: LocalIamPrincipal
    readonly reason: Extract<LocalIamSession['revokedReason'], string>
    readonly correlationId: string
  }): Promise<Result<void, LocalIamError>>
  requireRotation(principalId: string): void
  invalidateProviderSessions(correlationId: string): Promise<Result<void, LocalIamError>>
}

/** BFF session 存储隔离 opaque ID、CSRF 材料、轮换和撤销，避免它们混入 principal 状态转换。 */
export function createLocalIamSessionStore(options: LocalIamSessionStoreOptions): LocalIamSessionStore {
  const sessions = new Map<string, StoredSession>()
  const sessionIdsByPrincipal = new Map<string, Set<string>>()

  function nowIso(): string {
    return options.now().toISOString()
  }

  function createSessionRecord(principal: LocalIamPrincipal): StoredSession {
    const issuedAt = options.now()
    return {
      session: {
        contractVersion: OidcIamContractVersions.session,
        sessionId: `session-${crypto.randomUUID()}`,
        principalId: principal.principalId,
        oidcIssuer: principal.oidcIssuer,
        oidcSubject: principal.oidcSubject,
        status: 'active',
        rolesSnapshot: [...principal.roles],
        cookie: { ...oidcIamCookiePolicyV01 },
        csrf: { required: true, mode: 'synchronizer-token', tokenBinding: 'server-side-session' },
        oidc: { stateRequired: true, nonceRequired: true, pkceRequired: true, tokensHeldBy: 'bff-server' },
        storage: { kind: 'server-side', storesOidcTokens: false },
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(issuedAt.getTime() + options.sessionTtlMs).toISOString(),
        rotatedAt: issuedAt.toISOString(),
        rotationReason: 'login'
      },
      csrfToken: crypto.randomUUID(),
      rotationRequired: false
    }
  }

  function store(record: StoredSession): void {
    sessions.set(record.session.sessionId, record)
    const ids = sessionIdsByPrincipal.get(record.session.principalId) ?? new Set<string>()
    ids.add(record.session.sessionId)
    sessionIdsByPrincipal.set(record.session.principalId, ids)
  }

  function remove(sessionId: string): void {
    const record = sessions.get(sessionId)
    if (record === undefined) return
    sessions.delete(sessionId)
    const ids = sessionIdsByPrincipal.get(record.session.principalId)
    ids?.delete(sessionId)
    if (ids?.size === 0) sessionIdsByPrincipal.delete(record.session.principalId)
  }

  async function revokeForPrincipal(input: {
    principal: LocalIamPrincipal
    reason: Extract<LocalIamSession['revokedReason'], string>
    correlationId: string
  }): Promise<Result<void, LocalIamError>> {
    const active = [...(sessionIdsByPrincipal.get(input.principal.principalId) ?? [])]
      .map(sessionId => sessions.get(sessionId))
      .filter((record): record is StoredSession => record !== undefined && record.session.status === 'active')
    const revokedAt = nowIso()
    for (const record of active) {
      const fact = options.auditFact({
        action: 'session.revoked',
        actor: 'system',
        result: 'denied',
        principal: input.principal,
        sessionId: record.session.sessionId,
        correlationId: input.correlationId
      })
      const written = await options.writeAudit(fact)
      if (!written.ok) return written
      record.session = { ...record.session, status: 'revoked', revokedAt, revokedReason: input.reason }
    }
    return ok(undefined)
  }

  async function rotate(
    record: StoredSession,
    principal: LocalIamPrincipal,
    reason: Extract<LocalIamSession['rotationReason'], string>,
    correlationId: string
  ): Promise<Result<LocalIamSessionRead, LocalIamError>> {
    const replacement = createSessionRecord(principal)
    const rotatedAt = nowIso()
    replacement.session = { ...replacement.session, rotatedAt, rotationReason: reason }
    const fact = options.auditFact({
      action: 'session.rotated',
      actor: 'system',
      result: 'allowed',
      principal,
      sessionId: replacement.session.sessionId,
      correlationId
    })
    const written = await options.writeAudit(fact)
    if (!written.ok) return written
    record.session = { ...record.session, status: 'rotated', rotatedAt, rotationReason: reason }
    store(replacement)
    return ok({
      kind: 'rotated',
      principal: copyPrincipal(principal),
      session: copySession(replacement.session),
      csrfToken: replacement.csrfToken,
      audit: fact
    })
  }

  async function readActive(input: {
    sessionId: string
    correlationId: string
    rotateForPrivilegeChange: boolean
  }): Promise<Result<LocalIamSessionRead, LocalIamError>> {
    const record = sessions.get(input.sessionId)
    if (record === undefined) return err(localIamStateFailure('session_not_found', 'Session was not found'))
    if (record.session.status === 'revoked' || record.session.status === 'rotated') {
      return err(localIamStateFailure('session_revoked', 'Session is no longer active'))
    }
    if (record.session.status === 'expired' || new Date(record.session.expiresAt).getTime() <= options.now().getTime()) {
      record.session = { ...record.session, status: 'expired' }
      return err(localIamStateFailure('session_expired', 'Session has expired'))
    }
    const principal = options.getPrincipal(record.session.principalId)
    if (principal === null) return err(localIamStateFailure('principal_not_found', 'Principal was not found'))
    if (principal.status === 'disabled') {
      const revoked = await revokeForPrincipal({
        principal,
        reason: 'principal_disabled',
        correlationId: input.correlationId
      })
      return revoked.ok ? err(localIamStateFailure('principal_disabled', 'Principal is disabled')) : revoked
    }
    if (principal.status === 'rejected') {
      return err(localIamStateFailure('principal_rejected', 'Principal is rejected'))
    }
    if (principal.status !== 'approved' || principal.roles.length === 0) {
      return err(localIamStateFailure('principal_not_approved', 'Principal is not approved for a local session'))
    }
    if (hasRoleRemoval(record.session.rolesSnapshot, principal.roles)) {
      const revoked = await revokeForPrincipal({
        principal,
        reason: 'role_revoked',
        correlationId: input.correlationId
      })
      return revoked.ok ? err(localIamStateFailure('session_revoked', 'Session was revoked after role removal')) : revoked
    }
    if (!sameRoles(record.session.rolesSnapshot, principal.roles) || record.rotationRequired) {
      if (!input.rotateForPrivilegeChange) {
        record.rotationRequired = true
        return ok({
          kind: 'active',
          principal: copyPrincipal(principal),
          session: copySession(record.session),
          csrfToken: record.csrfToken
        })
      }
      return rotate(record, principal, 'privilege_change', input.correlationId)
    }
    return ok({
      kind: 'active',
      principal: copyPrincipal(principal),
      session: copySession(record.session),
      csrfToken: record.csrfToken
    })
  }

  return {
    async issueSession(input) {
      const record = createSessionRecord(input.principal)
      const fact = options.auditFact({
        action: 'session.issued',
        actor: 'system',
        result: 'allowed',
        principal: input.principal,
        sessionId: record.session.sessionId,
        correlationId: input.correlationId
      })
      const written = await options.writeAudit(fact)
      if (!written.ok) return written
      store(record)
      return ok({
        principal: copyPrincipal(input.principal),
        session: copySession(record.session),
        csrfToken: record.csrfToken,
        audit: fact
      })
    },
    async getSession(input) {
      return readActive({ ...input, rotateForPrivilegeChange: true })
    },
    async rotateSession(input) {
      const read = await readActive({ ...input, rotateForPrivilegeChange: false })
      if (!read.ok) return read
      const record = sessions.get(input.sessionId)
      if (record === undefined) return err(localIamStateFailure('session_not_found', 'Session was not found'))
      const principal = options.getPrincipal(record.session.principalId)
      if (principal === null) return err(localIamStateFailure('principal_not_found', 'Principal was not found'))
      return rotate(record, principal, 'manual_rotation', input.correlationId)
    },
    async logout(input) {
      const record = sessions.get(input.sessionId)
      if (record === undefined) return err(localIamStateFailure('session_not_found', 'Session was not found'))
      const principal = options.getPrincipal(record.session.principalId)
      if (principal === null) return err(localIamStateFailure('principal_not_found', 'Principal was not found'))
      const fact = options.auditFact({
        action: 'session.logout',
        actor: 'system',
        result: 'allowed',
        principal,
        sessionId: input.sessionId,
        correlationId: input.correlationId
      })
      const written = await options.writeAudit(fact)
      remove(input.sessionId)
      return written.ok ? ok({ sessionId: input.sessionId, audit: fact }) : written
    },
    revokeForPrincipal,
    requireRotation(principalId) {
      for (const sessionId of sessionIdsByPrincipal.get(principalId) ?? []) {
        const record = sessions.get(sessionId)
        if (record?.session.status === 'active') record.rotationRequired = true
      }
    },
    async invalidateProviderSessions(correlationId) {
      const fact = options.auditFact({
        action: 'provider.unavailable',
        actor: 'system',
        result: 'denied',
        reason: 'keycloak_unavailable',
        correlationId
      })
      const written = await options.writeAudit(fact)
      const revokedAt = nowIso()
      for (const record of sessions.values()) {
        if (record.session.status === 'active') {
          record.session = {
            ...record.session,
            status: 'revoked',
            revokedAt,
            revokedReason: 'provider_unavailable'
          }
        }
      }
      return written.ok ? ok(undefined) : written
    }
  }
}
