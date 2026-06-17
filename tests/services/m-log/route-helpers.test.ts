import { describe, expect, it } from 'bun:test'
import {
  toAuditSearchQuery,
  toBackfillParams,
  toFullSearchQuery,
  toTimelineSearchQuery
} from '../../../services/m-log/src/route-helpers.ts'

describe('toFullSearchQuery', () => {
  it('returns an empty object for an empty query', () => {
    expect(toFullSearchQuery({})).toEqual({})
  })

  it('returns all supported fields when provided', () => {
    expect(
      toFullSearchQuery({
        q: 'error',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
        limit: '25',
        level: 'warn',
        source: 'm-log',
        correlationId: 'corr-1',
        traceId: 'trace-1'
      })
    ).toEqual({
      q: 'error',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-02T00:00:00.000Z',
      limit: 25,
      level: 'warn',
      source: 'm-log',
      correlationId: 'corr-1',
      traceId: 'trace-1'
    })
  })

  it('coerces string limits to numbers', () => {
    expect(toFullSearchQuery({ limit: '10' })).toEqual({ limit: 10 })
  })

  it('keeps numeric limits as numbers', () => {
    expect(toFullSearchQuery({ limit: 15 })).toEqual({ limit: 15 })
  })

  it('omits limit when it is undefined', () => {
    expect(toFullSearchQuery({ q: 'error', limit: undefined })).toEqual({ q: 'error' })
  })

  it('returns only the provided partial fields', () => {
    expect(toFullSearchQuery({ source: 'm-log', traceId: 'trace-2' })).toEqual({
      source: 'm-log',
      traceId: 'trace-2'
    })
  })
})

describe('toTimelineSearchQuery', () => {
  it('returns all supported fields when provided', () => {
    expect(
      toTimelineSearchQuery({
        q: 'timeline',
        from: '2026-02-01T00:00:00.000Z',
        to: '2026-02-02T00:00:00.000Z',
        limit: '12',
        subject: 'node:leaf-1',
        correlationId: 'corr-2'
      })
    ).toEqual({
      q: 'timeline',
      from: '2026-02-01T00:00:00.000Z',
      to: '2026-02-02T00:00:00.000Z',
      limit: 12,
      subject: 'node:leaf-1',
      correlationId: 'corr-2'
    })
  })

  it('returns an empty object for an empty query', () => {
    expect(toTimelineSearchQuery({})).toEqual({})
  })

  it('coerces string limits to numbers', () => {
    expect(toTimelineSearchQuery({ limit: '8' })).toEqual({ limit: 8 })
  })

  it('omits limit when it is undefined', () => {
    expect(toTimelineSearchQuery({ subject: 'node:leaf-2', limit: undefined })).toEqual({
      subject: 'node:leaf-2'
    })
  })

  it('returns only the provided partial fields', () => {
    expect(toTimelineSearchQuery({ q: 'partial', correlationId: 'corr-3' })).toEqual({
      q: 'partial',
      correlationId: 'corr-3'
    })
  })
})

describe('toAuditSearchQuery', () => {
  it('returns all supported fields when provided', () => {
    expect(
      toAuditSearchQuery({
        q: 'policy',
        from: '2026-03-01T00:00:00.000Z',
        to: '2026-03-02T00:00:00.000Z',
        limit: '6',
        actor: 'admin',
        action: 'policy.write',
        resource: 'm-policy/rule',
        decisionId: 'decision-1',
        correlationId: 'corr-4'
      })
    ).toEqual({
      q: 'policy',
      from: '2026-03-01T00:00:00.000Z',
      to: '2026-03-02T00:00:00.000Z',
      limit: 6,
      actor: 'admin',
      action: 'policy.write',
      resource: 'm-policy/rule',
      decisionId: 'decision-1',
      correlationId: 'corr-4'
    })
  })

  it('returns an empty object for an empty query', () => {
    expect(toAuditSearchQuery({})).toEqual({})
  })

  it('coerces string limits to numbers', () => {
    expect(toAuditSearchQuery({ limit: '4' })).toEqual({ limit: 4 })
  })

  it('returns only the provided partial fields', () => {
    expect(toAuditSearchQuery({ actor: 'security-admin', decisionId: 'decision-2' })).toEqual({
      actor: 'security-admin',
      decisionId: 'decision-2'
    })
  })
})

describe('toBackfillParams', () => {
  it('maps the minimal body and defaults cursors to null', () => {
    expect(toBackfillParams({ index: 'timeline', batchSize: 100 })).toEqual({
      index: 'timeline',
      from: null,
      to: null,
      batchSize: 100
    })
  })

  it('maps the full body with cursors and target version', () => {
    expect(
      toBackfillParams({
        index: 'audit',
        from: { factId: 'fact-1', timestamp: '2026-04-01T00:00:00.000Z' },
        to: { factId: 'fact-2', timestamp: '2026-04-02T00:00:00.000Z' },
        batchSize: 50,
        targetVersion: 'v2'
      })
    ).toEqual({
      index: 'audit',
      from: { factId: 'fact-1', timestamp: '2026-04-01T00:00:00.000Z' },
      to: { factId: 'fact-2', timestamp: '2026-04-02T00:00:00.000Z' },
      batchSize: 50,
      targetVersion: 'v2'
    })
  })

  it('coerces string batchSize values to numbers', () => {
    expect(toBackfillParams({ index: 'full', batchSize: '25' })).toEqual({
      index: 'full',
      from: null,
      to: null,
      batchSize: 25
    })
  })

  it('omits targetVersion when it is not provided', () => {
    expect(
      toBackfillParams({ index: 'timeline', batchSize: 10, from: undefined, to: undefined })
    ).toEqual({
      index: 'timeline',
      from: null,
      to: null,
      batchSize: 10
    })
  })
})
