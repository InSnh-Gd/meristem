import { describe, expect, it } from 'bun:test'
import {
  authHeaders,
  type EdenResponse,
  errorMessage,
  unwrap
} from '../../../apps/m-cli/src/clients/shared.ts'

describe('m-cli client shared utilities', () => {
  it('builds authorization headers when a token is present', () => {
    expect(authHeaders('token-1')).toEqual({ authorization: 'Bearer token-1' })
  })

  it('returns empty headers when a token is absent', () => {
    expect(authHeaders(undefined)).toEqual({})
  })

  it('extracts nested Eden error messages', () => {
    const response: EdenResponse<unknown> = {
      data: null,
      error: { value: { error: { message: 'denied' } }, status: 403 },
      status: 403
    }

    expect(errorMessage(response)).toBe('denied')
  })

  it('falls back to response status when no Eden error is present', () => {
    expect(errorMessage({ data: null, error: null, status: 500 })).toBe('request failed: 500')
  })

  it('falls back to response status when error shape has no message', () => {
    const response: EdenResponse<unknown> = {
      data: null,
      error: { value: { error: { code: 'E_DENIED' } }, status: 403 },
      status: 403
    }

    expect(errorMessage(response)).toBe('request failed: 403')
  })

  it('unwraps successful Eden data', async () => {
    await expect(
      unwrap<{ id: string }>(Promise.resolve({ data: { id: 'node-1' }, error: null, status: 200 }))
    ).resolves.toEqual({ id: 'node-1' })
  })

  it('throws when Eden returns an error', async () => {
    const response: EdenResponse<unknown> = {
      data: null,
      error: { value: { error: { message: 'missing permission' } }, status: 403 },
      status: 403
    }

    await expect(unwrap(Promise.resolve(response))).rejects.toThrow('missing permission')
  })

  it('throws when Eden returns null data', async () => {
    await expect(unwrap(Promise.resolve({ data: null, error: null, status: 204 }))).rejects.toThrow(
      'request failed: 204'
    )
  })
})
