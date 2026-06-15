import { describe, expect, it } from 'bun:test'
import {
  errorMessageFromHttpResponse,
  serviceErrorFromHttpResponse
} from '../../../apps/core/src/effect-helpers.ts'

describe('errorMessageFromHttpResponse', () => {
  it('extracts error message from error envelope', () => {
    expect(errorMessageFromHttpResponse({ error: { message: 'msg' } }, 'fallback')).toBe('msg')
  })

  it('returns fallback for non-object values', () => {
    expect(errorMessageFromHttpResponse('bad', 'fallback')).toBe('fallback')
    expect(errorMessageFromHttpResponse(null, 'fallback')).toBe('fallback')
  })

  it('returns fallback when error is not an object', () => {
    expect(errorMessageFromHttpResponse({ error: 'bad' }, 'fallback')).toBe('fallback')
  })

  it('returns fallback when message is not a string', () => {
    expect(errorMessageFromHttpResponse({ error: { message: 123 } }, 'fallback')).toBe('fallback')
  })
})

describe('serviceErrorFromHttpResponse', () => {
  it('extracts code and message from error envelope', () => {
    expect(
      serviceErrorFromHttpResponse(
        { error: { code: 'service.failed', message: 'failed' } },
        'fallback.code',
        'fallback message'
      )
    ).toEqual({ code: 'service.failed', message: 'failed' })
  })

  it('returns fallback for non-object values', () => {
    expect(serviceErrorFromHttpResponse('bad', 'fallback.code', 'fallback message')).toEqual({
      code: 'fallback.code',
      message: 'fallback message'
    })
  })

  it('returns fallbackCode when code is not a string', () => {
    expect(
      serviceErrorFromHttpResponse(
        { error: { code: 123, message: 'failed' } },
        'fallback.code',
        'fallback message'
      )
    ).toEqual({ code: 'fallback.code', message: 'failed' })
  })
})
