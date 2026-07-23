import {
  OidcIamContractVersions,
  type OidcIamDeniedReasonV01FromSchema
} from '../../contracts/src/index.ts'
import { err, ok, type Result } from '../../common/src/result.ts'
import { createLocalIamSessionStore } from './local-iam-session-store.ts'
import {
  copyPrincipal,
  hasRoleRemoval,
  localIamStateFailure,
  sameRoles,
  type LocalIamAuditFact,
  type LocalIamAuditFactInput,
  type LocalIamError,
  type LocalIamLoginResolution,
  type LocalIamPrincipal,
  type LocalIamPrincipalMutation,
  type LocalIamRole,
  type LocalIamService,
  type LocalIamServiceOptions
} from './local-iam-types.ts'

const defaultSessionTtlMs = 30 * 60 * 1_000

function bindingKey(issuer: string, subject: string): string {
  return `${issuer}\u0000${subject}`
}

/**
 * local IAM 负责 issuer+subject 绑定和 principal 生命周期；BFF 只通过端口消费结果。
 * 高风险 principal 变更仍由注入的 M-Policy 和 Audit writer 作为权威边界。
 */
export function createLocalIamService(options: LocalIamServiceOptions): LocalIamService {
  const now = options.now ?? (() => new Date())
  const principalsById = new Map<string, LocalIamPrincipal>()
  const principalIdsByBinding = new Map<string, string>()

  for (const principal of options.initialPrincipals ?? []) {
    const copied = copyPrincipal(principal)
    principalsById.set(copied.principalId, copied)
    principalIdsByBinding.set(bindingKey(copied.oidcIssuer, copied.oidcSubject), copied.principalId)
  }

  function nowIso(): string {
    return now().toISOString()
  }

  function getPrincipal(principalId: string): LocalIamPrincipal | null {
    return principalsById.get(principalId) ?? null
  }

  function auditFact(input: LocalIamAuditFactInput): LocalIamAuditFact {
    return {
      contractVersion: OidcIamContractVersions.audit,
      action: input.action,
      actor: input.actor,
      ...(input.principal ? { principalId: input.principal.principalId } : {}),
      ...(input.principal ? { oidcIssuer: input.principal.oidcIssuer } : {}),
      ...(input.principal ? { oidcSubject: input.principal.oidcSubject } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      result: input.result,
      ...(input.reason ? { reason: input.reason } : {}),
      occurredAt: nowIso(),
      correlationId: input.correlationId
    }
  }

  async function writeAudit(fact: LocalIamAuditFact): Promise<Result<LocalIamAuditFact, LocalIamError>> {
    const result = await options.audit.write(fact)
    return result.ok ? ok(fact) : err(result.error)
  }

  async function authorizeMutation(input: {
    actorPrincipalId: string
    actorRoles: readonly LocalIamRole[]
    action: 'principal.approve' | 'principal.reject' | 'principal.disable' | 'principal.roles.assign'
    targetPrincipalId: string
    correlationId: string
  }): Promise<Result<void, LocalIamError>> {
    if (!input.actorRoles.includes('security-admin')) {
      return err({ code: 'policy_denied', message: 'security-admin role is required' })
    }
    return options.policy.authorize(input)
  }

  const sessions = createLocalIamSessionStore({
    now,
    sessionTtlMs: options.sessionTtlMs ?? defaultSessionTtlMs,
    getPrincipal,
    auditFact,
    writeAudit
  })

  return {
    async resolveLogin(input) {
      const key = bindingKey(input.identity.oidcIssuer, input.identity.oidcSubject)
      const existingId = principalIdsByBinding.get(key)
      if (existingId === undefined) {
        const createdAt = nowIso()
        const principal: LocalIamPrincipal = {
          contractVersion: OidcIamContractVersions.principal,
          principalId: `principal-${crypto.randomUUID()}`,
          oidcIssuer: input.identity.oidcIssuer,
          oidcSubject: input.identity.oidcSubject,
          status: 'pending',
          roles: [],
          display: { ...input.identity.display },
          createdAt,
          updatedAt: createdAt,
          displayUpdatedAt: createdAt
        }
        const fact = auditFact({
          action: 'principal.pending_created',
          actor: 'system',
          result: 'pending',
          principal,
          correlationId: input.correlationId
        })
        const written = await writeAudit(fact)
        if (!written.ok) return written
        principalsById.set(principal.principalId, principal)
        principalIdsByBinding.set(key, principal.principalId)
        return ok<LocalIamLoginResolution>({
          kind: 'pending_principal_created',
          principal: copyPrincipal(principal),
          audit: fact
        })
      }

      const existing = getPrincipal(existingId)
      if (existing === null) return err(localIamStateFailure('principal_not_found', 'Principal binding is invalid'))
      const displayUpdatedAt = nowIso()
      const updated: LocalIamPrincipal = {
        ...existing,
        display: { ...input.identity.display },
        displayUpdatedAt,
        updatedAt: displayUpdatedAt
      }
      principalsById.set(updated.principalId, updated)
      if (updated.status === 'approved' && updated.roles.length > 0) {
        return ok<LocalIamLoginResolution>({ kind: 'approved', principal: copyPrincipal(updated) })
      }
      const reason: OidcIamDeniedReasonV01FromSchema =
        updated.status === 'disabled'
          ? 'principal_disabled'
          : updated.status === 'rejected'
            ? 'principal_rejected'
            : updated.status === 'pending'
              ? 'approval_required'
              : 'role_revoked'
      const fact = auditFact({
        action: 'login.denied',
        actor: 'system',
        result: 'denied',
        principal: updated,
        reason,
        correlationId: input.correlationId
      })
      const written = await writeAudit(fact)
      if (!written.ok) return written
      return ok<LocalIamLoginResolution>({
        kind: 'denied',
        reason,
        principal: copyPrincipal(updated),
        audit: fact
      })
    },

    async issueSession(input) {
      const principal = getPrincipal(input.principalId)
      if (principal === null) return err(localIamStateFailure('principal_not_found', 'Principal was not found'))
      if (principal.status === 'disabled') {
        return err(localIamStateFailure('principal_disabled', 'Disabled principals cannot receive sessions'))
      }
      if (principal.status === 'rejected') {
        return err(localIamStateFailure('principal_rejected', 'Rejected principals cannot receive sessions'))
      }
      if (principal.status !== 'approved' || principal.roles.length === 0) {
        return err(localIamStateFailure('principal_not_approved', 'Approved local roles are required'))
      }
      return sessions.issueSession({ principal, correlationId: input.correlationId })
    },

    getSession: sessions.getSession,
    rotateSession: sessions.rotateSession,
    logout: sessions.logout,

    async approve(input) {
      if (input.roles.length === 0) return err(localIamStateFailure('roles_required', 'At least one local role is required'))
      const principal = getPrincipal(input.principalId)
      if (principal === null) return err(localIamStateFailure('principal_not_found', 'Principal was not found'))
      if (principal.status !== 'pending') {
        return err(localIamStateFailure('principal_not_pending', 'Only pending principals can be approved'))
      }
      const authorized = await authorizeMutation({ ...input, action: 'principal.approve', targetPrincipalId: input.principalId })
      if (!authorized.ok) return authorized
      const fact = auditFact({
        action: 'principal.approved',
        actor: 'security-admin',
        result: 'allowed',
        principal,
        correlationId: input.correlationId
      })
      const written = await writeAudit(fact)
      if (!written.ok) return written
      const approvedAt = nowIso()
      const updated: LocalIamPrincipal = {
        ...principal,
        status: 'approved',
        roles: [...input.roles],
        approvedAt,
        approvedBy: 'security-admin',
        updatedAt: approvedAt
      }
      principalsById.set(updated.principalId, updated)
      return ok<LocalIamPrincipalMutation>({ principal: copyPrincipal(updated), audit: fact })
    },

    async reject(input) {
      const principal = getPrincipal(input.principalId)
      if (principal === null) return err(localIamStateFailure('principal_not_found', 'Principal was not found'))
      if (principal.status !== 'pending') {
        return err(localIamStateFailure('principal_not_pending', 'Only pending principals can be rejected'))
      }
      const authorized = await authorizeMutation({ ...input, action: 'principal.reject', targetPrincipalId: input.principalId })
      if (!authorized.ok) return authorized
      const fact = auditFact({
        action: 'principal.rejected',
        actor: 'security-admin',
        result: 'allowed',
        principal,
        correlationId: input.correlationId
      })
      const written = await writeAudit(fact)
      if (!written.ok) return written
      const rejectedAt = nowIso()
      const updated: LocalIamPrincipal = {
        ...principal,
        status: 'rejected',
        roles: [],
        rejectedAt,
        rejectedBy: 'security-admin',
        rejectionReason: input.reason,
        updatedAt: rejectedAt
      }
      principalsById.set(updated.principalId, updated)
      return ok<LocalIamPrincipalMutation>({ principal: copyPrincipal(updated), audit: fact })
    },

    async replaceRoles(input) {
      const principal = getPrincipal(input.principalId)
      if (principal === null) return err(localIamStateFailure('principal_not_found', 'Principal was not found'))
      if (principal.status !== 'approved') {
        return err(localIamStateFailure('principal_not_approved', 'Only approved principals have local roles'))
      }
      const authorized = await authorizeMutation({ ...input, action: 'principal.roles.assign', targetPrincipalId: input.principalId })
      if (!authorized.ok) return authorized
      const rolesRemoved = hasRoleRemoval(principal.roles, input.roles)
      const fact = auditFact({
        action: rolesRemoved ? 'principal.roles_revoked' : 'principal.roles_assigned',
        actor: 'security-admin',
        result: 'allowed',
        principal,
        correlationId: input.correlationId
      })
      const written = await writeAudit(fact)
      if (!written.ok) return written
      if (rolesRemoved) {
        const revoked = await sessions.revokeForPrincipal({
          principal,
          reason: 'role_revoked',
          correlationId: input.correlationId
        })
        if (!revoked.ok) return revoked
      } else if (!sameRoles(principal.roles, input.roles)) {
        sessions.requireRotation(principal.principalId)
      }
      const updated: LocalIamPrincipal = { ...principal, roles: [...input.roles], updatedAt: nowIso() }
      principalsById.set(updated.principalId, updated)
      return ok<LocalIamPrincipalMutation>({ principal: copyPrincipal(updated), audit: fact })
    },

    async disable(input) {
      const principal = getPrincipal(input.principalId)
      if (principal === null) return err(localIamStateFailure('principal_not_found', 'Principal was not found'))
      const authorized = await authorizeMutation({ ...input, action: 'principal.disable', targetPrincipalId: input.principalId })
      if (!authorized.ok) return authorized
      const fact = auditFact({
        action: 'principal.disabled',
        actor: 'security-admin',
        result: 'allowed',
        principal,
        correlationId: input.correlationId
      })
      const written = await writeAudit(fact)
      if (!written.ok) return written
      const revoked = await sessions.revokeForPrincipal({
        principal,
        reason: 'principal_disabled',
        correlationId: input.correlationId
      })
      if (!revoked.ok) return revoked
      const disabledAt = nowIso()
      const updated: LocalIamPrincipal = {
        ...principal,
        status: 'disabled',
        disabledAt,
        disabledBy: 'security-admin',
        disabledReason: input.reason,
        updatedAt: disabledAt
      }
      principalsById.set(updated.principalId, updated)
      return ok<LocalIamPrincipalMutation>({ principal: copyPrincipal(updated), audit: fact })
    },

    async invalidateProviderSessions(input) {
      return sessions.invalidateProviderSessions(input.correlationId)
    }
  }
}
