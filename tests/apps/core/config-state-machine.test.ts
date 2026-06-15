import { describe, expect, it } from 'bun:test'
import {
  computeConfigHash,
  computeConfigVersion
} from '../../../apps/core/src/config-state-machine.ts'

describe('computeConfigHash', () => {
  it('returns a 64-character hex string', async () => {
    const hash = await computeConfigHash({ domain: 'm-net' })

    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('returns the same hash for the same payload', async () => {
    const payload = { domain: 'm-net', enabled: true }

    await expect(computeConfigHash(payload)).resolves.toBe(await computeConfigHash(payload))
  })

  it('returns different hashes for different payloads', async () => {
    const left = await computeConfigHash({ domain: 'm-net', enabled: true })
    const right = await computeConfigHash({ domain: 'm-net', enabled: false })

    expect(left).not.toBe(right)
  })

  it('handles nested objects with stable key ordering', async () => {
    const left = await computeConfigHash({ nested: { beta: 2, alpha: 1 } })
    const right = await computeConfigHash({ nested: { alpha: 1, beta: 2 } })

    expect(left).toBe(right)
  })

  it('handles arrays', async () => {
    const left = await computeConfigHash({ targets: ['core', 'm-net'] })
    const right = await computeConfigHash({ targets: ['m-net', 'core'] })

    expect(left).not.toBe(right)
  })
})

describe('computeConfigVersion', () => {
  it('returns hash prefix and timestamp format', () => {
    expect(computeConfigVersion('abc12345def67890', 1234567890)).toBe('abc12345-1234567890')
  })

  it('returns consistent output for same inputs', () => {
    const hash = 'abcdef1234567890'
    const timestamp = 1234567890

    expect(computeConfigVersion(hash, timestamp)).toBe(computeConfigVersion(hash, timestamp))
  })
})
