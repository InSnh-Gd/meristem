import { describe, expect, it } from 'bun:test'
import { statusCodeForServiceError } from '../../apps/core/src/middleware/route-support.ts'

describe('Core route support service error mapping', () => {
  it('maps node-control caller conflicts to 409 instead of upstream unavailable', () => {
    for (const code of [
      'node.control.invalid_transition',
      'node.control.target_kind_required',
      'node.control.role_unchanged',
      'node.control.last_stem_required'
    ]) {
      expect(statusCodeForServiceError(code)).toBe(409)
    }
  })
})
