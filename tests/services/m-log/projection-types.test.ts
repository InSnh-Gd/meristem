import { describe, expect, it } from 'bun:test'

describe('projection types module', () => {
  it('imports without runtime exports', async () => {
    const module = await import('../../../services/m-log/src/projection/types.ts')

    expect(Object.keys(module)).toEqual([])
  })
})
