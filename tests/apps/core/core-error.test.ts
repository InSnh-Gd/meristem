import { describe, expect, it } from 'bun:test'
import { CoreError } from '../../../apps/core/src/core-error.ts'

describe('CoreError', () => {
  it('stores status, code, message, correlationId, and name', () => {
    const error = new CoreError(401, 'core.unauthorized', 'denied', 'corr-1')

    expect(error.status).toBe(401)
    expect(error.code).toBe('core.unauthorized')
    expect(error.message).toBe('denied')
    expect(error.correlationId).toBe('corr-1')
    expect(error.name).toBe('CoreError')
  })

  it('is an Error instance', () => {
    const error = new CoreError(500, 'core.internal', 'failed')

    expect(error).toBeInstanceOf(Error)
  })

  it('allows missing correlationId', () => {
    const error = new CoreError(404, 'core.not_found', 'missing')

    expect(error.correlationId).toBeUndefined()
  })
})
