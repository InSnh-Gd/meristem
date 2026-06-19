import type { ServerWebSocket } from 'bun'
import type {
  MNetSessionClientMessage,
  MNetSessionServerMessage,
  MNetwork,
  MNetworkMember,
  MNode,
  NodeAgentTaskExecuteResponse,
  NodeKind
} from '../../../packages/contracts/src/index.ts'
import { err as resultErr, ok } from '../../../packages/common/src/result.ts'
import type { networks, nodes } from '../../../packages/db/src/schema.ts'
import type { RuntimeNodeSnapshot } from './runtime.ts'
import type { MNetServiceError, MNetServiceResult } from './types.ts'

export type JoinSessionData = {
  nodeId?: string
  sessionId?: string
}

export type PendingTask = {
  nodeId: string
  correlationId: string
  timeout: ReturnType<typeof setTimeout>
  resolve(value: NodeAgentTaskExecuteResponse): void
  reject(error: MNetServiceError): void
}

export { ok }

/**
 * 运行态错误统一保持 `{ code, message }` 形状，便于 internal HTTP、WebSocket 和日志复用。
 */
export function err(code: string, message: string): MNetServiceResult<never> {
  return resultErr({ code, message })
}

export function asNodeKind(value: string): NodeKind | null {
  return value === 'stem' || value === 'leaf' ? value : null
}

export function membershipModeFor(kind: NodeKind): MNetworkMember['membershipMode'] {
  return kind === 'stem' ? 'full' : 'restricted'
}

export function mapNetwork(row: typeof networks.$inferSelect): MNetwork {
  return {
    id: row.id,
    name: row.name,
    profileVersion: row.profileVersion,
    status: 'active',
    createdAt: row.createdAt.toISOString()
  }
}

export function asRuntimeNode(row: typeof nodes.$inferSelect): RuntimeNodeSnapshot {
  return {
    id: row.id,
    mode: row.mode as RuntimeNodeSnapshot['mode'],
    status: row.status as RuntimeNodeSnapshot['status'],
    reachability: row.reachability as RuntimeNodeSnapshot['reachability'],
    ...(row.lastSeenAt ? { lastSeenAt: row.lastSeenAt.toISOString() } : {}),
    ...(row.agentVersion ? { agentVersion: row.agentVersion } : {})
  }
}

export function mapNode(row: typeof nodes.$inferSelect): MNode {
  return {
    id: row.id,
    kind: row.kind as MNode['kind'],
    name: row.name,
    mode: row.mode as MNode['mode'],
    status: row.status as MNode['status'],
    reachability: row.reachability as MNode['reachability'],
    ...(row.lastSeenAt ? { lastSeenAt: row.lastSeenAt.toISOString() } : {}),
    ...(row.agentVersion ? { agentVersion: row.agentVersion } : {}),
    capabilities: Array.isArray(row.capabilities) ? row.capabilities.map(String) : [],
    createdAt: row.createdAt.toISOString()
  }
}

/**
 * 从 WebSocket 原始帧解出版本化 session 消息；解析失败时调用方必须回 error frame，而不是静默忽略。
 */
export function parseClientMessage(raw: string): MNetSessionClientMessage | null {
  try {
    const parsed = JSON.parse(raw) as MNetSessionClientMessage
    return typeof parsed === 'object' && parsed !== null && typeof parsed.type === 'string'
      ? parsed
      : null
  } catch {
    return null
  }
}

/**
 * Bun WebSocket message 可能是 string、ArrayBuffer 或 Blob，这里统一归一化成 JSON 文本。
 */
export function messageText(message: string | ArrayBuffer | ArrayBufferView): string {
  if (typeof message === 'string') return message
  return new TextDecoder().decode(
    message instanceof ArrayBuffer
      ? new Uint8Array(message)
      : new Uint8Array(message.buffer, message.byteOffset, message.byteLength)
  )
}

/**
 * 所有服务端帧都从单一点发送，避免 join/session/task 三类消息在不同分支里漂移字段形状。
 */
export function sendServerMessage(
  ws: ServerWebSocket<JoinSessionData>,
  message: MNetSessionServerMessage
): void {
  ws.send(JSON.stringify(message))
}
