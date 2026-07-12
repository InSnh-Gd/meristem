import { describe, expect, test } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import * as Schema from 'effect/Schema'
import type { OidcAuthFailure } from '../../packages/auth/src/index.ts'
import type { OidcIamProviderFailureCodeV01FromSchema } from '../../packages/contracts/src/index.ts'
import {
  OidcIamAuditFactV01Schema,
  OidcIamLoginFlowResultV01Schema,
  OidcIamLoginFlowResultV01TypeBoxSchema,
  OidcIamLogoutFlowResultV01Schema,
  OidcIamLogoutFlowResultV01TypeBoxSchema,
  OidcIamPrincipalV01Schema,
  OidcIamProviderConfigV01Schema,
  OidcIamProviderFailureV01Schema,
  OidcIamSessionStateV01Schema,
  oidcIamCookiePolicyV01
} from '../../packages/contracts/src/index.ts'

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

const providerFailureVocabularyMatchesRuntime: Exact<
  OidcAuthFailure['code'],
  OidcIamProviderFailureCodeV01FromSchema
> = true

const now = '2026-07-07T00:00:00.000Z'
const issuer = 'https://keycloak.example.com/realms/meristem'
const subject = '5d5f7259-7f18-4c37-b7f2-e53c38961c59'

const approvedPrincipal = {
  contractVersion: 'oidc-iam-principal@0.1.0',
  principalId: 'principal-operator-001',
  oidcIssuer: issuer,
  oidcSubject: subject,
  status: 'approved',
  roles: ['operator'],
  display: {
    email: 'operator@example.com',
    name: 'Meristem Operator',
    preferredUsername: 'operator'
  },
  createdAt: now,
  updatedAt: now,
  approvedAt: now,
  approvedBy: 'security-admin'
} as const

const activeSession = {
  contractVersion: 'oidc-iam-session@0.1.0',
  sessionId: 'sess-001',
  principalId: approvedPrincipal.principalId,
  oidcIssuer: issuer,
  oidcSubject: subject,
  status: 'active',
  rolesSnapshot: ['operator'],
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    name: '__Host-meristem-session'
  },
  csrf: {
    required: true,
    mode: 'synchronizer-token',
    tokenBinding: 'server-side-session'
  },
  oidc: {
    stateRequired: true,
    nonceRequired: true,
    pkceRequired: true,
    tokensHeldBy: 'bff-server'
  },
  storage: {
    kind: 'server-side',
    storesOidcTokens: false
  },
  issuedAt: now,
  expiresAt: '2026-07-07T00:30:00.000Z',
  rotatedAt: '2026-07-07T00:15:00.000Z',
  rotationReason: 'login'
} as const

describe('OIDC local IAM session contract', () => {
  test('provider config versions authorization-code + PKCE without making claims authoritative', () => {
    const config = Schema.decodeUnknownSync(OidcIamProviderConfigV01Schema)({
      contractVersion: 'oidc-iam-provider@0.1.0',
      provider: 'keycloak-oidc',
      issuer,
      clientId: 'meristem-m-ui-bff',
      redirectUri: 'https://meristem.example.com/api/v0/auth/oidc/callback',
      scopes: ['openid', 'profile', 'email'],
      responseType: 'code',
      pkceRequired: true,
      stateRequired: true,
      nonceRequired: true,
      claimAuthority: 'authentication-only',
      localIamAuthority: true
    })

    expect(config.claimAuthority).toBe('authentication-only')
    expect(config.localIamAuthority).toBe(true)
    expect(config.scopes).not.toContain('roles')
  })

  test('provider failures use a versioned fail-closed vocabulary', () => {
    expect(providerFailureVocabularyMatchesRuntime).toBe(true)

    const codes = [
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
    ] as const

    for (const code of codes) {
      const failure = Schema.decodeUnknownSync(OidcIamProviderFailureV01Schema)({
        contractVersion: 'oidc-iam-provider-failure@0.1.0',
        ok: false,
        code,
        message: `OIDC provider failure: ${code}`,
        failClosed: true
      })

      expect(failure.contractVersion).toBe('oidc-iam-provider-failure@0.1.0')
      expect(failure.code).toBe(code)
      expect(failure.failClosed).toBe(true)
    }
  })

  test('OIDC success issues a BFF-held session only for an approved local principal', () => {
    const result = Schema.decodeUnknownSync(OidcIamLoginFlowResultV01Schema)({
      kind: 'session_issued',
      principal: approvedPrincipal,
      session: activeSession,
      audit: {
        contractVersion: 'oidc-iam-audit@0.1.0',
        action: 'session.issued',
        actor: 'system',
        principalId: approvedPrincipal.principalId,
        oidcIssuer: issuer,
        oidcSubject: subject,
        sessionId: activeSession.sessionId,
        result: 'allowed',
        occurredAt: now,
        correlationId: 'corr-001'
      }
    })

    expect(result.kind).toBe('session_issued')
    if (result.kind !== 'session_issued') return
    expect(result.principal.roles).toEqual(['operator'])
    expect(result.session.cookie).toEqual(oidcIamCookiePolicyV01)
    expect(result.session.storage.kind).toBe('server-side')
    expect(result.session.storage.storesOidcTokens).toBe(false)
    expect(result.session.csrf).toEqual({
      required: true,
      mode: 'synchronizer-token',
      tokenBinding: 'server-side-session'
    })
    expect(result.session.oidc).toEqual({
      stateRequired: true,
      nonceRequired: true,
      pkceRequired: true,
      tokensHeldBy: 'bff-server'
    })
    expect('domain' in result.session.cookie).toBe(false)
  })

  test('unknown issuer+subject creates pending principal and no session', () => {
    const result = Schema.decodeUnknownSync(OidcIamLoginFlowResultV01Schema)({
      kind: 'pending_principal_created',
      principal: {
        ...approvedPrincipal,
        principalId: 'principal-pending-001',
        status: 'pending',
        roles: [],
        approvedAt: undefined,
        approvedBy: undefined
      },
      session: undefined,
      audit: {
        contractVersion: 'oidc-iam-audit@0.1.0',
        action: 'principal.pending_created',
        actor: 'system',
        principalId: 'principal-pending-001',
        oidcIssuer: issuer,
        oidcSubject: subject,
        result: 'pending',
        occurredAt: now,
        correlationId: 'corr-002'
      }
    })

    expect(result.kind).toBe('pending_principal_created')
    if (result.kind !== 'pending_principal_created') return
    expect(result.principal.status).toBe('pending')
    expect(result.session).toBeUndefined()
  })

  test('disabled principal is denied and produces an audit fact', () => {
    const result = Schema.decodeUnknownSync(OidcIamLoginFlowResultV01Schema)({
      kind: 'denied',
      reason: 'principal_disabled',
      principal: {
        ...approvedPrincipal,
        status: 'disabled',
        disabledAt: now,
        disabledBy: 'security-admin',
        disabledReason: 'employment ended'
      },
      audit: {
        contractVersion: 'oidc-iam-audit@0.1.0',
        action: 'login.denied',
        actor: 'system',
        principalId: approvedPrincipal.principalId,
        oidcIssuer: issuer,
        oidcSubject: subject,
        result: 'denied',
        reason: 'principal_disabled',
        occurredAt: now,
        correlationId: 'corr-003'
      }
    })

    expect(result.kind).toBe('denied')
    if (result.kind !== 'denied') return
    expect(result.reason).toBe('principal_disabled')
    expect(result.audit.result).toBe('denied')
  })

  test('rejected principal remains denied without receiving a session', () => {
    const result = Schema.decodeUnknownSync(OidcIamLoginFlowResultV01Schema)({
      kind: 'denied',
      reason: 'principal_rejected',
      principal: {
        ...approvedPrincipal,
        status: 'rejected',
        roles: [],
        approvedAt: undefined,
        approvedBy: undefined,
        rejectedAt: now,
        rejectedBy: 'security-admin',
        rejectionReason: 'identity could not be approved'
      },
      audit: {
        contractVersion: 'oidc-iam-audit@0.1.0',
        action: 'login.denied',
        actor: 'system',
        principalId: approvedPrincipal.principalId,
        oidcIssuer: issuer,
        oidcSubject: subject,
        result: 'denied',
        reason: 'principal_rejected',
        occurredAt: now,
        correlationId: 'corr-rejected'
      }
    })

    expect(result.kind).toBe('denied')
    if (result.kind !== 'denied') return
    expect(result.reason).toBe('principal_rejected')
    expect(result.principal?.status).toBe('rejected')
    expect('session' in result).toBe(false)
  })

  test('email change updates display attributes without changing issuer+subject binding', () => {
    const updated = Schema.decodeUnknownSync(OidcIamPrincipalV01Schema)({
      ...approvedPrincipal,
      display: {
        email: 'operator.renamed@example.com',
        name: 'Renamed Meristem Operator',
        preferredUsername: 'operator-renamed'
      },
      displayUpdatedAt: now
    })

    expect(updated.oidcIssuer).toBe(issuer)
    expect(updated.oidcSubject).toBe(subject)
    expect(updated.display.email).toBe('operator.renamed@example.com')
    expect(updated.display.name).toBe('Renamed Meristem Operator')
    expect(updated.display.preferredUsername).toBe('operator-renamed')
  })

  test('subject mismatch and conflict are typed denied results with audit facts', () => {
    const conflict = Schema.decodeUnknownSync(OidcIamLoginFlowResultV01Schema)({
      kind: 'denied',
      reason: 'principal_conflict',
      audit: {
        contractVersion: 'oidc-iam-audit@0.1.0',
        action: 'principal.conflict_detected',
        actor: 'system',
        oidcIssuer: issuer,
        oidcSubject: 'different-subject',
        result: 'denied',
        reason: 'principal_conflict',
        occurredAt: now,
        correlationId: 'corr-004'
      }
    })

    const mismatch = Schema.decodeUnknownSync(OidcIamLoginFlowResultV01Schema)({
      kind: 'denied',
      reason: 'subject_mismatch',
      audit: {
        contractVersion: 'oidc-iam-audit@0.1.0',
        action: 'principal.subject_mismatch',
        actor: 'system',
        principalId: approvedPrincipal.principalId,
        oidcIssuer: issuer,
        oidcSubject: 'unexpected-subject',
        result: 'denied',
        reason: 'subject_mismatch',
        occurredAt: now,
        correlationId: 'corr-005'
      }
    })

    expect(conflict.kind).toBe('denied')
    expect(mismatch.kind).toBe('denied')
    if (conflict.kind === 'denied') expect(conflict.reason).toBe('principal_conflict')
    if (mismatch.kind === 'denied') expect(mismatch.reason).toBe('subject_mismatch')
  })

  test('Keycloak outage invalidates BFF session and preserves break-glass as a local IAM path', () => {
    const outage = Schema.decodeUnknownSync(OidcIamLoginFlowResultV01Schema)({
      kind: 'provider_unavailable',
      invalidateSessions: true,
      breakGlass: {
        allowed: true,
        ttlSeconds: 1800,
        requiresTwoPersonApproval: true,
        auditRequired: true
      },
      audit: {
        contractVersion: 'oidc-iam-audit@0.1.0',
        action: 'provider.unavailable',
        actor: 'system',
        result: 'denied',
        reason: 'keycloak_unavailable',
        occurredAt: now,
        correlationId: 'corr-006'
      }
    })

    expect(outage.kind).toBe('provider_unavailable')
    if (outage.kind !== 'provider_unavailable') return
    expect(outage.invalidateSessions).toBe(true)
    expect(outage.breakGlass.ttlSeconds).toBe(1800)
    expect(outage.breakGlass.requiresTwoPersonApproval).toBe(true)
  })

  test('role revocation invalidates existing sessions instead of silently shrinking permissions', () => {
    const revoked = Schema.decodeUnknownSync(OidcIamSessionStateV01Schema)({
      ...activeSession,
      status: 'revoked',
      revokedAt: now,
      revokedReason: 'role_revoked'
    })

    expect(revoked.status).toBe('revoked')
    expect(revoked.revokedReason).toBe('role_revoked')
  })

  test('logout destroys local BFF session without requiring frontend OIDC tokens', () => {
    const logoutInput = {
      kind: 'logged_out',
      sessionId: activeSession.sessionId,
      cookieCleared: true,
      serverSessionDestroyed: true,
      frontChannelOidcLogout: 'attempted',
      audit: {
        contractVersion: 'oidc-iam-audit@0.1.0',
        action: 'session.logout',
        actor: 'system',
        principalId: approvedPrincipal.principalId,
        sessionId: activeSession.sessionId,
        result: 'allowed',
        occurredAt: now,
        correlationId: 'corr-007'
      }
    } as const
    const logout = Schema.decodeUnknownSync(OidcIamLogoutFlowResultV01Schema)(logoutInput)

    expect(logout.kind).toBe('logged_out')
    expect(logout.cookieCleared).toBe(true)
    expect(logout.serverSessionDestroyed).toBe(true)
    expect(Value.Check(OidcIamLogoutFlowResultV01TypeBoxSchema, logoutInput)).toBe(true)
  })

  test('audit facts redact tokens and raw claims by schema boundary', () => {
    const decoded = Schema.decodeUnknownSync(OidcIamAuditFactV01Schema)({
      contractVersion: 'oidc-iam-audit@0.1.0',
      action: 'login.denied',
      actor: 'system',
      result: 'denied',
      reason: 'invalid_oidc_token',
      occurredAt: now,
      correlationId: 'corr-008',
      accessToken: 'must-not-survive',
      rawClaims: { groups: ['admin'] }
    })

    expect('accessToken' in decoded).toBe(false)
    expect('rawClaims' in decoded).toBe(false)
  })

  test('TypeBox login flow adapter accepts the same session-issued shape', () => {
    expect(
      Value.Check(OidcIamLoginFlowResultV01TypeBoxSchema, {
        kind: 'session_issued',
        principal: approvedPrincipal,
        session: activeSession,
        audit: {
          contractVersion: 'oidc-iam-audit@0.1.0',
          action: 'session.issued',
          actor: 'system',
          principalId: approvedPrincipal.principalId,
          oidcIssuer: issuer,
          oidcSubject: subject,
          sessionId: activeSession.sessionId,
          result: 'allowed',
          occurredAt: now,
          correlationId: 'corr-009'
        }
      })
    ).toBe(true)
  })
})
