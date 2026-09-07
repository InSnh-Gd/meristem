import { describe, expect, it } from 'bun:test'
import { Effect, Result } from 'effect'
import {
  decodeMNetCreateNetworkResponse,
  decodeMNetNoopTaskResponse
} from '../../apps/core/src/adapters/mnet-response-decode.ts'

describe('cross-service decode hardening', () => {
  it('rejects malformed M-Net network payload with typed decode failure', async () => {
    const result = await Effect.runPromise(
      Effect.result(
        decodeMNetCreateNetworkResponse({
          network: {
            id: 'net-1',
            name: 42,
            profileVersion: 'm-net-default@0.1.0',
            status: 'active',
            createdAt: '2026-06-18T10:00:00.000Z'
          }
        })
      )
    )

    expect(Result.isFailure(result)).toBe(true)
    if (!Result.isFailure(result)) {
      throw new Error('expected decode failure for malformed M-Net response')
    }

    const failure = result.failure
    expect(failure.code).toBe('mnet.invalid_response')
    expect(failure.message).toContain('M-Net returned invalid response payload')
    expect(failure.message).toContain('Expected string, actual 42')
  })

  it('decodes valid M-Net payload successfully', async () => {
    const response = await Effect.runPromise(
      decodeMNetCreateNetworkResponse({
        network: {
          id: 'net-1',
          name: 'primary',
          profileVersion: 'm-net-default@0.1.0',
          status: 'active',
          createdAt: '2026-06-18T10:00:00.000Z'
        }
      })
    )

    expect(response.network.name).toBe('primary')
    expect(response.network.profileVersion).toBe('m-net-default@0.1.0')
  })

  it('rejects missing fields in M-Task to M-Net noop payload', async () => {
    const result = await Effect.runPromise(
      Effect.result(
        decodeMNetNoopTaskResponse({
          result: {
            nodeId: 'node-1',
            taskId: 'demo-decode-task',
            result: 'completed'
          }
        })
      )
    )

    expect(Result.isFailure(result)).toBe(true)
    if (!Result.isFailure(result)) {
      throw new Error('expected decode failure for incomplete noop response')
    }

    const failure = result.failure
    expect(failure.code).toBe('nodeagent.invalid_response')
    expect(failure.message).toContain('completedAt')
  })
})
