import { describe, expect, it, test } from 'bun:test'
import * as Schema from 'effect/Schema'
import {
  ApprovalProfileProjectionSchema,
  BehaviorAnalysisProjectionSchema,
  ProjectionSourceTypeSchema,
  ProjectionStalenessSchema
} from '../../../packages/contracts/src/schemas/projection.ts'

/**
 * Projection infrastructure readiness check.
 * When neither OpenSearch nor PostgreSQL is available the suite self-skips
 * rather than failing on absent infrastructure.
 */
const infraAvailable = await (async () => {
  const osUrl = process.env.OPENSEARCH_URL ?? 'http://localhost:9200'
  try {
    const response = await fetch(`${osUrl}/_cluster/health?timeout=1s`, {
      signal: AbortSignal.timeout(2000)
    })
    if (response.ok) return true
  } catch {
    // OpenSearch not available, continue checking PostgreSQL
  }

  try {
    const pg = await import('../../../packages/db/src/client.ts')
    const client = pg.createSqlClient()
    await client`select 1`
    await client.end()
    return true
  } catch {
    return false
  }
})()

describe('Approval profile projections — schema contract', () => {
  const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  it('ProjectionSourceTypeSchema only allows valid source types', () => {
    expect(Schema.decodeUnknownSync(ProjectionSourceTypeSchema)('nats_event')).toBe('nats_event')
    expect(Schema.decodeUnknownSync(ProjectionSourceTypeSchema)('postgres_cdc')).toBe('postgres_cdc')
    expect(Schema.decodeUnknownSync(ProjectionSourceTypeSchema)('rest_api')).toBe('rest_api')
    expect(Schema.decodeUnknownSync(ProjectionSourceTypeSchema)('backfill')).toBe('backfill')
    expect(() => Schema.decodeUnknownSync(ProjectionSourceTypeSchema)('direct_db')).toThrow()
  })

  it('ProjectionStalenessSchema always marks authoritative as false', () => {
    const staleness = Schema.decodeUnknownSync(ProjectionStalenessSchema)({
      sourceType: 'nats_event',
      authoritative: false,
      projectedAt: futureDate,
      sourceEventId: 'evt-1'
    })
    expect(staleness.authoritative).toBe(false)
    expect(staleness.sourceType).toBe('nats_event')

    // authoritativeness is locked to false by the schema
    expect(() =>
      Schema.decodeUnknownSync(ProjectionStalenessSchema)({
        sourceType: 'nats_event',
        authoritative: true,
        projectedAt: futureDate
      })
    ).toThrow()
  })

  it('ProjectionStalenessSchema includes sourceType, projectedAt, and optional lagMs', () => {
    const withLag = Schema.decodeUnknownSync(ProjectionStalenessSchema)({
      sourceType: 'postgres_cdc',
      authoritative: false,
      projectedAt: futureDate,
      lagMs: 1500
    })
    expect(withLag.sourceType).toBe('postgres_cdc')
    expect(withLag.lagMs).toBe(1500)

    const withoutLag = Schema.decodeUnknownSync(ProjectionStalenessSchema)({
      sourceType: 'backfill',
      authoritative: false,
      projectedAt: futureDate
    })
    expect(withoutLag.lagMs).toBeUndefined()
  })

  it('round-trips ApprovalProfileProjectionSchema with enabled status', () => {
    const fixture = {
      networkId: 'net-profile-1',
      profileVersion: 'm-net-cn@0.1.0',
      status: 'enabled' as const,
      updatedAt: futureDate,
      staleness: {
        sourceType: 'nats_event' as const,
        authoritative: false as const,
        projectedAt: futureDate
      }
    }

    const decoded = Schema.decodeUnknownSync(ApprovalProfileProjectionSchema)(fixture)
    expect(decoded.networkId).toBe('net-profile-1')
    expect(decoded.profileVersion).toBe('m-net-cn@0.1.0')
    expect(decoded.status).toBe('enabled')
    expect(decoded.staleness.authoritative).toBe(false)
    expect(decoded.staleness.sourceType).toBe('nats_event')

    const encoded = Schema.encodeSync(ApprovalProfileProjectionSchema)(decoded)
    const roundTripped = Schema.decodeUnknownSync(ApprovalProfileProjectionSchema)(encoded)
    expect(roundTripped).toEqual(decoded)
  })

  it('round-trips ApprovalProfileProjectionSchema with disabled status', () => {
    const fixture = {
      networkId: 'net-profile-2',
      profileVersion: 'm-net-default@0.1.0',
      status: 'disabled' as const,
      updatedAt: futureDate,
      staleness: {
        sourceType: 'nats_event' as const,
        authoritative: false as const,
        projectedAt: futureDate,
        lagMs: 500
      }
    }

    const decoded = Schema.decodeUnknownSync(ApprovalProfileProjectionSchema)(fixture)
    expect(decoded.status).toBe('disabled')
    expect(decoded.staleness.lagMs).toBe(500)
  })

  it('profile UI projection rejects invalid status values', () => {
    expect(() =>
      Schema.decodeUnknownSync(ApprovalProfileProjectionSchema)({
        networkId: 'bad-status',
        profileVersion: 'v1',
        status: 'enabling',
        updatedAt: futureDate,
        staleness: {
          sourceType: 'nats_event',
          authoritative: false,
          projectedAt: futureDate
        }
      })
    ).toThrow()
  })

  it('round-trips BehaviorAnalysisProjectionSchema for vote recorded', () => {
    const fixture = {
      approvalId: 'approval-ba-1',
      actor: 'security-admin',
      action: 'approve' as const,
      decision: 'vote_recorded' as const,
      timestamp: futureDate,
      staleness: {
        sourceType: 'nats_event' as const,
        authoritative: false as const,
        projectedAt: futureDate,
        sourceEventId: 'evt-vote-1'
      }
    }

    const decoded = Schema.decodeUnknownSync(BehaviorAnalysisProjectionSchema)(fixture)
    expect(decoded.approvalId).toBe('approval-ba-1')
    expect(decoded.actor).toBe('security-admin')
    expect(decoded.action).toBe('approve')
    expect(decoded.decision).toBe('vote_recorded')
    expect(decoded.staleness.sourceType).toBe('nats_event')
    expect(decoded.staleness.authoritative).toBe(false)

    const encoded = Schema.encodeSync(BehaviorAnalysisProjectionSchema)(decoded)
    const roundTripped = Schema.decodeUnknownSync(BehaviorAnalysisProjectionSchema)(encoded)
    expect(roundTripped).toEqual(decoded)
  })

  it('round-trips BehaviorAnalysisProjectionSchema for terminal decisions', () => {
    for (const decision of ['approved', 'rejected'] as const) {
      const fixture = {
        approvalId: `approval-ba-term-${decision}`,
        actor: 'admin',
        action: decision === 'approved' ? ('approve' as const) : ('reject' as const),
        decision,
        timestamp: futureDate,
        staleness: {
          sourceType: 'postgres_cdc' as const,
          authoritative: false as const,
          projectedAt: futureDate
        }
      }

      const decoded = Schema.decodeUnknownSync(BehaviorAnalysisProjectionSchema)(fixture)
      expect(decoded.decision).toBe(decision)
    }
  })

  it('behavior-analysis projection rejects invalid decision values', () => {
    expect(() =>
      Schema.decodeUnknownSync(BehaviorAnalysisProjectionSchema)({
        approvalId: 'bad-decision',
        actor: 'admin',
        action: 'approve',
        decision: 'pending',
        timestamp: futureDate,
        staleness: {
          sourceType: 'nats_event',
          authoritative: false,
          projectedAt: futureDate
        }
      })
    ).toThrow()
  })

  it('projections remain non-authoritative regardless of sourceType', () => {
    const sourceTypes = ['nats_event', 'postgres_cdc', 'rest_api', 'backfill'] as const

    for (const sourceType of sourceTypes) {
      const projection = Schema.decodeUnknownSync(ApprovalProfileProjectionSchema)({
        networkId: `net-auth-check-${sourceType}`,
        profileVersion: 'm-net-default@0.1.0',
        status: 'disabled',
        updatedAt: futureDate,
        staleness: {
          sourceType,
          authoritative: false,
          projectedAt: futureDate
        }
      })
      expect(projection.staleness.authoritative).toBe(false)
    }
  })
})

describe('Approval profile projections — integration smoke', () => {
  test.skipIf(!infraAvailable)(
    'round-trips projection schemas against production-like payload shapes',
    () => {
      const now = new Date().toISOString()
      const payload = Schema.decodeUnknownSync(ApprovalProfileProjectionSchema)({
        networkId: 'net-smoke-1',
        profileVersion: 'm-net-cn@0.1.0',
        status: 'enabled',
        updatedAt: now,
        staleness: {
          sourceType: 'nats_event',
          authoritative: false,
          projectedAt: now,
          sourceEventId: 'evt-smoke-1',
          lagMs: 42
        }
      })
      expect(payload.staleness.lagMs).toBe(42)

      const behaviorPayload = Schema.decodeUnknownSync(BehaviorAnalysisProjectionSchema)({
        approvalId: 'approval-smoke-1',
        actor: 'security-admin',
        action: 'approve',
        decision: 'approved',
        timestamp: now,
        staleness: {
          sourceType: 'postgres_cdc',
          authoritative: false,
          projectedAt: now
        }
      })
      expect(behaviorPayload.decision).toBe('approved')
    }
  )

  test.skipIf(infraAvailable)(
    'skipped: projection infrastructure unavailable, run docker compose up -d opensearch or postgres',
    () => {
      expect(infraAvailable).toBe(false)
    }
  )
})
