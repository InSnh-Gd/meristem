import type {
  SubmitTaskResponse,
  TaskControlResponse,
  TaskListResponse,
  TaskRetryNotImplementedResponse,
  TaskStatusResponse
} from '../../../../packages/contracts/src/index.ts'
import type { CliClient } from '../commands/types.ts'
import type { CliRuntime } from './runtime.ts'

/**
 * 任务客户端保持对 m-task 动态路由的直接调用，便于继续独立演进任务服务 API。
 */
export function createTaskClient(
  runtime: CliRuntime
): Pick<CliClient, 'submitTask' | 'cancelTask' | 'getTask' | 'listTasks' | 'retryTask'> {
  const { taskRoutes } = runtime

  return {
    submitTask: async input => {
      const result = await taskRoutes.postJson<SubmitTaskResponse>('/api/v0/tasks', { body: input })
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    cancelTask: async taskId => {
      const result = await taskRoutes.postJson<TaskControlResponse>('/api/v0/tasks/:id/cancel', {
        params: { id: taskId }
      })
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    getTask: async taskId => {
      const result = await taskRoutes.getJson('/api/v0/tasks/:id', { params: { id: taskId } })
      if (!result.ok) throw new Error(result.error.message)
      return result.value as TaskStatusResponse
    },
    listTasks: async () => {
      const result = await taskRoutes.getJson('/api/v0/tasks')
      if (!result.ok) throw new Error(result.error.message)
      return result.value as TaskListResponse
    },
    retryTask: async taskId => {
      const result = await taskRoutes.postJson<TaskRetryNotImplementedResponse>(
        '/api/v0/tasks/:id/retry',
        { params: { id: taskId } }
      )
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    }
  }
}
