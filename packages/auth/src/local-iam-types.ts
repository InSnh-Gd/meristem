import type {
  OidcIamAuditActionV01FromSchema,
  OidcIamAuditFactV01FromSchema,
  OidcIamDeniedReasonV01FromSchema,
  OidcIamPrincipalDisplayV01FromSchema,
  OidcIamPrincipalV01FromSchema,
  OidcIamRoleV01FromSchema,
  OidcIamSessionStateV01FromSchema
} from '../../contracts/src/index.ts'
import type { Result } from '../../common/src/result.ts'

export type LocalIamAuditFact = OidcIamAuditFactV01FromSchema
export type LocalIamPrincipal = OidcIamPrincipalV01FromSchema
export type LocalIamSession = OidcIamSessionStateV01FromSchema
export type LocalIamRole = OidcIamRoleV01FromSchema

export type LocalIamIdentity = {
  readonly oidcIssuer: string
  readonly oidcSubject: string
  readonly display: OidcIamPrincipalDisplayV01FromSchema
}

export type LocalIamPolicyFailure = {
  readonly code: 'policy_denied' | 'policy_unavailable'
  readonly message: string
}

export type LocalIamAuditFailure = {
  readonly code: 'audit_unavailable'
  readonly message: string
}

export type LocalIamStateFailure = {
  readonly code:
    | 'principal_not_found'
    | 'principal_not_pending'
    | 'principal_not_approved'
    | 'principal_disabled'
    | 'principal_rejected'
    | 'roles_required'
    | 'session_not_found'
    | 'session_expired'
    | 'session_revoked'
  readonly message: string
}

export type LocalIamError = LocalIamPolicyFailure | LocalIamAuditFailure | LocalIamStateFailure

export type LocalIamPolicyAuthorizer = {
  authorize(input: {
    readonly actorPrincipalId: string
    readonly actorRoles: readonly LocalIamRole[]
    readonly action:
      | 'principal.approve'
      | 'principal.reject'
      | 'principal.disable'
      | 'principal.roles.assign'
    readonly targetPrincipalId: string
    readonly correlationId: string
  }): Promise<Result<void, LocalIamPolicyFailure>>
}

export type LocalIamAuditWriter = {
  write(fact: LocalIamAuditFact): Promise<Result<void, LocalIamAuditFailure>>
}

export type LocalIamLoginResolution =
  | { readonly kind: 'approved'; readonly principal: LocalIamPrincipal }
  | {
      readonly kind: 'pending_principal_created'
      readonly principal: LocalIamPrincipal
      readonly audit: LocalIamAuditFact
    }
  | {
      readonly kind: 'denied'
      readonly reason: OidcIamDeniedReasonV01FromSchema
      readonly principal: LocalIamPrincipal
      readonly audit: LocalIamAuditFact
    }

export type LocalIamIssuedSession = {
  readonly principal: LocalIamPrincipal
  readonly session: LocalIamSession
  readonly csrfToken: string
  readonly audit: LocalIamAuditFact
}

export type LocalIamSessionRead = {
  readonly kind: 'active' | 'rotated'
  readonly principal: LocalIamPrincipal
  readonly session: LocalIamSession
  readonly csrfToken: string
  readonly audit?: LocalIamAuditFact
}

export type LocalIamLogout = {
  readonly sessionId: string
  readonly audit: LocalIamAuditFact
}

export type LocalIamPrincipalMutation = {
  readonly principal: LocalIamPrincipal
  readonly audit: LocalIamAuditFact
}

export type LocalIamService = {
  resolveLogin(input: {
    readonly identity: LocalIamIdentity
    readonly correlationId: string
  }): Promise<Result<LocalIamLoginResolution, LocalIamError>>
  issueSession(input: {
    readonly principalId: string
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
  approve(input: {
    readonly principalId: string
    readonly actorPrincipalId: string
    readonly actorRoles: readonly LocalIamRole[]
    readonly roles: readonly LocalIamRole[]
    readonly correlationId: string
  }): Promise<Result<LocalIamPrincipalMutation, LocalIamError>>
  reject(input: {
    readonly principalId: string
    readonly actorPrincipalId: string
    readonly actorRoles: readonly LocalIamRole[]
    readonly reason: string
    readonly correlationId: string
  }): Promise<Result<LocalIamPrincipalMutation, LocalIamError>>
  replaceRoles(input: {
    readonly principalId: string
    readonly actorPrincipalId: string
    readonly actorRoles: readonly LocalIamRole[]
    readonly roles: readonly LocalIamRole[]
    readonly correlationId: string
  }): Promise<Result<LocalIamPrincipalMutation, LocalIamError>>
  disable(input: {
    readonly principalId: string
    readonly actorPrincipalId: string
    readonly actorRoles: readonly LocalIamRole[]
    readonly reason: string
    readonly correlationId: string
  }): Promise<Result<LocalIamPrincipalMutation, LocalIamError>>
  invalidateProviderSessions(input: {
    readonly correlationId: string
  }): Promise<Result<void, LocalIamError>>
}

export type LocalIamServiceOptions = {
  readonly now?: () => Date
  readonly sessionTtlMs?: number
  readonly initialPrincipals?: readonly LocalIamPrincipal[]
  readonly policy: LocalIamPolicyAuthorizer
  readonly audit: LocalIamAuditWriter
}

export type LocalIamAuditFactInput = {
  readonly action: OidcIamAuditActionV01FromSchema
  readonly actor: LocalIamAuditFact['actor']
  readonly result: LocalIamAuditFact['result']
  readonly correlationId: string
  readonly principal?: LocalIamPrincipal
  readonly reason?: OidcIamDeniedReasonV01FromSchema
  readonly sessionId?: string
}

export function copyPrincipal(principal: LocalIamPrincipal): LocalIamPrincipal {
  return { ...principal, roles: [...principal.roles], display: { ...principal.display } }
}

export function copySession(session: LocalIamSession): LocalIamSession {
  return {
    ...session,
    rolesSnapshot: [...session.rolesSnapshot],
    cookie: { ...session.cookie },
    csrf: { ...session.csrf },
    oidc: { ...session.oidc },
    storage: { ...session.storage }
  }
}

export function sameRoles(left: readonly LocalIamRole[], right: readonly LocalIamRole[]): boolean {
  return left.length === right.length && left.every(role => right.includes(role))
}

export function hasRoleRemoval(before: readonly LocalIamRole[], after: readonly LocalIamRole[]): boolean {
  return before.some(role => !after.includes(role))
}

export function localIamStateFailure(
  code: LocalIamStateFailure['code'],
  message: string
): LocalIamStateFailure {
  return { code, message }
}
