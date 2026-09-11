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

  it('maps network delete preconditions and retained-ledger conflicts to 409', () => {
    for (const code of [
      'network.members_present',
      'network.profile_not_disabled',
      'network.closed_loop_facts_present',
      'network.switch_membership_present',
      'network.operation_suspended'
    ]) {
      expect(statusCodeForServiceError(code)).toBe(409)
    }
  })

  it('maps network delete not-found to 404', () => {
    expect(statusCodeForServiceError('network.not_found')).toBe(404)
    expect(statusCodeForServiceError('network.member_not_found')).toBe(404)
  })
})
