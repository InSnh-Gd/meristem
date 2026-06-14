import type { ResponseContract } from './schema-coverage.ts'
import { Contracts } from './schema-coverage.ts'

export const identityResponseContracts: ResponseContract[] = [
  {
    route: 'GET /api/v0/identity/actors',
    schema: Contracts.IdentityActorListResponseSchema,
    fixture: {
      actors: [
        {
          id: 'operator',
          displayName: 'Operator',
          status: 'active',
          createdAt: '2026-06-04T10:00:00.000Z',
          updatedAt: '2026-06-04T10:00:00.000Z'
        }
      ]
    }
  },
  {
    route: 'GET /api/v0/identity/actors/:id',
    schema: Contracts.IdentityActorDetailResponseSchema,
    fixture: {
      actor: {
        id: 'admin',
        displayName: 'Admin',
        status: 'active',
        createdAt: '2026-06-04T10:00:00.000Z',
        updatedAt: '2026-06-04T10:00:00.000Z'
      }
    }
  },
  {
    route: 'POST /api/v0/identity/tokens',
    schema: Contracts.IssueActorTokenRouteResponseSchema,
    fixture: {
      jti: 'jti-1',
      token: 'jwt-token',
      expiresAt: '2026-06-04T12:00:00.000Z',
      actor: 'operator',
      issuer: 'meristem-local',
      audience: 'meristem-core',
      purpose: 'runtime access',
      status: 'active'
    }
  },
  {
    route: 'GET /api/v0/identity/tokens/:jti',
    schema: Contracts.InspectActorTokenResponseSchema,
    fixture: {
      token: {
        jti: 'jti-2',
        actor: 'operator',
        issuer: 'meristem-local',
        audience: 'meristem-core',
        issuedAt: '2026-06-04T10:00:00.000Z',
        expiresAt: '2026-06-04T12:00:00.000Z',
        issuedBy: 'security-admin',
        purpose: 'runtime access',
        status: 'active'
      }
    }
  },
  {
    route: 'POST /api/v0/identity/tokens/:jti/revoke',
    schema: Contracts.RevokeActorTokenCompatResponseSchema,
    fixture: {
      jti: 'jti-3',
      status: 'revoked',
      revokedAt: '2026-06-04T11:00:00.000Z',
      revokedBy: 'security-admin',
      revokeReason: 'rotation',
      token: {
        jti: 'jti-3',
        status: 'revoked',
        revokedAt: '2026-06-04T11:00:00.000Z',
        revokedBy: 'security-admin',
        revokeReason: 'rotation'
      }
    }
  },
  {
    route: 'POST /internal/v0/identity/tokens/introspect',
    schema: Contracts.InternalTokenIntrospectionResponseSchema,
    fixture: { jti: 'jti-4', active: true, actor: 'operator' }
  }
]
