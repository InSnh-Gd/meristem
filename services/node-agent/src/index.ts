import type {
  JoinAcceptedMessage,
  MNetSessionServerMessage,
  SessionResumedMessage,
  SessionTaskExecuteMessage
} from '../../../packages/contracts/src/index.ts'
import {
  currentTraceId,
  initTelemetry,
  shutdownTelemetry
} from '../../../packages/telemetry/src/index.ts'

function requiredOneOf(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]
    if (value) return value
  }
  return undefined
}

/**
 * 节点心跳间隔必须收敛成正整数，避免错误配置让 agent 静默停发心跳或过度轰炸 join ingress。
 */
function heartbeatIntervalMs(): number {
  const value = Number(process.env.MERISTEM_AGENT_HEARTBEAT_INTERVAL_MS ?? '5000')
  return Number.isFinite(value) && value > 0 ? value : 5000
}

/**
 * Join ingress 回来的 WebSocket 帧统一先解成文本，再进入版本化 session 消息解析。
 */
function decodeMessage(data: string | ArrayBuffer | Blob): Promise<string> | string {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data))
  return data.text()
}

/**
 * 只接受带 `type` 的 M-Net session server 消息，避免 agent 在不明消息形状下继续执行。
 */
function parseServerMessage(raw: string): MNetSessionServerMessage | null {
  try {
    const parsed = JSON.parse(raw) as MNetSessionServerMessage
    return typeof parsed === 'object' && parsed !== null && typeof parsed.type === 'string'
      ? parsed
      : null
  } catch {
    return null
  }
}

const agentVersion = process.env.MERISTEM_AGENT_VERSION ?? '0.1.0'
const joinUrl = process.env.MERISTEM_JOIN_URL ?? 'wss://localhost:8443/join/v0/session'

let joinTicket = requiredOneOf(['MERISTEM_JOIN_TICKET'])
let nodeId = process.env.MERISTEM_NODE_ID
let runtimeToken = process.env.MERISTEM_NODE_TOKEN
let currentSessionId: string | null = null
let socket: WebSocket | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let stopping = false

initTelemetry('node-agent')

function sendFrame(frame: unknown): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return
  socket.send(JSON.stringify(frame))
}

/**
 * agent 侧所有运行日志都通过 `log.forward` 回送 M-Net，由 M-Net 负责补全节点身份并落库。
 */
function forwardLog(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  correlationId?: string,
  payload?: unknown
): void {
  const traceId = currentTraceId()
  if (!currentSessionId) return
  sendFrame({
    type: 'log.forward',
    sessionId: currentSessionId,
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(correlationId ? { correlationId } : {}),
    ...(traceId ? { traceId } : {}),
    ...(payload === undefined ? {} : { payload })
  })
}

/**
 * join.accepted / session.resumed 之后才开始发心跳，避免未认证连接提前污染节点运行态。
 */
function startHeartbeat(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  heartbeatTimer = setInterval(() => {
    if (!currentSessionId) return
    sendFrame({
      type: 'heartbeat',
      sessionId: currentSessionId,
      agentVersion,
      reportedStatus: 'healthy',
      timestamp: new Date().toISOString()
    })
  }, heartbeatIntervalMs())
}

function stopHeartbeat(): void {
  if (!heartbeatTimer) return
  clearInterval(heartbeatTimer)
  heartbeatTimer = null
}

function exitWithError(message: string): never {
  process.stderr.write(`${message}\n`)
  stopping = true
  stopHeartbeat()
  void shutdownTelemetry().then(() => process.exit(1))
  throw new Error(message)
}

/**
 * join.accepted 会回传新的运行 token；resume 只恢复既有 token 对应的活动 session。
 * 依据 docs/services/node-agent.md §4，运行 token 只能进入内存与后续 resume，不得出现在 stdout。
 */
function handleAccepted(message: JoinAcceptedMessage | SessionResumedMessage): void {
  nodeId = message.node.id
  currentSessionId = message.sessionId
  if (message.type === 'join.accepted') {
    runtimeToken = message.runtimeToken
    joinTicket = undefined
    process.stdout.write(`node-agent joined as ${message.node.id}\n`)
  } else {
    process.stdout.write(`node-agent resumed session for ${message.node.id}\n`)
  }
  startHeartbeat()
  forwardLog(
    'info',
    message.type === 'join.accepted' ? 'node agent joined' : 'node agent resumed',
    undefined,
    {
      nodeId: message.node.id,
      mode: message.node.mode
    }
  )
}

/**
 * 当前 agent 只执行 noop；任何其他 taskType 都必须显式拒绝并回送日志事实。
 */
function handleTaskExecute(message: SessionTaskExecuteMessage): void {
  if (message.taskType !== 'noop') {
    forwardLog('warn', 'rejected unsupported task execution request', message.correlationId, {
      taskId: message.taskId,
      taskType: message.taskType
    })
    return
  }

  sendFrame({
    type: 'task.result',
    sessionId: currentSessionId,
    taskId: message.taskId,
    result: 'completed',
    completedAt: new Date().toISOString()
  })
  forwardLog('info', `completed noop task ${message.taskId}`, message.correlationId, {
    taskId: message.taskId
  })
}

/**
 * 断线重连保持单一退避入口，避免 onerror / onclose 等多个边界各自复制重连时序。
 */
function scheduleReconnect(): void {
  if (stopping) return
  setTimeout(() => {
    if (!stopping) connect()
  }, 1000)
}

/**
 * WebSocket 边界统一承载 join.redeem、session.resume、消息分发与重连回收。
 * 这里显式避免把服务端原始错误文本直接打印到 stderr，防止上游 message 意外携带敏感内容。
 */
function connect(): void {
  if (!joinTicket && (!nodeId || !runtimeToken)) {
    exitWithError('MERISTEM_JOIN_TICKET or MERISTEM_NODE_ID + MERISTEM_NODE_TOKEN is required')
  }

  const ws = new WebSocket(joinUrl)
  socket = ws

  // 首连优先兑换 Join Ticket；一旦拿到运行 token，后续所有断线重连都改走 session.resume。
  ws.onopen = () => {
    if (nodeId && runtimeToken) {
      sendFrame({
        type: 'session.resume',
        nodeId,
        token: runtimeToken
      })
      return
    }

    if (!joinTicket) {
      exitWithError('MERISTEM_JOIN_TICKET is required for the first join')
    }

    sendFrame({
      type: 'join.redeem',
      ticket: joinTicket
    })
  }

  // 消息处理集中在这一段，避免 join/session/task 三类服务器消息各自散落独立状态机。
  ws.onmessage = event => {
    void Promise.resolve(decodeMessage(event.data))
      .then(raw => {
        const message = parseServerMessage(raw)
        if (!message) {
          process.stderr.write('invalid session message received\n')
          return
        }

        if (message.type === 'join.accepted' || message.type === 'session.resumed') {
          handleAccepted(message)
          return
        }

        if (message.type === 'task.execute') {
          handleTaskExecute(message)
          return
        }

        if (message.type === 'error') {
          process.stderr.write(`join session rejected with code ${message.code}\n`)
          // Join Ticket 首连失败和 resume token 失效都属于“凭据已无效”的终态，继续自动重连只会制造噪音。
          if (
            message.code === 'nodeagent.invalid_token' ||
            (!runtimeToken && message.code.startsWith('node.join_ticket_'))
          ) {
            stopping = true
            ws.close()
          }
        }
      })
      .catch(error => {
        process.stderr.write(
          `failed to process join session message: ${error instanceof Error ? error.name : 'unknown error'}\n`
        )
      })
  }

  // transport error 只作为链路事实输出，不拼接浏览器/WebSocket 栈里的任意原始文本。
  ws.onerror = () => {
    if (!stopping) process.stderr.write('join ingress websocket error\n')
  }

  // close 是唯一重连入口：它同时负责清空当前 session lease，避免旧 sessionId 继续出现在后续帧里。
  ws.onclose = () => {
    stopHeartbeat()
    currentSessionId = null
    if (!stopping) scheduleReconnect()
  }
}

connect()

process.on('SIGINT', () => {
  stopping = true
  stopHeartbeat()
  forwardLog('warn', 'node agent stopping')
  socket?.close()
  void shutdownTelemetry().then(() => process.exit(0))
})
