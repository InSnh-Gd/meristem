import { describe, expect, it } from 'bun:test'
import { statusCodeForMNetError } from './route-helpers.ts'

/**
 * M-Net 内部 HTTP 面的错误码 → 状态码登记表：
 * 新增业务错误码必须在这里显式归类，避免 default 503 把客户端错误伪装成上游不可用。
 */
describe('statusCodeForMNetError', () => {
  it('maps network deletion preconditions and retained-ledger conflicts to 409', () => {
    for (const code of [
      'network.conflict',
      'network.members_present',
      'network.profile_not_disabled',
      'network.closed_loop_facts_present',
      'network.switch_membership_present',
      'network.operation_suspended'
    ]) {
      expect(statusCodeForMNetError(code)).toBe(409)
    }
  })

  it('maps missing network/member resources to 404', () => {
    for (const code of ['network.not_found', 'network.member_not_found', 'node.not_found']) {
      expect(statusCodeForMNetError(code)).toBe(404)
    }
  })

  it('keeps unknown codes fail-closed as 503', () => {
    expect(statusCodeForMNetError('network.brand_new_code')).toBe(503)
  })
})
