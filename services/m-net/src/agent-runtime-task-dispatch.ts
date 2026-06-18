import { eq } from 'drizzle-orm'
import type { NodeAgentTaskExecuteResponse } from '../../../packages/contracts/src/index.ts'
import { nodes } from '../../../packages/db/src/schema.ts'
import type { AgentRuntimeContext } from './agent-runtime-types.ts'
import { taskTimeoutMs } from './config.ts'
import { err, ok, sendServerMessage } from './shared.ts'
import type { MNetServiceError, MNetServiceResult } from './types.ts'

function staleSessionError(): MNetServiceError {
  return {
    code: 'node.stale_session',
    message: 'node session state is stale'
  }
}

/**
 * pending task 的失败回收统一放在这里，避免断连、超时和停机三条路径产生不一致语义。
 */
export function rejectPendingTasksForNode(
  context: Pick<AgentRuntimeContext, 'pendingTasks' | 'writeFull'>,
  nodeId: string,
  error: MNetServiceError
): void {
  for (const [taskId, pending] of context.pendingTasks.entries()) {
    if (pending.nodeId !== nodeId) continue
    clearTimeout(pending.timeout)
    context.pendingTasks.delete(taskId)
    void context.writeFull('warn', `failed noop task ${taskId}`, pending.correlationId, undefined, {
      nodeId,
      taskId,
      reason: error.code,
      channel: 'session.task.result'
    })
    pending.reject(error)
  }
}

export async function executeNoop(
  context: Pick<
    AgentRuntimeContext,
    'db' | 'activeSessions' | 'activeSessionIds' | 'pendingTasks' | 'writeFull'
  >,
  input: {
    nodeId: string
    taskId: string
    correlationId: string
  }
): Promise<MNetServiceResult<NodeAgentTaskExecuteResponse>> {
  const [nodeRow] = await context.db.select().from(nodes).where(eq(nodes.id, input.nodeId)).limit(1)
  if (!nodeRow) return err('node.not_found', 'node not found')
  if (nodeRow.mode !== 'agent') return err('node.invalid_kind', 'target is not an agent node')
  if (
    nodeRow.reachability !== 'reachable' ||
    (nodeRow.status !== 'healthy' && nodeRow.status !== 'degraded')
  ) {
    return err('node.unreachable', 'node is unreachable')
  }

  const session = context.activeSessions.get(input.nodeId)
  if (!session) return err('node.unreachable', 'node is unreachable')
  const activeSessionId = context.activeSessionIds.get(input.nodeId)
  const currentSessionId =
    typeof session.data.sessionId === 'string' ? session.data.sessionId : undefined
  if (!activeSessionId || activeSessionId !== currentSessionId) {
    const error = staleSessionError()
    await context.writeFull(
      'warn',
      `stale session blocked noop task ${input.taskId}`,
      input.correlationId,
      undefined,
      {
        nodeId: input.nodeId,
        taskId: input.taskId,
        channel: 'session.task.execute',
        activeSessionId,
        currentSessionId
      }
    )
    return err(error.code, error.message)
  }

  return await new Promise<MNetServiceResult<NodeAgentTaskExecuteResponse>>(resolve => {
    const timeout = setTimeout(() => {
      context.pendingTasks.delete(input.taskId)
      void context.writeFull(
        'warn',
        `timed out waiting for noop task ${input.taskId}`,
        input.correlationId,
        undefined,
        {
          nodeId: input.nodeId,
          taskId: input.taskId,
          channel: 'session.task.execute'
        }
      )
      resolve(err('nodeagent.unavailable', 'node agent did not return a task result in time'))
    }, taskTimeoutMs())

    context.pendingTasks.set(input.taskId, {
      nodeId: input.nodeId,
      correlationId: input.correlationId,
      timeout,
      resolve(value) {
        clearTimeout(timeout)
        context.pendingTasks.delete(input.taskId)
        resolve(ok(value))
      },
      reject(error) {
        clearTimeout(timeout)
        context.pendingTasks.delete(input.taskId)
        resolve(err(error.code, error.message))
      }
    })

    void context.writeFull(
      'info',
      `dispatched noop task ${input.taskId}`,
      input.correlationId,
      undefined,
      {
        nodeId: input.nodeId,
        taskId: input.taskId,
        channel: 'session.task.execute'
      }
    )
    sendServerMessage(session, {
      type: 'task.execute',
      nodeId: input.nodeId,
      taskId: input.taskId,
      taskType: 'noop',
      correlationId: input.correlationId
    })
  })
}

/**
 * task.result 只允许完成当前节点自己发出的活动任务，避免旧 session 或串线节点伪造返回值。
 */
export async function resolvePendingTaskResult(
  context: Pick<AgentRuntimeContext, 'pendingTasks' | 'writeFull'>,
  nodeId: string,
  input: {
    taskId: string
    result: NodeAgentTaskExecuteResponse['result']
    completedAt: string
  }
): Promise<boolean> {
  const pending = context.pendingTasks.get(input.taskId)
  if (!pending || pending.nodeId !== nodeId) return false
  await context.writeFull(
    'info',
    `completed noop task ${input.taskId}`,
    pending.correlationId,
    undefined,
    {
      nodeId,
      taskId: input.taskId,
      channel: 'session.task.result'
    }
  )
  pending.resolve({
    nodeId,
    taskId: input.taskId,
    result: input.result,
    completedAt: input.completedAt
  })
  return true
}

export function rejectPendingTasksOnShutdown(
  context: Pick<AgentRuntimeContext, 'pendingTasks'>
): void {
  for (const [taskId, pending] of context.pendingTasks.entries()) {
    clearTimeout(pending.timeout)
    context.pendingTasks.delete(taskId)
    pending.reject({ code: 'mnet.unavailable', message: 'm-net is shutting down' })
  }
}
