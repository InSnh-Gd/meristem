import { describe, expect, it } from 'bun:test'
import {
  deriveHeartbeatTransition,
  shouldTransitionOffline,
  shouldTransitionOfflineOnDisconnect
} from '../../services/m-net/src/runtime.ts'

describe('M-Net runtime state machine', () => {
  it('does not emit extra status or reachability noise for repeated healthy heartbeats', () => {
    const transition = deriveHeartbeatTransition(
      {
        id: 'node-1',
        mode: 'agent',
        status: 'healthy',
        reachability: 'reachable',
        lastSeenAt: '2026-05-10T00:00:00.000Z',
        agentVersion: '0.1.0'
      },
      {
        type: 'heartbeat',
        sessionId: 'session-1',
        agentVersion: '0.1.0',
        reportedStatus: 'healthy',
        timestamp: '2026-05-10T00:00:05.000Z'
      }
    )

    expect(transition.statusChanged).toBe(false)
    expect(transition.reachabilityChanged).toBe(false)
    expect(transition.nextLastSeenAt).toBe('2026-05-10T00:00:05.000Z')
  })

  it('uses heartbeat observations to close recovering nodes into runtime status', () => {
    const healthyTransition = deriveHeartbeatTransition(
      {
        id: 'recovering-node-1',
        mode: 'agent',
        status: 'recovering',
        reachability: 'unreachable',
        lastSeenAt: '2026-05-10T00:00:00.000Z',
        agentVersion: '0.1.0'
      },
      {
        type: 'heartbeat',
        sessionId: 'session-1',
        agentVersion: '0.2.0',
        reportedStatus: 'healthy',
        timestamp: '2026-05-10T00:00:05.000Z'
      }
    )
    const degradedTransition = deriveHeartbeatTransition(
      {
        id: 'recovering-node-2',
        mode: 'agent',
        status: 'recovering',
        reachability: 'reachable',
        lastSeenAt: '2026-05-10T00:00:00.000Z',
        agentVersion: '0.1.0'
      },
      {
        type: 'heartbeat',
        sessionId: 'session-2',
        agentVersion: '0.2.0',
        reportedStatus: 'degraded',
        timestamp: '2026-05-10T00:00:05.000Z'
      }
    )

    expect(healthyTransition.nextStatus).toBe('healthy')
    expect(healthyTransition.nextReachability).toBe('reachable')
    expect(healthyTransition.statusChanged).toBe(true)
    expect(healthyTransition.reachabilityChanged).toBe(true)
    expect(degradedTransition.nextStatus).toBe('degraded')
    expect(degradedTransition.statusChanged).toBe(true)
    expect(degradedTransition.reachabilityChanged).toBe(false)
  })

  it('allows timeout-based offline sweep only for stale reachable agent nodes', () => {
    expect(
      shouldTransitionOffline(
        {
          id: 'node-1',
          mode: 'agent',
          status: 'healthy',
          reachability: 'reachable',
          lastSeenAt: '2026-05-10T00:00:00.000Z'
        },
        new Date('2026-05-10T00:00:20.000Z'),
        15_000
      )
    ).toBe(true)

    expect(
      shouldTransitionOffline(
        {
          id: 'node-2',
          mode: 'agent',
          status: 'healthy',
          reachability: 'unreachable',
          lastSeenAt: '2026-05-10T00:00:00.000Z'
        },
        new Date('2026-05-10T00:00:20.000Z'),
        15_000
      )
    ).toBe(false)
  })

  it('marks current agent sessions offline on disconnect, including pre-heartbeat joining nodes', () => {
    expect(
      shouldTransitionOfflineOnDisconnect({
        id: 'joining-node',
        mode: 'agent',
        status: 'joining',
        reachability: 'unknown'
      })
    ).toBe(true)

    expect(
      shouldTransitionOfflineOnDisconnect({
        id: 'simulated-node',
        mode: 'simulated',
        status: 'healthy',
        reachability: 'reachable'
      })
    ).toBe(false)

    expect(
      shouldTransitionOfflineOnDisconnect({
        id: 'revoked-node',
        mode: 'agent',
        status: 'revoked',
        reachability: 'unreachable'
      })
    ).toBe(false)
  })
})
