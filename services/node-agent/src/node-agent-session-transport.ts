/**
 * WebSocket session transport：统一承载 join.redeem、session.resume、消息分发与重连回收。
 * 从 index.ts 拆出以守住单文件 500 行预算（MERISTEM-DEV §8.2）；
 * 凭据与 session 事实经 getter 注入，本模块不持有任何 agent 运行态。
 * 这里显式避免把服务端原始错误文本直接打印到 stderr，防止上游 message 意外携带敏感内容。
 */
import type {
  JoinAcceptedMessage,
  SessionResumedMessage,
  SessionTaskExecuteMessage
} from '../../../packages/contracts/src/index.ts'
import { decodeMessage, parseServerMessage } from './node-agent-runtime.ts'

export type SessionTransportHandlers = {
  /** 连接建立时要发送的首帧凭据：有 nodeId+runtimeToken 走 resume，否则兑换 Join Ticket。 */
  credentials(): { joinTicket?: string; nodeId?: string; runtimeToken?: string }
  /** 首连既无 ticket 也无运行凭据：交给调用方做响亮失败（index 走 exitWithError 受控退出）。 */
  onCredentialsMissing(): void
  onAccepted(message: JoinAcceptedMessage | SessionResumedMessage): void
  onTaskExecute(message: SessionTaskExecuteMessage): void
  /** 服务器 error 帧（已确认的凭据终态判定由调用方决定后续动作）。 */
  onServerError(message: { code: string }): void
  sendFrame(frame: unknown): void
  /** 每次 close 前的回收钩子（清心跳/同步环/上报等由调用方负责）。 */
  onClosed(): void
  /** 退避重连入口；stopping 时不再重连由调用方在钩子内自行决定。 */
  scheduleReconnect(): void
}

export type NodeAgentSessionTransport = {
  connect(): void
  close(): void
  /** 仅在 socket OPEN 时发送；帧的语义与 JSON 编码由 transport 统一负责。 */
  send(frame: unknown): void
}

export function createSessionTransport(
  joinUrl: string,
  handlers: SessionTransportHandlers
): NodeAgentSessionTransport {
  let socket: WebSocket | null = null
  let stopping = false

  /** 首连优先兑换 Join Ticket；一旦拿到运行 token，后续所有断线重连都改走 session.resume。 */
  function open(): void {
    const ws = new WebSocket(joinUrl)
    socket = ws

    ws.onopen = () => {
      const { joinTicket, nodeId, runtimeToken } = handlers.credentials()
      if (nodeId && runtimeToken) {
        handlers.sendFrame({ type: 'session.resume', nodeId, token: runtimeToken })
        return
      }
      if (!joinTicket) {
        // 与 HEAD 行为一致：交由调用方 exitWithError 响亮失败并受控退出，不在这里静默降级。
        handlers.onCredentialsMissing()
        return
      }
      handlers.sendFrame({ type: 'join.redeem', ticket: joinTicket })
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
            handlers.onAccepted(message)
            return
          }

          if (message.type === 'task.execute') {
            handlers.onTaskExecute(message)
            return
          }

          if (message.type === 'error') {
            process.stderr.write(`join session rejected with code ${message.code}\n`)
            handlers.onServerError({ code: message.code })
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

    // close 是唯一重连入口：session lease 的清空由调用方回收钩子负责，避免旧 sessionId 继续出现在后续帧里。
    ws.onclose = () => {
      handlers.onClosed()
      if (!stopping) handlers.scheduleReconnect()
    }
  }

  return {
    /**
     * 不变式：调用方（index connect()）负责凭据缺失的响亮失败与受控退出，
     * transport 不重复守卫，避免同一异常出现两个出口。
     * connect 复位 stopping：与 HEAD 单一共享标志语义一致——显式重连意图优先于上次 close()。
     */
    connect() {
      stopping = false
      open()
    },
    close() {
      stopping = true
      socket?.close()
    },
    send(frame: unknown) {
      if (!socket || socket.readyState !== WebSocket.OPEN) return
      socket.send(JSON.stringify(frame))
    }
  }
}
