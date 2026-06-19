import { describe, expect, it } from 'bun:test'
import {
  buildJoinSessionUrl,
  deriveHeartbeatTransition,
  joinTicketRedeemability,
  shouldTransitionOffline
} from '../../services/m-net/src/runtime.ts'
import { err, ok } from '../../packages/common/src/result.ts'

function claimJoinTicketWinner(input: {
  latestStatus: 'active' | 'redeemed' | 'expired' | 'revoked' | undefined
  latestRedeemedNodeId: string | null | undefined
  expectedNodeId: string
}) {
  if (input.latestStatus !== 'redeemed') {
    if (input.latestStatus === 'expired') {
      return err({ code: 'node.join_ticket_expired', message: 'join ticket is expired' })
    }
    if (input.latestStatus === 'revoked') {
      return err({ code: 'node.join_ticket_revoked', message: 'join ticket has been revoked' })
    }
    return err({ code: 'node.join_ticket_invalid', message: 'join ticket is invalid' })
  }

  return input.latestRedeemedNodeId === input.expectedNodeId
    ? ok('claimed')
    : err({ code: 'node.join_ticket_redeemed', message: 'join ticket has already been redeemed' })
}

describe('M-Net node-agent runtime helpers', () => {
  it('promotes reachable agent nodes from joining to healthy on heartbeat', () => {
    const transition = deriveHeartbeatTransition(
      {
        id: 'node-1',
        mode: 'agent',
        status: 'joining',
        reachability: 'unknown'
      },
      {
        type: 'heartbeat',
        sessionId: 'session-1',
        agentVersion: '0.1.0',
        reportedStatus: 'healthy',
        timestamp: '2026-05-05T12:00:00.000Z'
      }
    )

    expect(transition.nextStatus).toBe('healthy')
    expect(transition.nextReachability).toBe('reachable')
    expect(transition.statusChanged).toBe(true)
    expect(transition.reachabilityChanged).toBe(true)
  })

  it('marks stale reachable agent nodes offline after the timeout window', () => {
    expect(
      shouldTransitionOffline(
        {
          id: 'node-1',
          mode: 'agent',
          status: 'healthy',
          reachability: 'reachable',
          lastSeenAt: '2026-05-05T11:59:30.000Z'
        },
        new Date('2026-05-05T12:00:00.000Z'),
        20_000
      )
    ).toBe(true)

    expect(
      shouldTransitionOffline(
        {
          id: 'node-1',
          mode: 'agent',
          status: 'healthy',
          reachability: 'reachable',
          lastSeenAt: '2026-05-05T11:59:50.000Z'
        },
        new Date('2026-05-05T12:00:00.000Z'),
        20_000
      )
    ).toBe(false)
  })

  it('derives the public join session url from the configured join ingress base url', () => {
    expect(buildJoinSessionUrl('https://45.204.206.45:8443')).toBe(
      'wss://45.204.206.45:8443/join/v0/session'
    )
    expect(buildJoinSessionUrl('http://localhost:8443/base/')).toBe(
      'ws://localhost:8443/base/join/v0/session'
    )
  })

  it('rejects expired and non-active join tickets before redemption', () => {
    expect(
      joinTicketRedeemability(
        {
          status: 'active',
          expiresAt: '2026-05-05T11:59:59.000Z'
        },
        new Date('2026-05-05T12:00:00.000Z')
      )
    ).toBe('expired')

    expect(
      joinTicketRedeemability(
        {
          status: 'redeemed',
          expiresAt: '2026-05-05T12:01:00.000Z'
        },
        new Date('2026-05-05T12:00:00.000Z')
      )
    ).toBe('redeemed')

    expect(
      joinTicketRedeemability(
        {
          status: 'active',
          expiresAt: '2026-05-05T12:01:00.000Z'
        },
        new Date('2026-05-05T12:00:00.000Z')
      )
    ).toBe('redeemable')
  })

  it('treats redeemed ownership as the stable winner signal for single-use join tickets', () => {
    expect(
      claimJoinTicketWinner({
        latestStatus: 'redeemed',
        latestRedeemedNodeId: 'node-1',
        expectedNodeId: 'node-1'
      })
    ).toEqual(ok('claimed'))

    expect(
      claimJoinTicketWinner({
        latestStatus: 'redeemed',
        latestRedeemedNodeId: 'node-1',
        expectedNodeId: 'node-2'
      })
    ).toEqual(
      err({
        code: 'node.join_ticket_redeemed',
        message: 'join ticket has already been redeemed'
      })
    )
  })
})
