import { Elysia } from 'elysia'
import type { MTaskDeps } from './deps.ts'
import { createInternalTaskRoutes } from './internal-task-routes.ts'
import { createPublicTaskRoutes } from './public-task-routes.ts'

/**
 * M-Task 的 facade 只负责统一错误映射和路由组合，避免再次演化成 god file。
 * 委托出去的公开任务边界仍然保留原始入口与策略动作：
 * .post('/api/v0/tasks', ...)
 * action: 'task:submit'
 * action: 'task:retry'
 */
export function createMTaskApp(deps: MTaskDeps) {
  return new Elysia()
    .onError(({ error, set }) => {
      const maybe = error as Error & { status?: number; code?: string; correlationId?: string }
      if (maybe.status && maybe.code) {
        set.status = maybe.status
        return {
          error: { code: maybe.code, message: maybe.message, correlationId: maybe.correlationId }
        }
      }
      return undefined
    })
    .get('/health', () => ({ ok: true as const, service: 'm-task' as const }))
    .use(createPublicTaskRoutes(deps))
    .use(createInternalTaskRoutes(deps))
}

export type MTaskApp = ReturnType<typeof createMTaskApp>
export type { MTaskCreateInput, MTaskDeliveryPort, MTaskDeps } from './deps.ts'
export { createInMemoryMTaskDeps } from './testing.ts'
