import type { ResponseContract } from './schema-coverage.ts'
import { Contracts } from './schema-coverage.ts'

export const mLogResponseContracts: ResponseContract[] = [
  {
    route: 'GET /api/v0/logs/timeline',
    schema: Contracts.TimelineLogListResponseSchema,
    fixture: {
      entries: [
        {
          id: 'tl-1',
          timestamp: '2026-06-04T10:00:00.000Z',
          summary: 'core started',
          subject: 'meristem-core',
          correlationId: 'corr-8'
        }
      ]
    }
  },
  {
    route: 'GET /api/v0/logs/full',
    schema: Contracts.FullLogListResponseSchema,
    fixture: {
      entries: [
        {
          id: 'fl-1',
          timestamp: '2026-06-04T10:00:00.000Z',
          level: 'info',
          source: 'meristem-core',
          message: 'boot complete',
          correlationId: 'corr-9',
          payload: { ok: true }
        }
      ]
    }
  },
  {
    route: 'GET /api/v0/audit',
    schema: Contracts.AuditLogListResponseSchema,
    fixture: {
      entries: [
        {
          id: 'al-1',
          timestamp: '2026-06-04T10:00:00.000Z',
          actor: 'system',
          action: 'boot',
          resource: 'core',
          result: 'success',
          correlationId: 'corr-10'
        }
      ]
    }
  },
  {
    route: 'GET /api/v0/logs/timeline/search',
    schema: Contracts.TimelineLogSearchResponseSchema,
    fixture: {
      entries: [
        {
          id: 'tl-2',
          timestamp: '2026-06-04T10:00:00.000Z',
          summary: 'node joined',
          subject: 'node-1'
        }
      ],
      total: 1
    }
  },
  {
    route: 'GET /api/v0/logs/full/search',
    schema: Contracts.FullLogSearchResponseSchema,
    fixture: {
      entries: [
        {
          id: 'fl-2',
          timestamp: '2026-06-04T10:00:00.000Z',
          level: 'warn',
          source: 'm-task',
          message: 'retry is not implemented'
        }
      ],
      total: 1
    }
  },
  {
    route: 'GET /api/v0/audit/search',
    schema: Contracts.AuditLogSearchResponseSchema,
    fixture: {
      entries: [
        {
          id: 'al-2',
          timestamp: '2026-06-04T10:00:00.000Z',
          actor: 'admin',
          action: 'config:publish',
          resource: 'config:cfg-1',
          result: 'allow'
        }
      ],
      total: 1
    }
  }
]
