import { createNodeRuntimeFacade } from './agent-runtime-node-runtime.ts'
import { markOfflineNodes } from './agent-runtime-session-lifecycle.ts'
import { executeNoop, rejectPendingTasksOnShutdown } from './agent-runtime-task-dispatch.ts'
import type { AgentRuntimeDeps } from './agent-runtime-types.ts'
import { createJoinIngress } from './agent-runtime-websocket.ts'

/**
 * agent join/session/task/offline 运行态统一收敛在这里，入口文件只保留装配职责。
 */
export function createAgentRuntime({
  db,
  publishEvent,
  writeTimeline,
  writeFull,
  writeAudit,
  dataPlaneDeps
}: AgentRuntimeDeps) {
  const context = {
    db,
    publishEvent,
    writeTimeline,
    writeFull,
    writeAudit,
    activeSessions: new Map(),
    activeSessionIds: new Map(),
    pendingTasks: new Map()
  }
  const nodeRuntime = createNodeRuntimeFacade(
    dataPlaneDeps === undefined ? { db } : { db, dataPlaneDeps }
  )

  return {
    executeNoop(input: { nodeId: string; taskId: string; correlationId: string }) {
      return executeNoop(context, input)
    },
    markOfflineNodes(now = new Date(), timeoutMs: number) {
      return markOfflineNodes(context, now, timeoutMs)
    },
    createJoinIngress() {
      return createJoinIngress(context)
    },
    ...(nodeRuntime ? { nodeRuntime } : {}),
    rejectPendingTasksOnShutdown() {
      return rejectPendingTasksOnShutdown(context)
    }
  }
}
