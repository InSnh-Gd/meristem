import { describe, expect, it } from 'bun:test'
import {
  deriveNodeControlTransition,
  isHeartbeatSuppressedByNodeControl,
  isNodeExcludedFromPeerPaths,
  isOfflineTransitionSuppressedByNodeControl
} from '../../services/m-net/src/node-control-state-machine.ts'

describe('M-Net node control state machine', () => {
  it('allows active runtime states to enter disabled or isolated', () => {
    expect(deriveNodeControlTransition('healthy', 'disable')).toEqual({
      ok: true,
      nextStatus: 'disabled'
    })
    expect(deriveNodeControlTransition('degraded', 'isolate')).toEqual({
      ok: true,
      nextStatus: 'isolated'
    })
    expect(deriveNodeControlTransition('offline', 'disable')).toEqual({
      ok: true,
      nextStatus: 'disabled'
    })
  })

  it('allows recover only from disabled or isolated', () => {
    expect(deriveNodeControlTransition('disabled', 'recover')).toEqual({
      ok: true,
      nextStatus: 'recovering'
    })
    expect(deriveNodeControlTransition('isolated', 'recover')).toEqual({
      ok: true,
      nextStatus: 'recovering'
    })
    expect(deriveNodeControlTransition('healthy', 'recover')).toEqual({
      ok: false,
      code: 'node.control.invalid_transition',
      message: 'cannot recover node from healthy'
    })
  })

  it('suppresses heartbeat and peer-path restoration while administrative control is active', () => {
    expect(isHeartbeatSuppressedByNodeControl('disabled')).toBe(true)
    expect(isHeartbeatSuppressedByNodeControl('isolated')).toBe(true)
    expect(isHeartbeatSuppressedByNodeControl('recovering')).toBe(false)

    expect(isOfflineTransitionSuppressedByNodeControl('disabled')).toBe(true)
    expect(isOfflineTransitionSuppressedByNodeControl('isolated')).toBe(true)
    expect(isOfflineTransitionSuppressedByNodeControl('recovering')).toBe(true)

    expect(isNodeExcludedFromPeerPaths('disabled')).toBe(true)
    expect(isNodeExcludedFromPeerPaths('isolated')).toBe(true)
    expect(isNodeExcludedFromPeerPaths('recovering')).toBe(true)
    expect(isNodeExcludedFromPeerPaths('healthy')).toBe(false)
  })
})
