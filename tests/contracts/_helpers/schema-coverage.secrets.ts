import type { ResponseContract } from './schema-coverage.ts'
import { Contracts } from './schema-coverage.ts'

export const secretResponseContracts: ResponseContract[] = [
  {
    route: 'GET /api/v0/secrets',
    schema: Contracts.SecretListResponseSchema,
    fixture: [
      {
        id: 'sec-1',
        name: 'api-key',
        scope: 'service',
        status: 'active',
        createdBy: 'security-admin',
        createdAt: '2026-06-04T10:00:00.000Z',
        metadata: { env: 'prod' }
      }
    ]
  },
  {
    route: 'GET /api/v0/secrets/:id',
    schema: Contracts.SecretDetailResponseSchema,
    fixture: {
      id: 'sec-1',
      name: 'api-key',
      scope: 'service',
      status: 'active',
      createdBy: 'security-admin',
      createdAt: '2026-06-04T10:00:00.000Z',
      metadata: { env: 'prod' },
      updatedAt: '2026-06-04T10:10:00.000Z'
    }
  },
  {
    route: 'POST /api/v0/secrets',
    schema: Contracts.SecretCreateResponseSchema,
    fixture: {
      id: 'sec-2',
      name: 'db-password',
      status: 'active',
      createdAt: '2026-06-04T10:00:00.000Z'
    }
  },
  {
    route: 'POST /api/v0/secrets/:id/rotate',
    schema: Contracts.SecretRotateResponseSchema,
    fixture: { id: 'sec-1', version: '2', status: 'rotated', rotatedAt: '2026-06-04T11:00:00.000Z' }
  },
  {
    route: 'POST /api/v0/secrets/:id/disable',
    schema: Contracts.SecretDisableResponseSchema,
    fixture: { id: 'sec-1', status: 'disabled', disabledAt: '2026-06-04T12:00:00.000Z' }
  },
  {
    route: 'POST /internal/v0/secrets/:id/reference',
    schema: Contracts.SecretReferenceResponseSchema,
    fixture: { id: 'sec-1', currentVersion: '2', status: 'active', metadata: { env: 'prod' } }
  }
]
