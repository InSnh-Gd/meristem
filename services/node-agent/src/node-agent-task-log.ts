import type { FullLog } from '../../../packages/contracts/src/index.ts'

export type LogEntry = Pick<
  FullLog,
  'timestamp' | 'level' | 'source' | 'message' | 'correlationId' | 'traceId' | 'payload'
>

export type TaskFailureReason = {
  code: string
  message: string
  retriable: boolean
}

export type TaskResultOutcome =
  | {
      kind: 'completed'
      completedAt: string
    }
  | {
      kind: 'failed'
      failedAt: string
      reason: TaskFailureReason
    }

export type TaskResultMetadata = {
  nodeId?: string
  correlationId?: string
  traceId?: string
  payload?: unknown
}

export type TaskResultMessage = {
  type: 'task.result'
  taskId: string
  outcome: TaskResultOutcome
  durationMs: number
  metadata: TaskResultMetadata
}

export type LogForwardMessage = {
  type: 'log.forward'
  entries: readonly LogEntry[]
  counters: {
    'log.dropped': number
  }
}

export type LogFlushReadiness =
  | {
      kind: 'idle'
      entries: number
      nextFlushInMs: number
      reason: 'empty' | 'waiting'
    }
  | {
      kind: 'ready'
      entries: number
      reason: 'threshold' | 'interval'
    }

export type LogFlushResult =
  | {
      kind: 'empty'
      reason: 'no_entries'
    }
  | {
      kind: 'ready'
      reason: 'threshold' | 'interval'
      message: LogForwardMessage
    }

export type LogBuffer = {
  readonly buffer: readonly LogEntry[]
  add(entry: LogEntry): void
  shouldFlush(): LogFlushReadiness
  flush(): LogFlushResult
  acknowledge(sentCount: number): void
}

type Clock = () => number

function clampDuration(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs < 0) return 0
  return Math.trunc(durationMs)
}

/**
 * 将任务执行结果格式化为纯数据消息，便于运行时在 WebSocket 边界外组装发送帧。
 */
export function formatTaskResult(
  taskId: string,
  outcome: TaskResultOutcome,
  durationMs: number,
  metadata: TaskResultMetadata = {}
): TaskResultMessage {
  return {
    type: 'task.result',
    taskId,
    outcome,
    durationMs: clampDuration(durationMs),
    metadata
  }
}

/**
 * 计算日志缓冲区超限时的保留结果，始终丢弃最旧日志并保留最新日志。
 */
export function calculateDropPolicy(
  entries: readonly LogEntry[],
  maxSize: number
): { dropped: number; retained: readonly LogEntry[] } {
  const normalizedMaxSize = Math.max(0, Math.trunc(maxSize))
  if (entries.length <= normalizedMaxSize) {
    return {
      dropped: 0,
      retained: [...entries]
    }
  }

  const dropped = entries.length - normalizedMaxSize
  return {
    dropped,
    retained: entries.slice(dropped)
  }
}

/**
 * 将一批结构化日志格式化为纯数据批消息，并附带丢弃计数器。
 */
export function formatLogForward(entries: readonly LogEntry[], dropped = 0): LogForwardMessage {
  return {
    type: 'log.forward',
    entries: [...entries],
    counters: {
      'log.dropped': Math.max(0, Math.trunc(dropped))
    }
  }
}

/**
 * 创建仅管理内存态日志缓冲的纯逻辑对象；发送成功与失败由外层运行时决定。
 */
export function createLogBuffer(
  maxSize: number,
  flushIntervalMs: number,
  now: Clock = () => Date.now()
): LogBuffer {
  const normalizedMaxSize = Math.max(1, Math.trunc(maxSize))
  const normalizedFlushIntervalMs = Math.max(1, Math.trunc(flushIntervalMs))

  let buffer: readonly LogEntry[] = []
  let droppedCount = 0
  let firstBufferedAt: number | null = null

  const markBuffered = (): void => {
    if (buffer.length > 0 && firstBufferedAt === null) firstBufferedAt = now()
    if (buffer.length === 0) firstBufferedAt = null
  }

  const readiness = (): LogFlushReadiness => {
    if (buffer.length === 0) {
      return {
        kind: 'idle',
        entries: 0,
        nextFlushInMs: normalizedFlushIntervalMs,
        reason: 'empty'
      }
    }

    if (buffer.length >= normalizedMaxSize) {
      return {
        kind: 'ready',
        entries: buffer.length,
        reason: 'threshold'
      }
    }

    const startedAt = firstBufferedAt ?? now()
    const elapsed = now() - startedAt
    if (elapsed >= normalizedFlushIntervalMs) {
      return {
        kind: 'ready',
        entries: buffer.length,
        reason: 'interval'
      }
    }

    return {
      kind: 'idle',
      entries: buffer.length,
      nextFlushInMs: normalizedFlushIntervalMs - elapsed,
      reason: 'waiting'
    }
  }

  return {
    get buffer() {
      return buffer
    },

    add(entry) {
      const nextEntries = [...buffer, entry]
      const nextState = calculateDropPolicy(nextEntries, normalizedMaxSize)
      buffer = nextState.retained
      droppedCount += nextState.dropped
      markBuffered()
    },

    shouldFlush() {
      return readiness()
    },

    flush() {
      const state = readiness()
      if (state.kind === 'idle') {
        return {
          kind: 'empty',
          reason: 'no_entries'
        }
      }

      return {
        kind: 'ready',
        reason: state.reason,
        message: formatLogForward(buffer, droppedCount)
      }
    },

    acknowledge(sentCount) {
      const normalizedSentCount = Math.max(0, Math.trunc(sentCount))
      buffer = buffer.slice(normalizedSentCount)
      if (normalizedSentCount > 0) droppedCount = 0
      markBuffered()
    }
  }
}
