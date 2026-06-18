import { describe, expect, it } from 'bun:test'
import {
  calculateDropPolicy,
  createLogBuffer,
  formatLogForward,
  formatTaskResult,
  type LogEntry,
  type TaskResultOutcome
} from '../../services/node-agent/src/node-agent-task-log.ts'

function createLogEntry(message: string, timestamp: string): LogEntry {
  return {
    timestamp,
    level: 'info',
    source: 'node-agent',
    message
  }
}

describe('node-agent task.result contract', () => {
  it('formats a completed task result with outcome, duration, and metadata', () => {
    const outcome: TaskResultOutcome = {
      kind: 'completed',
      completedAt: '2026-06-18T10:00:05.000Z'
    }

    expect(
      formatTaskResult('task-log-entry-demo', outcome, 5000, {
        nodeId: 'node-1',
        correlationId: 'corr-1'
      })
    ).toEqual({
      type: 'task.result',
      taskId: 'task-log-entry-demo',
      outcome: {
        kind: 'completed',
        completedAt: '2026-06-18T10:00:05.000Z'
      },
      durationMs: 5000,
      metadata: {
        nodeId: 'node-1',
        correlationId: 'corr-1'
      }
    })
  })

  it('formats a failed task result with a typed failure reason', () => {
    const outcome: TaskResultOutcome = {
      kind: 'failed',
      failedAt: '2026-06-18T10:00:05.000Z',
      reason: {
        code: 'task.runtime_error',
        message: 'command exited with code 2',
        retriable: true
      }
    }

    const message = formatTaskResult('task-log-alternate', outcome, 1200, {
      nodeId: 'node-1'
    })

    expect(message.type).toBe('task.result')
    expect(message.durationMs).toBe(1200)
    expect(message.outcome.kind).toBe('failed')
    if (message.outcome.kind !== 'failed') throw new Error('expected failed outcome')
    expect(message.outcome.reason.code).toBe('task.runtime_error')
    expect(message.outcome.reason.retriable).toBe(true)
    expect(message.metadata).toEqual({ nodeId: 'node-1' })
  })
})

describe('node-agent log.forward contract', () => {
  it('formats a structured log batch for log.forward', () => {
    const first = createLogEntry('node ready', '2026-06-18T10:00:00.000Z')
    const second = {
      ...createLogEntry('noop task completed', '2026-06-18T10:00:01.000Z'),
      correlationId: 'corr-1',
      payload: { taskId: 'task-log-entry-demo' }
    } satisfies LogEntry

    expect(formatLogForward([first, second])).toEqual({
      type: 'log.forward',
      entries: [first, second],
      counters: {
        'log.dropped': 0
      }
    })
  })

  it('flushes when the buffer reaches the threshold or the timer window elapses', () => {
    let now = 0
    const thresholdBuffer = createLogBuffer(3, 5000, () => now)

    thresholdBuffer.add(createLogEntry('one', '2026-06-18T10:00:00.000Z'))
    thresholdBuffer.add(createLogEntry('two', '2026-06-18T10:00:01.000Z'))
    expect(thresholdBuffer.shouldFlush()).toEqual({
      kind: 'idle',
      entries: 2,
      nextFlushInMs: 5000,
      reason: 'waiting'
    })

    thresholdBuffer.add(createLogEntry('three', '2026-06-18T10:00:02.000Z'))
    expect(thresholdBuffer.shouldFlush()).toEqual({
      kind: 'ready',
      entries: 3,
      reason: 'threshold'
    })

    const thresholdFlush = thresholdBuffer.flush()
    expect(thresholdFlush.kind).toBe('ready')
    if (thresholdFlush.kind !== 'ready') throw new Error('expected threshold flush')
    expect(thresholdFlush.message.entries.map(entry => entry.message)).toEqual([
      'one',
      'two',
      'three'
    ])
    thresholdBuffer.acknowledge(thresholdFlush.message.entries.length)
    expect(thresholdBuffer.buffer).toEqual([])

    const timerBuffer = createLogBuffer(10, 5000, () => now)
    timerBuffer.add(createLogEntry('later', '2026-06-18T10:00:03.000Z'))
    now = 5001

    expect(timerBuffer.shouldFlush()).toEqual({
      kind: 'ready',
      entries: 1,
      reason: 'interval'
    })
  })

  it('retains buffered logs for retry when a send attempt fails', () => {
    let now = 0
    const buffer = createLogBuffer(5, 5000, () => now)
    const entry = createLogEntry('retry me', '2026-06-18T10:00:00.000Z')

    buffer.add(entry)
    now = 5001

    const firstAttempt = buffer.flush()
    expect(firstAttempt.kind).toBe('ready')
    if (firstAttempt.kind !== 'ready') throw new Error('expected first flush attempt')
    expect(firstAttempt.message.entries).toEqual([entry])

    const retryAttempt = buffer.flush()
    expect(retryAttempt.kind).toBe('ready')
    if (retryAttempt.kind !== 'ready') throw new Error('expected retry flush attempt')
    expect(retryAttempt.message.entries).toEqual([entry])
    expect(buffer.buffer).toEqual([entry])
  })

  it('drops the oldest logs on overflow and exposes the log.dropped counter', () => {
    const retained = calculateDropPolicy(
      [
        createLogEntry('oldest', '2026-06-18T10:00:00.000Z'),
        createLogEntry('middle', '2026-06-18T10:00:01.000Z'),
        createLogEntry('newest', '2026-06-18T10:00:02.000Z')
      ],
      2
    )

    expect(retained.dropped).toBe(1)
    expect(retained.retained.map(entry => entry.message)).toEqual(['middle', 'newest'])

    let now = 0
    const buffer = createLogBuffer(2, 5000, () => now)
    buffer.add(createLogEntry('oldest', '2026-06-18T10:00:00.000Z'))
    buffer.add(createLogEntry('middle', '2026-06-18T10:00:01.000Z'))
    buffer.add(createLogEntry('newest', '2026-06-18T10:00:02.000Z'))
    now = 5001

    const flushResult = buffer.flush()
    expect(flushResult.kind).toBe('ready')
    if (flushResult.kind !== 'ready') throw new Error('expected overflow flush')
    expect(flushResult.message.entries.map(entry => entry.message)).toEqual(['middle', 'newest'])
    expect(flushResult.message.counters['log.dropped']).toBe(1)
  })
})
