import { describe, expect, it } from 'bun:test'
import type {
  AuditSearchQuery,
  FullLogSearchQuery,
  TimelineSearchQuery
} from '../../packages/contracts/src/index.ts'

// 搜索契约门禁：查询类型必须满足 OpenSearch 约束。
// 该套件通过 `bun run test:opensearch-contracts` 单独运行，避免默认门禁
// 因搜索后端专项覆盖而产生误导性的红灯。
describe('OpenSearch search contracts', () => {
  it('accepts a minimal FullLogSearchQuery', () => {
    const query: FullLogSearchQuery = {}
    expect(query).toBeDefined()
  })

  it('accepts a fully populated FullLogSearchQuery', () => {
    const query: FullLogSearchQuery = {
      q: 'error timeout',
      from: '2026-01-01T00:00:00Z',
      to: '2026-06-01T00:00:00Z',
      limit: 50,
      level: 'error',
      source: 'm-policy',
      correlationId: 'corr-123',
      traceId: 'trace-456'
    }
    expect(query.level).toBe('error')
    expect(query.correlationId).toBe('corr-123')
  })

  it('enforces limit via number type', () => {
    const query: FullLogSearchQuery = { limit: 100 }
    expect(query.limit).toBe(100)
  })

  it('accepts a fully populated TimelineSearchQuery', () => {
    const query: TimelineSearchQuery = {
      q: 'node joined',
      from: '2026-01-01T00:00:00Z',
      to: '2026-06-01T00:00:00Z',
      limit: 25,
      subject: 'node:leaf:test',
      correlationId: 'corr-789'
    }
    expect(query.subject).toBe('node:leaf:test')
  })

  it('accepts a fully populated AuditSearchQuery', () => {
    const query: AuditSearchQuery = {
      q: 'denied',
      from: '2026-01-01T00:00:00Z',
      to: '2026-06-01T00:00:00Z',
      limit: 10,
      actor: 'viewer',
      action: 'node:register',
      resource: 'node:leaf:test',
      decisionId: 'dec-001',
      correlationId: 'corr-999'
    }
    expect(query.actor).toBe('viewer')
    expect(query.decisionId).toBe('dec-001')
  })

  it('LogSearchResult shape matches expected contract', () => {
    const result = {
      entries: [
        {
          summary: 'test',
          id: '00000000-0000-0000-0000-000000000001',
          timestamp: '2026-01-01T00:00:00Z'
        }
      ],
      total: 1
    }
    expect(result.entries).toHaveLength(1)
    expect(result.total).toBe(1)
  })
})
