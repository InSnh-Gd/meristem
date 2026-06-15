import { describe, expect, it } from 'bun:test'
import type { CliClient, CliRunResult } from '../../../apps/m-cli/src/commands/types.ts'

describe('m-cli command types', () => {
  it('accepts a minimal CLI client contract', () => {
    const client: Pick<CliClient, 'status'> = {
      status: async () => ({
        version: '0.1.0',
        uptimeSeconds: 1,
        services: []
      })
    }

    expect(typeof client.status).toBe('function')
  })

  it('accepts a CLI run result contract', () => {
    const result: CliRunResult = { exitCode: 0, stdout: '{}\n', stderr: '' }

    expect(result).toEqual({ exitCode: 0, stdout: '{}\n', stderr: '' })
  })
})
