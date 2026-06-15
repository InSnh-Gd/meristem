import { describe, expect, it } from 'bun:test'
import {
  encode,
  requireArg,
  requireMethod,
  success
} from '../../../apps/m-cli/src/commands/shared.ts'

describe('m-cli commands shared utilities', () => {
  it('returns the value after a present flag', () => {
    expect(requireArg(['node', '--id', 'node-1'], '--id')).toBe('node-1')
  })

  it('throws when a flag is missing', () => {
    expect(() => requireArg(['node'], '--id')).toThrow('missing --id')
  })

  it('throws when a flag has no value', () => {
    expect(() => requireArg(['node', '--id'], '--id')).toThrow('missing --id')
  })

  it('encodes values as pretty JSON with a trailing newline', () => {
    expect(encode({ id: 'node-1', enabled: true })).toBe(
      '{\n  "id": "node-1",\n  "enabled": true\n}\n'
    )
  })

  it('wraps successful values in a CLI result', () => {
    expect(success(['ok'])).toEqual({
      exitCode: 0,
      stdout: '[\n  "ok"\n]\n',
      stderr: ''
    })
  })

  it('returns a required method when present', () => {
    const method = () => 'ok'

    expect(requireMethod(method, 'status')).toBe(method)
  })

  it('throws when a required method is absent', () => {
    expect(() => requireMethod(undefined, 'status')).toThrow('CLI client missing status')
  })
})
