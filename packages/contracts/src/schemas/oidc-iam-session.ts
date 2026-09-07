import { Type } from '@sinclair/typebox'
import * as Schema from 'effect/Schema'
import { actorIds } from '../literals.ts'

const NonEmptyStringSchema = Schema.String.pipe(
  Schema.check(Schema.makeFilter(value => value.length >= 1))
)

export const OidcIamContractVersions = {
  provider: 'oidc-iam-provider@0.1.0',
  providerFailure: 'oidc-iam-provider-failure@0.1.0',
  principal: 'oidc-iam-principal@0.1.0',
  session: 'oidc-iam-session@0.1.0',
  audit: 'oidc-iam-audit@0.1.0'
} as const

export const oidcIamCookiePolicyV01 = {
  httpOnly: true,
  secure: true,
  sameSite: 'Strict',
  path: '/',
  name: '__Host-meristem-session'
} as const

export const OidcIamRoleV01Schema = Schema.Literals(actorIds)
export type OidcIamRoleV01FromSchema = typeof OidcIamRoleV01Schema.Type

export const OidcIamProviderConfigV01Schema = Schema.Struct({
  contractVersion: Schema.Literal(OidcIamContractVersions.provider),
  provider: Schema.Literal('keycloak-oidc'),
  issuer: NonEmptyStringSchema,
  clientId: NonEmptyStringSchema,
  redirectUri: NonEmptyStringSchema,
  scopes: Schema.Array(NonEmptyStringSchema),
  responseType: Schema.Literal('code'),
  pkceRequired: Schema.Literal(true),
  stateRequired: Schema.Literal(true),
  nonceRequired: Schema.Literal(true),
  claimAuthority: Schema.Literal('authentication-only'),
  localIamAuthority: Schema.Literal(true)
})
export type OidcIamProviderConfigV01FromSchema = typeof OidcIamProviderConfigV01Schema.Type

export const OidcIamProviderFailureCodeV01Schema = Schema.Literals([
  'invalid_discovery',
  'bad_issuer',
  'bad_audience',
  'unsupported_algorithm',
  'expired_token',
  'missing_claim',
  'stale_jwks',
  'revoked_token',
  'introspection_required',
  'invalid_token'
])
export type OidcIamProviderFailureCodeV01FromSchema =
  typeof OidcIamProviderFailureCodeV01Schema.Type

export const OidcIamProviderFailureV01Schema = Schema.Struct({
  contractVersion: Schema.Literal(OidcIamContractVersions.providerFailure),
  ok: Schema.Literal(false),
  code: OidcIamProviderFailureCodeV01Schema,
  message: NonEmptyStringSchema,
  failClosed: Schema.Literal(true)
})
export type OidcIamProviderFailureV01FromSchema = typeof OidcIamProviderFailureV01Schema.Type

export const OidcIamPrincipalDisplayV01Schema = Schema.Struct({
  email: Schema.optional(NonEmptyStringSchema),
  name: Schema.optional(NonEmptyStringSchema),
  preferredUsername: Schema.optional(NonEmptyStringSchema)
})
export type OidcIamPrincipalDisplayV01FromSchema = typeof OidcIamPrincipalDisplayV01Schema.Type

export const OidcIamPrincipalStatusV01Schema = Schema.Literals([
  'pending',
  'approved',
  'rejected',
  'disabled'
])
export type OidcIamPrincipalStatusV01FromSchema = typeof OidcIamPrincipalStatusV01Schema.Type

export const OidcIamPrincipalV01Schema = Schema.Struct({
  contractVersion: Schema.Literal(OidcIamContractVersions.principal),
  principalId: NonEmptyStringSchema,
  oidcIssuer: NonEmptyStringSchema,
  oidcSubject: NonEmptyStringSchema,
  status: OidcIamPrincipalStatusV01Schema,
  roles: Schema.Array(OidcIamRoleV01Schema),
  display: OidcIamPrincipalDisplayV01Schema,
  createdAt: NonEmptyStringSchema,
  updatedAt: NonEmptyStringSchema,
  approvedAt: Schema.optional(NonEmptyStringSchema),
  approvedBy: Schema.optional(OidcIamRoleV01Schema),
  disabledAt: Schema.optional(NonEmptyStringSchema),
  disabledBy: Schema.optional(OidcIamRoleV01Schema),
  disabledReason: Schema.optional(NonEmptyStringSchema),
  rejectedAt: Schema.optional(NonEmptyStringSchema),
  rejectedBy: Schema.optional(OidcIamRoleV01Schema),
  rejectionReason: Schema.optional(NonEmptyStringSchema),
  displayUpdatedAt: Schema.optional(NonEmptyStringSchema)
})
export type OidcIamPrincipalV01FromSchema = typeof OidcIamPrincipalV01Schema.Type

export const OidcIamSessionCookieV01Schema = Schema.Struct({
  httpOnly: Schema.Literal(true),
  secure: Schema.Literal(true),
  sameSite: Schema.Literals(['Strict', 'Lax']),
  path: Schema.Literal('/'),
  name: Schema.Literal('__Host-meristem-session')
})
export type OidcIamSessionCookieV01FromSchema = typeof OidcIamSessionCookieV01Schema.Type

export const OidcIamSessionCsrfV01Schema = Schema.Struct({
  required: Schema.Literal(true),
  mode: Schema.Literals(['synchronizer-token', 'double-submit']),
  tokenBinding: Schema.Literal('server-side-session')
})
export type OidcIamSessionCsrfV01FromSchema = typeof OidcIamSessionCsrfV01Schema.Type

export const OidcIamSessionOidcControlsV01Schema = Schema.Struct({
  stateRequired: Schema.Literal(true),
  nonceRequired: Schema.Literal(true),
  pkceRequired: Schema.Literal(true),
  tokensHeldBy: Schema.Literal('bff-server')
})
export type OidcIamSessionOidcControlsV01FromSchema =
  typeof OidcIamSessionOidcControlsV01Schema.Type

export const OidcIamSessionStorageV01Schema = Schema.Struct({
  kind: Schema.Literal('server-side'),
  storesOidcTokens: Schema.Literal(false)
})
export type OidcIamSessionStorageV01FromSchema = typeof OidcIamSessionStorageV01Schema.Type

export const OidcIamSessionStateV01Schema = Schema.Struct({
  contractVersion: Schema.Literal(OidcIamContractVersions.session),
  sessionId: NonEmptyStringSchema,
  principalId: NonEmptyStringSchema,
  oidcIssuer: NonEmptyStringSchema,
  oidcSubject: NonEmptyStringSchema,
  status: Schema.Literals(['active', 'rotated', 'revoked', 'expired']),
  rolesSnapshot: Schema.Array(OidcIamRoleV01Schema),
  cookie: OidcIamSessionCookieV01Schema,
  csrf: OidcIamSessionCsrfV01Schema,
  oidc: OidcIamSessionOidcControlsV01Schema,
  storage: OidcIamSessionStorageV01Schema,
  issuedAt: NonEmptyStringSchema,
  expiresAt: NonEmptyStringSchema,
  rotatedAt: Schema.optional(NonEmptyStringSchema),
  rotationReason: Schema.optional(
    Schema.Literals(['login', 'privilege_change', 'ttl_refresh', 'manual_rotation'])
  ),
  revokedAt: Schema.optional(NonEmptyStringSchema),
  revokedReason: Schema.optional(
    Schema.Literals(['logout', 'role_revoked', 'principal_disabled', 'provider_unavailable'])
  )
})
export type OidcIamSessionStateV01FromSchema = typeof OidcIamSessionStateV01Schema.Type

export const OidcIamAuditActionV01Schema = Schema.Literals([
  'login.denied',
  'principal.pending_created',
  'principal.approved',
  'principal.rejected',
  'principal.roles_assigned',
  'principal.roles_revoked',
  'principal.disabled',
  'principal.rebound',
  'principal.conflict_detected',
  'principal.subject_mismatch',
  'session.issued',
  'session.rotated',
  'session.revoked',
  'session.logout',
  'provider.unavailable'
])
export type OidcIamAuditActionV01FromSchema = typeof OidcIamAuditActionV01Schema.Type

export const OidcIamDeniedReasonV01Schema = Schema.Literals([
  'principal_disabled',
  'principal_rejected',
  'principal_conflict',
  'subject_mismatch',
  'keycloak_unavailable',
  'invalid_oidc_token',
  'approval_required',
  'role_revoked'
])
export type OidcIamDeniedReasonV01FromSchema = typeof OidcIamDeniedReasonV01Schema.Type

export const OidcIamAuditFactV01Schema = Schema.Struct({
  contractVersion: Schema.Literal(OidcIamContractVersions.audit),
  action: OidcIamAuditActionV01Schema,
  actor: Schema.Union([OidcIamRoleV01Schema, Schema.Literal('system')]),
  principalId: Schema.optional(NonEmptyStringSchema),
  oidcIssuer: Schema.optional(NonEmptyStringSchema),
  oidcSubject: Schema.optional(NonEmptyStringSchema),
  sessionId: Schema.optional(NonEmptyStringSchema),
  result: Schema.Literals(['allowed', 'denied', 'pending']),
  reason: Schema.optional(OidcIamDeniedReasonV01Schema),
  occurredAt: NonEmptyStringSchema,
  correlationId: NonEmptyStringSchema
})
export type OidcIamAuditFactV01FromSchema = typeof OidcIamAuditFactV01Schema.Type

export const OidcIamBreakGlassFallbackV01Schema = Schema.Struct({
  allowed: Schema.Literal(true),
  ttlSeconds: Schema.Literal(1800),
  requiresTwoPersonApproval: Schema.Literal(true),
  auditRequired: Schema.Literal(true)
})
export type OidcIamBreakGlassFallbackV01FromSchema = typeof OidcIamBreakGlassFallbackV01Schema.Type

export const OidcIamSessionIssuedResultV01Schema = Schema.Struct({
  kind: Schema.Literal('session_issued'),
  principal: OidcIamPrincipalV01Schema,
  session: OidcIamSessionStateV01Schema,
  audit: OidcIamAuditFactV01Schema
})

export const OidcIamPendingPrincipalResultV01Schema = Schema.Struct({
  kind: Schema.Literal('pending_principal_created'),
  principal: OidcIamPrincipalV01Schema,
  session: Schema.optional(Schema.Undefined),
  audit: OidcIamAuditFactV01Schema
})

export const OidcIamDeniedResultV01Schema = Schema.Struct({
  kind: Schema.Literal('denied'),
  reason: OidcIamDeniedReasonV01Schema,
  principal: Schema.optional(OidcIamPrincipalV01Schema),
  audit: OidcIamAuditFactV01Schema
})

export const OidcIamProviderUnavailableResultV01Schema = Schema.Struct({
  kind: Schema.Literal('provider_unavailable'),
  invalidateSessions: Schema.Literal(true),
  breakGlass: OidcIamBreakGlassFallbackV01Schema,
  audit: OidcIamAuditFactV01Schema
})

export const OidcIamLoginFlowResultV01Schema = Schema.Union([
  OidcIamSessionIssuedResultV01Schema,
  OidcIamPendingPrincipalResultV01Schema,
  OidcIamDeniedResultV01Schema,
  OidcIamProviderUnavailableResultV01Schema
])
export type OidcIamLoginFlowResultV01FromSchema = typeof OidcIamLoginFlowResultV01Schema.Type

export const OidcIamLogoutFlowResultV01Schema = Schema.Struct({
  kind: Schema.Literal('logged_out'),
  sessionId: NonEmptyStringSchema,
  cookieCleared: Schema.Literal(true),
  serverSessionDestroyed: Schema.Literal(true),
  frontChannelOidcLogout: Schema.Literals(['attempted', 'skipped', 'failed']),
  audit: OidcIamAuditFactV01Schema
})
export type OidcIamLogoutFlowResultV01FromSchema = typeof OidcIamLogoutFlowResultV01Schema.Type

const RoleTypeBoxSchema = Type.Union(actorIds.map(role => Type.Literal(role)))

const PrincipalDisplayTypeBoxSchema = Type.Object(
  {
    email: Type.Optional(Type.String({ minLength: 1 })),
    name: Type.Optional(Type.String({ minLength: 1 })),
    preferredUsername: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
)

export const OidcIamPrincipalV01TypeBoxSchema = Type.Object(
  {
    contractVersion: Type.Literal(OidcIamContractVersions.principal),
    principalId: Type.String({ minLength: 1 }),
    oidcIssuer: Type.String({ minLength: 1 }),
    oidcSubject: Type.String({ minLength: 1 }),
    status: Type.Union([
      Type.Literal('pending'),
      Type.Literal('approved'),
      Type.Literal('rejected'),
      Type.Literal('disabled')
    ]),
    roles: Type.Array(RoleTypeBoxSchema),
    display: PrincipalDisplayTypeBoxSchema,
    createdAt: Type.String({ minLength: 1 }),
    updatedAt: Type.String({ minLength: 1 }),
    approvedAt: Type.Optional(Type.String({ minLength: 1 })),
    approvedBy: Type.Optional(RoleTypeBoxSchema),
    disabledAt: Type.Optional(Type.String({ minLength: 1 })),
    disabledBy: Type.Optional(RoleTypeBoxSchema),
    disabledReason: Type.Optional(Type.String({ minLength: 1 })),
    rejectedAt: Type.Optional(Type.String({ minLength: 1 })),
    rejectedBy: Type.Optional(RoleTypeBoxSchema),
    rejectionReason: Type.Optional(Type.String({ minLength: 1 })),
    displayUpdatedAt: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
)

export const OidcIamSessionStateV01TypeBoxSchema = Type.Object(
  {
    contractVersion: Type.Literal(OidcIamContractVersions.session),
    sessionId: Type.String({ minLength: 1 }),
    principalId: Type.String({ minLength: 1 }),
    oidcIssuer: Type.String({ minLength: 1 }),
    oidcSubject: Type.String({ minLength: 1 }),
    status: Type.Union([
      Type.Literal('active'),
      Type.Literal('rotated'),
      Type.Literal('revoked'),
      Type.Literal('expired')
    ]),
    rolesSnapshot: Type.Array(RoleTypeBoxSchema),
    cookie: Type.Object(
      {
        httpOnly: Type.Literal(true),
        secure: Type.Literal(true),
        sameSite: Type.Union([Type.Literal('Strict'), Type.Literal('Lax')]),
        path: Type.Literal('/'),
        name: Type.Literal('__Host-meristem-session')
      },
      { additionalProperties: false }
    ),
    csrf: Type.Object(
      {
        required: Type.Literal(true),
        mode: Type.Union([Type.Literal('synchronizer-token'), Type.Literal('double-submit')]),
        tokenBinding: Type.Literal('server-side-session')
      },
      { additionalProperties: false }
    ),
    oidc: Type.Object(
      {
        stateRequired: Type.Literal(true),
        nonceRequired: Type.Literal(true),
        pkceRequired: Type.Literal(true),
        tokensHeldBy: Type.Literal('bff-server')
      },
      { additionalProperties: false }
    ),
    storage: Type.Object(
      {
        kind: Type.Literal('server-side'),
        storesOidcTokens: Type.Literal(false)
      },
      { additionalProperties: false }
    ),
    issuedAt: Type.String({ minLength: 1 }),
    expiresAt: Type.String({ minLength: 1 }),
    rotatedAt: Type.Optional(Type.String({ minLength: 1 })),
    rotationReason: Type.Optional(
      Type.Union([
        Type.Literal('login'),
        Type.Literal('privilege_change'),
        Type.Literal('ttl_refresh'),
        Type.Literal('manual_rotation')
      ])
    ),
    revokedAt: Type.Optional(Type.String({ minLength: 1 })),
    revokedReason: Type.Optional(
      Type.Union([
        Type.Literal('logout'),
        Type.Literal('role_revoked'),
        Type.Literal('principal_disabled'),
        Type.Literal('provider_unavailable')
      ])
    )
  },
  { additionalProperties: false }
)

const AuditFactTypeBoxSchema = Type.Object(
  {
    contractVersion: Type.Literal(OidcIamContractVersions.audit),
    action: Type.Union([
      Type.Literal('login.denied'),
      Type.Literal('principal.pending_created'),
      Type.Literal('principal.approved'),
      Type.Literal('principal.rejected'),
      Type.Literal('principal.roles_assigned'),
      Type.Literal('principal.roles_revoked'),
      Type.Literal('principal.disabled'),
      Type.Literal('principal.rebound'),
      Type.Literal('principal.conflict_detected'),
      Type.Literal('principal.subject_mismatch'),
      Type.Literal('session.issued'),
      Type.Literal('session.rotated'),
      Type.Literal('session.revoked'),
      Type.Literal('session.logout'),
      Type.Literal('provider.unavailable')
    ]),
    actor: Type.Union([RoleTypeBoxSchema, Type.Literal('system')]),
    principalId: Type.Optional(Type.String({ minLength: 1 })),
    oidcIssuer: Type.Optional(Type.String({ minLength: 1 })),
    oidcSubject: Type.Optional(Type.String({ minLength: 1 })),
    sessionId: Type.Optional(Type.String({ minLength: 1 })),
    result: Type.Union([Type.Literal('allowed'), Type.Literal('denied'), Type.Literal('pending')]),
    reason: Type.Optional(
      Type.Union([
        Type.Literal('principal_disabled'),
        Type.Literal('principal_rejected'),
        Type.Literal('principal_conflict'),
        Type.Literal('subject_mismatch'),
        Type.Literal('keycloak_unavailable'),
        Type.Literal('invalid_oidc_token'),
        Type.Literal('approval_required'),
        Type.Literal('role_revoked')
      ])
    ),
    occurredAt: Type.String({ minLength: 1 }),
    correlationId: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
)

export const OidcIamLoginFlowResultV01TypeBoxSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('session_issued'),
      principal: OidcIamPrincipalV01TypeBoxSchema,
      session: OidcIamSessionStateV01TypeBoxSchema,
      audit: AuditFactTypeBoxSchema
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal('pending_principal_created'),
      principal: OidcIamPrincipalV01TypeBoxSchema,
      session: Type.Optional(Type.Undefined()),
      audit: AuditFactTypeBoxSchema
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal('denied'),
      reason: Type.Union([
        Type.Literal('principal_disabled'),
        Type.Literal('principal_rejected'),
        Type.Literal('principal_conflict'),
        Type.Literal('subject_mismatch'),
        Type.Literal('keycloak_unavailable'),
        Type.Literal('invalid_oidc_token'),
        Type.Literal('approval_required'),
        Type.Literal('role_revoked')
      ]),
      principal: Type.Optional(OidcIamPrincipalV01TypeBoxSchema),
      audit: AuditFactTypeBoxSchema
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal('provider_unavailable'),
      invalidateSessions: Type.Literal(true),
      breakGlass: Type.Object(
        {
          allowed: Type.Literal(true),
          ttlSeconds: Type.Literal(1800),
          requiresTwoPersonApproval: Type.Literal(true),
          auditRequired: Type.Literal(true)
        },
        { additionalProperties: false }
      ),
      audit: AuditFactTypeBoxSchema
    },
    { additionalProperties: false }
  )
])

export const OidcIamLogoutFlowResultV01TypeBoxSchema = Type.Object(
  {
    kind: Type.Literal('logged_out'),
    sessionId: Type.String({ minLength: 1 }),
    cookieCleared: Type.Literal(true),
    serverSessionDestroyed: Type.Literal(true),
    frontChannelOidcLogout: Type.Union([
      Type.Literal('attempted'),
      Type.Literal('skipped'),
      Type.Literal('failed')
    ]),
    audit: AuditFactTypeBoxSchema
  },
  { additionalProperties: false }
)
