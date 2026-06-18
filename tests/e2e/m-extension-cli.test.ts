/// <reference types="bun" />
import { describe, expect, it } from 'bun:test'
import { createCliRunner } from '../../apps/m-cli/src/cli.ts'

describe('e2e: M-Extension CLI surface', () => {
  it('exposes extension commands without relying on Core authoritative state', async () => {
    const cli = createCliRunner({
      async status() {
        throw new Error('not used')
      }
    })

    const result = await cli.run(['extension', 'register'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('usage: meristem extension register <manifest-file>')
  })
})
