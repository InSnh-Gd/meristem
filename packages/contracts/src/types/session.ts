import type { NodeAgentRuntimeStatus } from './node-agent-runtime.ts'
import type { MNode } from './node.ts'
import type { FullLog } from './policy-log.ts'

// Steady-state frames are session-scoped: only the handshake carries runtime secrets.
export type JoinRedeemMessage = {
  type: 'join.redeem'
  ticket: string
}

export type SessionResumeMessage = {
  type: 'session.resume'
  nodeId: string
  token: string
}

export type SessionHeartbeatMessage = {
  type: 'heartbeat'
  sessionId: string
  agentVersion: string
  reportedStatus: 'healthy' | 'degraded'
  timestamp: string
  runtimeStatus?: NodeAgentRuntimeStatus
}

export type SessionLogForwardMessage = {
  type: 'log.forward'
  sessionId: string
  level: FullLog['level']
  message: string
  timestamp: string
  correlationId?: string
  traceId?: string
  payload?: unknown
}

export type SessionTaskResultMessage = {
  type: 'task.result'
  sessionId: string
  taskId: string
  result: 'completed'
  completedAt: string
}

export type MNetSessionClientMessage =
  | JoinRedeemMessage
  | SessionResumeMessage
  | SessionHeartbeatMessage
  | SessionLogForwardMessage
  | SessionTaskResultMessage

export type JoinAcceptedMessage = {
  type: 'join.accepted'
  sessionId: string
  node: MNode
  runtimeToken: string
  issuedAt: string
}

export type SessionResumedMessage = {
  type: 'session.resumed'
  sessionId: string
  node: MNode
}

export type SessionTaskExecuteMessage = {
  type: 'task.execute'
  nodeId: string
  taskId: string
  taskType: 'noop'
  correlationId: string
}

export type SessionErrorMessage = {
  type: 'error'
  code: string
  message: string
}

export type MNetSessionServerMessage =
  | JoinAcceptedMessage
  | SessionResumedMessage
  | SessionTaskExecuteMessage
  | SessionErrorMessage
