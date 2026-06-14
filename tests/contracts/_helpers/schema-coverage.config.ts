import type { ResponseContract } from './schema-coverage.ts'
import { Contracts } from './schema-coverage.ts'

export const configResponseContracts: ResponseContract[] = [
  {
    route: 'GET /api/v0/configs',
    schema: Contracts.ConfigListResponseSchema,
    fixture: {
      configs: [
        {
          id: 'cfg-1',
          configVersion: 'cfgv-1',
          domain: 'core',
          status: 'draft',
          createdBy: 'admin',
          createdAt: '2026-06-04T10:00:00.000Z'
        }
      ]
    }
  },
  {
    route: 'GET /api/v0/configs/:id',
    schema: Contracts.ConfigDetailResponseSchema,
    fixture: {
      config: {
        id: 'cfg-1',
        configVersion: 'cfgv-1',
        domain: 'core',
        status: 'published',
        createdBy: 'admin',
        createdAt: '2026-06-04T10:00:00.000Z',
        schemaVersion: 'config@0.1.0',
        configHash: 'hash-1',
        targetScope: ['m-log'],
        payload: { feature: true },
        updatedAt: '2026-06-04T10:10:00.000Z',
        publishedBy: 'admin',
        publishedAt: '2026-06-04T10:05:00.000Z'
      }
    }
  },
  {
    route: 'POST /api/v0/configs/drafts',
    schema: Contracts.ConfigDraftResponseSchema,
    fixture: {
      config: {
        id: 'cfg-2',
        configVersion: 'cfgv-2',
        status: 'draft',
        createdAt: '2026-06-04T10:00:00.000Z'
      }
    }
  },
  {
    route: 'POST /api/v0/configs/:id/validate',
    schema: Contracts.ConfigValidateResponseSchema,
    fixture: { config: { id: 'cfg-2', status: 'validated' } }
  },
  {
    route: 'POST /api/v0/configs/:id/publish',
    schema: Contracts.ConfigPublishResponseSchema,
    fixture: {
      config: {
        id: 'cfg-2',
        configVersion: 'cfgv-2',
        status: 'published',
        publishedAt: '2026-06-04T10:20:00.000Z',
        publishedBy: 'admin'
      }
    }
  },
  {
    route: 'POST /api/v0/configs/:id/rollback',
    schema: Contracts.ConfigRollbackResponseSchema,
    fixture: { config: { id: 'cfg-2', status: 'rolled_back' } }
  },
  {
    route: 'POST /internal/v0/configs/:id/apply-ack',
    schema: Contracts.ConfigApplyAckResponseSchema,
    fixture: {
      ack: {
        ackId: 'ack-1',
        configId: 'cfg-2',
        configVersion: 'cfgv-2',
        ackedBy: 'm-log',
        status: 'acked',
        ackedAt: '2026-06-04T10:21:00.000Z'
      }
    }
  }
]
