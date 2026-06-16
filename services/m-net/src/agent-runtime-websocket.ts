import {
  applyHeartbeat,
  bindSession,
  forwardLog,
  redeemJoinTicket,
  resumeSession,
  sessionId,
  sessionNodeId,
  transitionNodeOffline
} from './agent-runtime-session-lifecycle.ts'
import {
  rejectPendingTasksForNode,
  resolvePendingTaskResult
} from './agent-runtime-task-dispatch.ts'
import type { AgentRuntimeContext } from './agent-runtime-types.ts'
import { joinIngressPort, joinTlsConfig } from './config.ts'
import { authorizeSessionMessage } from './runtime.ts'
import type { JoinSessionData } from './shared.ts'
import { messageText, parseClientMessage, sendServerMessage } from './shared.ts'

/**
 * WebSocket ingress 只承载 session 协议装配：具体的 join、resume、heartbeat、task 逻辑全部委托给子模块。
 */
export async function createJoinIngress(context: AgentRuntimeContext) {
  return Bun.serve<JoinSessionData>({
    hostname: '0.0.0.0',
    port: joinIngressPort(),
    tls: await joinTlsConfig(),
    fetch(request, server) {
      const url = new URL(request.url)
      if (url.pathname === '/join/v0/health') {
        return Response.json({ ok: true, service: 'm-net-join-ingress' })
      }
      if (url.pathname === '/join/v0/session') {
        const upgraded = server.upgrade(request, { data: {} })
        return upgraded
          ? undefined
          : new Response(
              JSON.stringify({
                error: {
                  code: 'join.upgrade_required',
                  message: 'websocket upgrade required'
                }
              }),
              {
                status: 426,
                headers: { 'content-type': 'application/json' }
              }
            )
      }
      return new Response('not found', { status: 404 })
    },
    websocket: {
      /**
       * WebSocket 消息处理显式区分 join、resume、heartbeat、log.forward 和 task.result，
       * 保证公网边界承载的是 M-Net session 协议，而不是内部 RPC 语义透传。
       */
      async message(ws, rawMessage) {
        const message = parseClientMessage(messageText(rawMessage))
        if (!message) {
          sendServerMessage(ws, {
            type: 'error',
            code: 'session.invalid_message',
            message: 'invalid session message'
          })
          return
        }

        if (message.type === 'join.redeem') {
          const redeemed = await redeemJoinTicket(context, message)
          if (!redeemed.ok) {
            sendServerMessage(ws, {
              type: 'error',
              code: redeemed.error.code,
              message: redeemed.error.message
            })
            return
          }
          const nextSessionId = bindSession(context, ws, redeemed.value.node.id)
          sendServerMessage(ws, {
            type: 'join.accepted',
            sessionId: nextSessionId,
            node: redeemed.value.node,
            runtimeToken: redeemed.value.runtimeToken,
            issuedAt: redeemed.value.issuedAt
          })
          return
        }

        if (message.type === 'session.resume') {
          const resumed = await resumeSession(context, message)
          if (!resumed.ok) {
            sendServerMessage(ws, {
              type: 'error',
              code: resumed.error.code,
              message: resumed.error.message
            })
            return
          }
          const nextSessionId = bindSession(context, ws, resumed.value.id)
          sendServerMessage(ws, {
            type: 'session.resumed',
            sessionId: nextSessionId,
            node: resumed.value
          })
          return
        }

        const authenticatedNodeId = sessionNodeId(ws)
        const sessionAuth = authorizeSessionMessage(
          authenticatedNodeId,
          'sessionId' in message ? message.sessionId : undefined,
          authenticatedNodeId ? context.activeSessionIds.get(authenticatedNodeId) : undefined
        )
        if (!sessionAuth.ok) {
          sendServerMessage(ws, {
            type: 'error',
            code: sessionAuth.code,
            message: sessionAuth.message
          })
          return
        }

        if (message.type === 'heartbeat') {
          const heartbeatApplied = await applyHeartbeat(context, sessionAuth.nodeId, message)
          if (!heartbeatApplied.ok) {
            sendServerMessage(ws, {
              type: 'error',
              code: heartbeatApplied.error.code,
              message: heartbeatApplied.error.message
            })
          }
          return
        }

        if (message.type === 'log.forward') {
          await forwardLog(context, sessionAuth.nodeId, message)
          return
        }

        if (message.type === 'task.result') {
          const resolved = await resolvePendingTaskResult(context, sessionAuth.nodeId, {
            taskId: message.taskId,
            result: message.result,
            completedAt: message.completedAt
          })
          if (!resolved) {
            sendServerMessage(ws, {
              type: 'error',
              code: 'task.not_found',
              message: 'task result does not match an active task'
            })
          }
        }
      },
      close(ws) {
        const nodeId = sessionNodeId(ws)
        if (!nodeId) return
        const currentSessionId = context.activeSessionIds.get(nodeId)
        const closedSessionId = sessionId(ws)
        if (closedSessionId && currentSessionId === closedSessionId) {
          context.activeSessionIds.delete(nodeId)
          context.activeSessions.delete(nodeId)
          rejectPendingTasksForNode(context, nodeId, {
            code: 'node.unreachable',
            message: 'node session disconnected'
          })
          void transitionNodeOffline(context, nodeId, 'session_disconnected')
        }
      }
    }
  })
}
