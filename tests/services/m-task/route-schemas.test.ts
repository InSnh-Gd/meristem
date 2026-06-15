import { describe, expect, it } from 'bun:test'
import {
  apiErrorSchema,
  policyBlockSchema,
  retryNotImplementedSchema,
  riskSchema,
  taskSchema
} from '../../../services/m-task/src/route-schemas.ts'

type LiteralSchema = { const: string }
type UnionSchema = { anyOf: LiteralSchema[] }
type ObjectSchema = {
  type: string
  required?: string[]
  properties: Record<string, unknown>
}

function literalValues(schema: UnionSchema): string[] {
  return schema.anyOf.map(option => option.const)
}

describe('m-task route schemas', () => {
  it('exports all runtime schemas', async () => {
    const module = await import('../../../services/m-task/src/route-schemas.ts')

    expect(Object.keys(module).sort()).toEqual([
      'apiErrorSchema',
      'policyBlockSchema',
      'retryNotImplementedSchema',
      'riskSchema',
      'taskSchema'
    ])
  })

  it('defines api error response shape', () => {
    const schema = apiErrorSchema as ObjectSchema
    const error = schema.properties.error as ObjectSchema

    expect(schema.type).toBe('object')
    expect(schema.required).toEqual(['error'])
    expect(error.required).toEqual(['code', 'message'])
    expect(Object.keys(error.properties).sort()).toEqual(['code', 'correlationId', 'message'])
  })

  it('defines risk literals and required fields', () => {
    const schema = riskSchema as ObjectSchema

    expect(schema.required).toEqual(['operationDangerLevel', 'suspicionScore', 'riskFactors'])
    expect(literalValues(schema.properties.operationDangerLevel as UnionSchema)).toEqual([
      'low',
      'medium',
      'high',
      'critical'
    ])
  })

  it('defines task status literals and optional timestamps', () => {
    const schema = taskSchema as ObjectSchema

    expect(schema.required).toEqual([
      'id',
      'nodeId',
      'leafNodeId',
      'type',
      'status',
      'createdAt',
      'updatedAt'
    ])
    expect((schema.properties.type as LiteralSchema).const).toBe('noop')
    expect(literalValues(schema.properties.status as UnionSchema)).toEqual([
      'accepted',
      'queued',
      'dispatched',
      'running',
      'completed',
      'failed',
      'cancel_requested',
      'canceled',
      'timed_out'
    ])
    expect(Object.keys(schema.properties).sort()).toEqual([
      'canceledAt',
      'completedAt',
      'createdAt',
      'id',
      'leafNodeId',
      'nodeId',
      'status',
      'timeoutAt',
      'type',
      'updatedAt'
    ])
  })

  it('defines policy block decisions and retry not implemented code', () => {
    const block = policyBlockSchema as ObjectSchema
    const decision = (block.properties.policyDecision as ObjectSchema).properties
    const retry = retryNotImplementedSchema as ObjectSchema
    const retryError = retry.properties.error as ObjectSchema

    expect(literalValues(decision.result as UnionSchema)).toEqual([
      'require_manual_review',
      'require_multi_approval',
      'deny'
    ])
    expect(Object.keys(block.properties).sort()).toEqual(['policyDecision', 'risk'])
    expect((retryError.properties.code as LiteralSchema).const).toBe('not_implemented_yet')
    expect(Object.keys(retry.properties).sort()).toEqual(['decisionId', 'error', 'risk'])
  })
})
