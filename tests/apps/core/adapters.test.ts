import { describe, expect, it } from 'bun:test'
import { parseDurationToMs } from '../../../apps/core/src/adapters.ts'

describe('parseDurationToMs', () => {
  it('treats positive numeric strings as seconds', () => {
    expect(parseDurationToMs('60')).toBe(60_000)
    expect(parseDurationToMs('1')).toBe(1_000)
  })

  it('parses milliseconds unit', () => {
    expect(parseDurationToMs('500ms')).toBe(500)
  })

  it('parses seconds unit', () => {
    expect(parseDurationToMs('30s')).toBe(30_000)
  })

  it('parses minutes unit', () => {
    expect(parseDurationToMs('5m')).toBe(300_000)
  })

  it('parses hours unit', () => {
    expect(parseDurationToMs('1h')).toBe(3_600_000)
  })

  it('parses days unit', () => {
    expect(parseDurationToMs('1d')).toBe(86_400_000)
  })

  it('falls back to 1 hour for unparseable strings', () => {
    expect(parseDurationToMs('invalid')).toBe(3_600_000)
    expect(parseDurationToMs('')).toBe(3_600_000)
  })

  it('falls back to 1 hour for zero or negative numeric strings', () => {
    expect(parseDurationToMs('0')).toBe(3_600_000)
    expect(parseDurationToMs('-5')).toBe(3_600_000)
  })
})
