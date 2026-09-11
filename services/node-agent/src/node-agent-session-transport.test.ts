import { afterEach, describe, expect, it } from 'bun:test'
import {
  createSessionTransport,
  type SessionTransportHandlers
} from './node-agent-session-transport.ts'

type FakeSocket = {
  readyState: number
  sent: string[]
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: (() => void) | null
  onclose: (() => void) | null
  close(): void
}

const realWebSocket = globalThis.WebSocket
const OPEN = 1

function socketAt(sockets: FakeSocket[], index: number): FakeSocket {
  const socket = sockets[index]
  if (!socket) throw new Error(`fake socket #${index} was never opened`)
  return socket
}

type SocketCallback = 'onopen' | 'onmessage' | 'onclose'

/** 取（并校验存在）transport 安装的回调；缺失即测试失败而不是静默跳过。 */
function callback(socket: FakeSocket, name: SocketCallback): () => void {
  const handler = socket[name]
  if (!handler) throw new Error(`transport did not install ${name}`)
  return handler as () => void
}

function messageCallback(socket: FakeSocket): (event: { data: unknown }) => void {
  const handler = socket.onmessage
  if (!handler) throw new Error('transport did not install onmessage')
  return handler
}

function installFakeWebSocket() {
  const sockets: FakeSocket[] = []
  class FakeWebSocket {
    static readonly OPEN = OPEN
    readyState = OPEN
    sent: string[] = []
    onopen: (() => void) | null = null
    onmessage: ((event: { data: unknown }) => void) | null = null
    onerror: (() => void) | null = null
    onclose: (() => void) | null = null
    closed = false
    constructor(_url: string) {
      sockets.push(this as unknown as FakeSocket)
    }
    send(payload: string) {
      this.sent.push(payload)
    }
    close() {
      this.closed = true
    }
  }
  globalThis.WebSocket = FakeWebSocket as unknown as typeof globalThis.WebSocket
  return {
    sockets,
    restore: () => {
      globalThis.WebSocket = realWebSocket
    }
  }
}

function baseHandlers(
  overrides: Partial<SessionTransportHandlers> = {}
): SessionTransportHandlers & { frames: unknown[] } {
  const frames: unknown[] = []
  return {
    frames,
    credentials: () => ({}),
    onCredentialsMissing: () => {},
    onAccepted: () => {},
    onTaskExecute: () => {},
    onServerError: () => {},
    sendFrame: frame => frames.push(frame),
    onClosed: () => {},
    scheduleReconnect: () => {},
    ...overrides
  }
}

describe('createSessionTransport', () => {
  afterEach(() => {
    globalThis.WebSocket = realWebSocket
  })

  it('redeems the join ticket on the first open and resumes once credentials exist', () => {
    const fake = installFakeWebSocket()
    try {
      let credentials: { joinTicket?: string; nodeId?: string; runtimeToken?: string } = {
        joinTicket: 'ticket-1'
      }
      const handlers = baseHandlers({ credentials: () => credentials })
      const transport = createSessionTransport('wss://join.test/join/v0/session', handlers)
      transport.connect()
      callback(socketAt(fake.sockets, 0), 'onopen')()
      expect(handlers.frames).toEqual([{ type: 'join.redeem', ticket: 'ticket-1' }])

      credentials = { nodeId: 'node-1', runtimeToken: 'rt-1' }
      transport.connect()
      callback(socketAt(fake.sockets, 1), 'onopen')()
      expect(handlers.frames).toEqual([
        { type: 'join.redeem', ticket: 'ticket-1' },
        { type: 'session.resume', nodeId: 'node-1', token: 'rt-1' }
      ])
    } finally {
      fake.restore()
    }
  })

  it('routes credential-missing first opens to the loud-failure handler instead of sending', () => {
    const fake = installFakeWebSocket()
    try {
      let called = 0
      const handlers = baseHandlers({ onCredentialsMissing: () => (called += 1) })
      const transport = createSessionTransport('wss://join.test/join/v0/session', handlers)
      transport.connect()
      callback(socketAt(fake.sockets, 0), 'onopen')()
      expect(called).toBe(1)
      expect(handlers.frames).toHaveLength(0)
    } finally {
      fake.restore()
    }
  })

  it('routes task.execute frames to onTaskExecute', async () => {
    const fake = installFakeWebSocket()
    try {
      let executed = 0
      const handlers = baseHandlers({ onTaskExecute: () => (executed += 1) })
      const transport = createSessionTransport('wss://join.test/join/v0/session', handlers)
      transport.connect()
      messageCallback(socketAt(fake.sockets, 0))({
        data: JSON.stringify({
          type: 'task.execute',
          nodeId: 'node-1',
          taskId: 'task-1',
          taskType: 'noop',
          correlationId: 'corr-1'
        })
      })
      // 消息分发是 Promise 链（decode → parse → dispatch），让微任务队列跑完再断言。
      for (let tick = 0; tick < 5; tick += 1) await Promise.resolve()
      expect(executed).toBe(1)
    } finally {
      fake.restore()
    }
  })

  it('invokes onClosed then scheduleReconnect on close, and stops reconnecting after close()', () => {
    const fake = installFakeWebSocket()
    try {
      const events: string[] = []
      const handlers = baseHandlers({
        onClosed: () => events.push('closed'),
        scheduleReconnect: () => events.push('reconnect')
      })
      const transport = createSessionTransport('wss://join.test/join/v0/session', handlers)
      transport.connect()
      const socket = socketAt(fake.sockets, 0)
      callback(socket, 'onclose')()
      expect(events).toEqual(['closed', 'reconnect'])

      events.length = 0
      transport.close()
      callback(socket, 'onclose')()
      expect(events).toEqual(['closed'])
    } finally {
      fake.restore()
    }
  })

  it('treats an explicit connect() after close() as a fresh lifecycle that reconnects again', () => {
    const fake = installFakeWebSocket()
    try {
      const events: string[] = []
      const handlers = baseHandlers({
        credentials: () => ({ joinTicket: 'ticket-late' }),
        onClosed: () => events.push('closed'),
        scheduleReconnect: () => events.push('reconnect')
      })
      const transport = createSessionTransport('wss://join.test/join/v0/session', handlers)
      transport.connect()
      transport.close()
      // connect() 复位 stopping：显式重连意图优先于上次 close()；不变式——
      // 当前 index 装配中 SIGINT 终态不会再走到这里（stopping 双标志同源置位）。
      transport.connect()
      callback(socketAt(fake.sockets, 1), 'onopen')()
      callback(socketAt(fake.sockets, 1), 'onclose')()
      expect(events).toEqual(['closed', 'reconnect'])
    } finally {
      fake.restore()
    }
  })
})
