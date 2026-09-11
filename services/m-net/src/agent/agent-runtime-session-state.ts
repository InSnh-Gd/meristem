import type { ServerWebSocket } from 'bun'
import type { JoinSessionData } from '../shared.ts'

/** 读取 session 已绑定的节点标识；未绑定时显式返回 null。 */
export function sessionNodeId(ws: ServerWebSocket<JoinSessionData>): string | null {
  return typeof ws.data.nodeId === 'string' ? ws.data.nodeId : null
}

/** 读取 session 已绑定的会话标识；未绑定时显式返回 null。 */
export function sessionId(ws: ServerWebSocket<JoinSessionData>): string | null {
  return typeof ws.data.sessionId === 'string' ? ws.data.sessionId : null
}

/** 每个 Agent 节点仅保留一个活跃 session，并关闭被替换的旧连接。 */
export function bindSession<
  TSocket extends Pick<ServerWebSocket<JoinSessionData>, 'data' | 'close'>
>(
  context: {
    activeSessions: Map<string, TSocket>
    activeSessionIds: Map<string, string>
  },
  ws: TSocket,
  nodeId: string
): string {
  const previous = context.activeSessions.get(nodeId)
  const nextSessionId = crypto.randomUUID()
  ws.data.nodeId = nodeId
  ws.data.sessionId = nextSessionId
  context.activeSessions.set(nodeId, ws)
  context.activeSessionIds.set(nodeId, nextSessionId)
  if (previous && previous !== ws) previous.close(4001, 'superseded')
  return nextSessionId
}
