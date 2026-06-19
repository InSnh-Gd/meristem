import { afterEach, describe, expect, it } from 'bun:test'
import {
  errorMessageFromEnvelope,
  internalRequestHeaders,
  internalTokenHeaderName,
  requiredInternalToken,
  serviceErrorFromEnvelope,
  warnDegradedAndReturn,
  serviceUrl,
  validateInternalRequest
} from '../../../packages/internal-http/src/index.ts'

const originalToken = process.env.MERISTEM_INTERNAL_TOKEN

afterEach(() => {
  if (originalToken === undefined) {
    delete process.env.MERISTEM_INTERNAL_TOKEN
  } else {
    process.env.MERISTEM_INTERNAL_TOKEN = originalToken
  }
})

describe('internal-http helpers', () => {
  it('builds request headers with the internal token and preserves caller headers', () => {
    process.env.MERISTEM_INTERNAL_TOKEN = 'shared-token'

    const headers = internalRequestHeaders({ 'x-request-id': 'req-1' })

    expect(headers[internalTokenHeaderName]).toBe('shared-token')
    expect(headers['x-request-id']).toBe('req-1')
  })

  it('validates the expected internal token for object and Headers inputs', () => {
    process.env.MERISTEM_INTERNAL_TOKEN = 'shared-token'

    expect(validateInternalRequest({ [internalTokenHeaderName]: 'shared-token' })).toEqual({
      ok: true
    })
    expect(
      validateInternalRequest(new Headers({ [internalTokenHeaderName]: 'wrong-token' }))
    ).toEqual({
      ok: false,
      error: { code: 'internal.unauthorized', message: 'invalid internal token' }
    })
  })

  it('fails closed when internal auth is not configured', () => {
    delete process.env.MERISTEM_INTERNAL_TOKEN

    expect(() => requiredInternalToken()).toThrow('MERISTEM_INTERNAL_TOKEN is required')
    expect(validateInternalRequest({})).toEqual({
      ok: false,
      error: { code: 'internal.unavailable', message: 'internal auth is not configured' }
    })
  })

  it('derives loopback URLs from the fixed internal service table', () => {
    expect(serviceUrl('m-policy')).toBe('http://127.0.0.1:3101')
    expect(serviceUrl('m-eventbus')).toBe('http://127.0.0.1:3103')
  })

  it('extracts code and message from the shared error envelope', () => {
    expect(
      serviceErrorFromEnvelope(
        { error: { code: 'service.failed', message: 'failed' } },
        { code: 'fallback.code', message: 'fallback message' }
      )
    ).toEqual({ code: 'service.failed', message: 'failed' })
  })

  it('falls back when the shared error envelope is invalid', () => {
    expect(serviceErrorFromEnvelope('bad', { code: 'fallback.code', message: 'fallback' })).toEqual(
      {
        code: 'fallback.code',
        message: 'fallback'
      }
    )
    expect(errorMessageFromEnvelope({ error: { message: 123 } }, 'fallback')).toBe('fallback')
  })

  it('logs degraded context and returns the provided fallback', () => {
    const warnings: Array<{ target: string; error: string; message: string }> = []

    const fallback = warnDegradedAndReturn({
      service: 'm-net',
      target: 'postgres',
      error: new Error('db down'),
      context: 'readiness probe degraded',
      fallback: false,
      warn: warning => warnings.push(warning)
    })

    expect(fallback).toBe(false)
    expect(warnings).toEqual([
      {
        target: 'postgres',
        error: 'db down',
        message: 'm-net: postgres readiness probe degraded - db down'
      }
    ])
  })
})
