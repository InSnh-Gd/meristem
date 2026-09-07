import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import {
  CoreModeSchema,
  DependencyStateSchema,
  FullLogLevelSchema,
  NetworkMembershipModeSchema,
  NodeControlActionSchema,
  NodeControlRequestSchema,
  NodeKindSchema,
  NodeModeSchema,
  NodeReachabilitySchema,
  NodeStatusSchema,
  OperationDangerLevelSchema,
  PolicyDecisionSchema,
  PolicyResultSchema,
  RiskFactorSchema,
  ServiceDomainSchema,
  ServiceKindSchema,
  ServiceRuntimeModeSchema,
  SessionResponseSchema
} from '../../packages/contracts/src/schemas/core.ts'

describe('core schema contracts', () => {
  it('accepts a non-empty node control reason without changing its encoded shape', () => {
    const request = { action: 'disable' as const, reason: 'operator request' }

    expect(Schema.decodeUnknownSync(NodeControlRequestSchema)(request)).toEqual(request)
    expect(Schema.encodeSync(NodeControlRequestSchema)(request)).toEqual(request)
  })

  it('rejects an empty node control reason', () => {
    expect(() =>
      Schema.decodeUnknownSync(NodeControlRequestSchema)({
        action: 'disable',
        reason: ''
      })
    ).toThrow('Expected a value with a length of at least 1')
  })

  it('preserves non-first members and rejects unknown values in every migrated literal list', () => {
    const nonFirstMembers = [
      [DependencyStateSchema, 'unavailable'],
      [ServiceDomainSchema, 'm-net'],
      [ServiceKindSchema, 'internal'],
      [CoreModeSchema, 'degraded'],
      [ServiceRuntimeModeSchema, 'degraded'],
      [NodeKindSchema, 'leaf'],
      [NodeModeSchema, 'managed'],
      [NodeReachabilitySchema, 'public'],
      [NodeStatusSchema, 'joining'],
      [NodeControlActionSchema, 'isolate'],
      [NetworkMembershipModeSchema, 'restricted'],
      [PolicyResultSchema, 'deny'],
      [OperationDangerLevelSchema, 'medium'],
      [RiskFactorSchema, 'operation_danger_level'],
      [FullLogLevelSchema, 'info']
    ] as const

    for (const [schema, value] of nonFirstMembers) {
      expect(Schema.decodeUnknownSync(schema)(value)).toBe(value)
      expect(() => Schema.decodeUnknownSync(schema)('__unknown__')).toThrow()
    }

    expect(
      Schema.decodeUnknownSync(SessionResponseSchema)({
        actor: 'operator',
        permissions: ['node:register']
      })
    ).toEqual({ actor: 'operator', permissions: ['node:register'] })
    expect(
      Schema.decodeUnknownSync(PolicyDecisionSchema)({
        id: 'decision-1',
        actor: 'admin',
        action: 'node:disable',
        resource: 'node-1',
        result: 'require_manual_review',
        reasons: [],
        requiredAction: 'multi_approval',
        createdAt: '2026-08-27T00:00:00.000Z'
      })
    ).toMatchObject({ actor: 'admin', action: 'node:disable', requiredAction: 'multi_approval' })
  })
})
