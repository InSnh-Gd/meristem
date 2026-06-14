import type { ServerWebSocket } from 'bun'
import type { MNetDb } from './clients.ts'
import type { JoinSessionData, PendingTask } from './shared.ts'

export type CredentialStore = Pick<MNetDb, 'insert' | 'update'>

export type AgentRuntimeDeps = {
  db: MNetDb
  publishEvent(
    subject: string,
    type: string,
    payload: unknown,
    correlationId?: string,
    traceId?: string
  ): Promise<void>
  writeTimeline(summary: string, subject?: string, correlationId?: string): Promise<void>
  writeFull(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    correlationId?: string,
    traceId?: string,
    payload?: unknown
  ): Promise<void>
  writeAudit(
    resource: string,
    action: string,
    correlationId?: string,
    traceId?: string,
    payload?: unknown
  ): Promise<void>
}

export type AgentRuntimeState = {
  activeSessions: Map<string, ServerWebSocket<JoinSessionData>>
  activeSessionIds: Map<string, string>
  pendingTasks: Map<string, PendingTask>
}

export type AgentRuntimeContext = AgentRuntimeDeps & AgentRuntimeState
