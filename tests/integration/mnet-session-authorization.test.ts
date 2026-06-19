import type { ServerWebSocket } from 'bun'
import { describe, expect, it } from 'bun:test'
import {
  authorizeSessionMessage,
  joinTicketRedeemability
} from '../../services/m-net/src/runtime.ts'
import { bindSession } from '../../services/m-net/src/agent-runtime-session-lifecycle.ts'
import type { JoinSessionData } from '../../services/m-net/src/shared.ts'

type BindableSocket = Pick<ServerWebSocket<JoinSessionData>, 'data' | 'close'> & {
  closeCalls: Array<{ code: number | undefined; reason: string | undefined }>
}

function createBindableSocket(): BindableSocket {
  const closeCalls: BindableSocket['closeCalls'] = []
  return {
    data: {},
    close(code?: number, reason?: string) {
      closeCalls.push({ code, reason })
    },
    closeCalls
  }
}

describe('M-Net session authorization', () => {
  it('treats a newly bound socket as active and supersedes the previous one', () => {
    const activeSessions = new Map<string, BindableSocket>()
    const activeSessionIds = new Map<string, string>()
    const firstSocket = createBindableSocket()
    const secondSocket = createBindableSocket()

    const firstSessionId = bindSession(
      { activeSessions, activeSessionIds },
      firstSocket,
      'node-1'
    )
    const secondSessionId = bindSession(
      { activeSessions, activeSessionIds },
      secondSocket,
      'node-1'
    )

    expect(firstSocket.closeCalls).toEqual([{ code: 4001, reason: 'superseded' }])
    expect(activeSessions.get('node-1')).toBe(secondSocket)
    expect(activeSessionIds.get('node-1')).toBe(secondSessionId)
    expect(secondSessionId).not.toBe(firstSessionId)
    expect(authorizeSessionMessage('node-1', firstSessionId, activeSessionIds.get('node-1'))).toEqual({
      ok: false,
      code: 'session.superseded',
      message: 'session has been superseded by a newer connection'
    })
    expect(
      authorizeSessionMessage('node-1', secondSessionId, activeSessionIds.get('node-1'))
    ).toEqual({ ok: true, nodeId: 'node-1' })
  })

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
