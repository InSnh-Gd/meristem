import { describe, expect, it } from 'bun:test'
import { err, ok, type Result } from '../../../packages/common/src/result.ts'

describe('result helpers', () => {
  it('ok() returns a successful result for a string', () => {
    expect(ok('ready')).toEqual({ ok: true, value: 'ready' })
  })

  it('ok() returns a successful result for a number', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 })
  })

  it('ok() returns a successful result for an object', () => {
    const value = { id: 'node-1', enabled: true }

    expect(ok(value)).toEqual({ ok: true, value })
  })

  it('ok() returns a successful result for null', () => {
    expect(ok(null)).toEqual({ ok: true, value: null })
  })

  it('err() returns a failed result for a string error', () => {
    expect(err('not-found')).toEqual({ ok: false, error: 'not-found' })
  })

  it('err() returns a failed result for an Error instance', () => {
    const error = new Error('boom')

    expect(err(error)).toEqual({ ok: false, error })
  })

  it('err() returns a failed result for an object error', () => {
    const error = { code: 'E_DENIED', retryable: false }

    expect(err(error)).toEqual({ ok: false, error })
  })

  it('err() returns a failed result for null', () => {
    expect(err(null)).toEqual({ ok: false, error: null })
  })

  it('Result type works with pattern matching', () => {
    const render = (result: Result<number, string>) => {
      if (result.ok) {
        return `value:${result.value}`
      }

      return `error:${result.error}`
    }

    expect(render(ok(7))).toBe('value:7')
    expect(render(err('invalid'))).toBe('error:invalid')
  })

  it('discriminated union narrows correctly for ok branches', () => {
    const result: Result<{ name: string }, { code: string }> = ok({ name: 'stem' })

    if (result.ok) {
      const value: { name: string } = result.value

      expect(value.name).toBe('stem')
    } else {
      const error: { code: string } = result.error

      expect(error.code).toBe('unreachable')
    }
  })

  it('discriminated union narrows correctly for err branches', () => {
    const result: Result<{ name: string }, { code: string }> = err({ code: 'E_MISSING' })

    if (result.ok) {
      const value: { name: string } = result.value

      expect(value.name).toBe('unreachable')
    } else {
      const error: { code: string } = result.error

      expect(error.code).toBe('E_MISSING')
    }
  })
})
