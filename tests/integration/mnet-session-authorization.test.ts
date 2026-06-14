import { describe, expect, it } from 'bun:test'
import {
  authorizeSessionMessage,
  joinTicketRedeemability
} from '../../services/m-net/src/runtime.ts'

describe('M-Net session authorization', () => {
  it('rejects runtime messages before the session has authenticated', () => {
    expect(authorizeSessionMessage(null, null, undefined)).toEqual({
      ok: false,
      code: 'session.unauthenticated',
      message: 'session has not been authenticated'
    })
  })

  it('rejects superseded connections even if they still carry a node id', () => {
    expect(authorizeSessionMessage('node-1', 'session-old', 'session-new')).toEqual({
      ok: false,
      code: 'session.superseded',
      message: 'session has been superseded by a newer connection'
    })
  })

  it('accepts messages from the current active session only', () => {
    expect(authorizeSessionMessage('node-1', 'session-current', 'session-current')).toEqual({
      ok: true,
      nodeId: 'node-1'
    })
  })
})

describe('M-Net join ticket rejection semantics', () => {
  it('treats revoked tickets as stable non-redeemable outcomes', () => {
    expect(
      joinTicketRedeemability(
        {
          status: 'revoked',
          expiresAt: '2026-05-10T00:01:00.000Z'
        },
        new Date('2026-05-10T00:00:00.000Z')
      )
    ).toBe('revoked')
  })
})
