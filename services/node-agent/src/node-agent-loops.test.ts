import { describe, expect, it } from 'bun:test'
import { createNodeAgentLoops } from './node-agent-loops.ts'

function createFakeTimers() {
  const intervals: Array<{ fn: () => void; ms: number; id: number }> = []
  let nextId = 1
  const realSetInterval = globalThis.setInterval
  const realClearInterval = globalThis.clearInterval
  globalThis.setInterval = ((fn: () => void, ms: number) => {
    const entry = { fn, ms, id: nextId++ }
    intervals.push(entry)
    return entry.id
  }) as unknown as typeof globalThis.setInterval
  globalThis.clearInterval = ((id: number) => {
    const index = intervals.findIndex(entry => entry.id === id)
    if (index >= 0) intervals.splice(index, 1)
  }) as unknown as typeof globalThis.clearInterval
  return {
    intervals,
    last: () => {
      const entry = intervals[intervals.length - 1]
      if (!entry) throw new Error('no interval was installed')
      return entry
    },
    restore: () => {
      globalThis.setInterval = realSetInterval
      globalThis.clearInterval = realClearInterval
    }
  }
}

describe('createNodeAgentLoops', () => {
  it('keeps the heartbeat timer installed but silent until a session exists, then self-heals', () => {
    const timers = createFakeTimers()
    try {
      const frames: unknown[] = []
      let hasSession = false
      const loops = createNodeAgentLoops({
        sendFrame: frame => frames.push(frame),
        heartbeatFrame: () => ({ type: 'heartbeat' }),
        hasSession: () => hasSession,
        reconcile: async () => {},
        heartbeatIntervalMs: () => 1000,
        syncIntervalMs: () => 1000
      })
      loops.startHeartbeat()
      const timer = timers.last()
      timer.fn()
      expect(frames).toHaveLength(0)
      // session 出现后同一个 timer 自动恢复发帧：guard 不允许把定时器永久丢弃。
      hasSession = true
      timer.fn()
      expect(frames).toEqual([{ type: 'heartbeat' }])
      loops.stopHeartbeat()
      expect(timers.intervals).toHaveLength(0)
    } finally {
      timers.restore()
    }
  })

  it('deduplicates concurrent runtime sync runs and logs failures without throwing', async () => {
    const inFlightReleases: Array<() => void> = []
    let reconcileCalls = 0
    const loops = createNodeAgentLoops({
      sendFrame: () => {},
      heartbeatFrame: () => ({}),
      hasSession: () => true,
      reconcile: () => {
        reconcileCalls += 1
        if (reconcileCalls === 1) {
          return new Promise<void>(resolve => inFlightReleases.push(resolve))
        }
        return Promise.reject(new Error('sync boom'))
      },
      heartbeatIntervalMs: () => 1000,
      syncIntervalMs: () => 1000
    })

    loops.triggerRuntimeSync('join')
    loops.triggerRuntimeSync('poll')
    expect(reconcileCalls).toBe(1)
    const release = inFlightReleases[0]
    if (!release) throw new Error('reconcile never registered its release hook')
    release()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(reconcileCalls).toBe(1)

    loops.triggerRuntimeSync('poll')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(reconcileCalls).toBe(2)
  })
})
