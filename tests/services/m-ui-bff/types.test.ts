import { describe, expect, it } from 'bun:test'
import {
  commandIdParamsSchema,
  idParamsSchema,
  leafNodeIdBodySchema
} from '../../../services/m-ui-bff/src/routes/route-schemas.ts'
import {
  GENERIC_NOOP_COMMAND_ID,
  type GenericNoopEligibility,
  type StateSourceMetadata
} from '../../../services/m-ui-bff/src/types.ts'

describe('m-ui-bff exported types and constants', () => {
  it('imports state source metadata type', () => {
    const metadata: StateSourceMetadata = {
      sourceType: 'authoritative',
      sourceId: 'core:nodes',
      correlationId: 'correlation-1',
      traceId: 'trace-1'
    }

    expect(metadata).toEqual({
      sourceType: 'authoritative',
      sourceId: 'core:nodes',
      correlationId: 'correlation-1',
      traceId: 'trace-1'
    })
  })

  it('imports generic noop eligibility type and command id', () => {
    const eligibility: GenericNoopEligibility = {
      state: 'enabled',
      command: {
        id: GENERIC_NOOP_COMMAND_ID,
        label: '运行 noop 任务',
        action: 'task:submit',
        resource: 'leaf-1',
        risk: 'medium',
        requiredPermissions: ['task:submit'],
        requiresPolicy: true,
        requiresAudit: true
      }
    }

    expect(GENERIC_NOOP_COMMAND_ID).toBe('task.noop.submit')
    expect(eligibility.command.id).toBe(GENERIC_NOOP_COMMAND_ID)
  })

  it('imports route schema exports', () => {
    expect(idParamsSchema.type).toBe('object')
    expect(commandIdParamsSchema.type).toBe('object')
    expect(leafNodeIdBodySchema.type).toBe('object')
  })
})
