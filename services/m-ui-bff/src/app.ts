import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { Elysia } from 'elysia'
import { createMUiBffRouteDeps, type MUiBffDeps } from './deps.ts'
import { createBffDataRoutes } from './routes/bff-data-routes.ts'
import { createCommandWellRoutes } from './routes/command-well-routes.ts'
import { createSduiScreenRoutes } from './routes/sdui-screen-routes.ts'

export type { MUiBffDeps } from './deps.ts'

/**
 * createMUiBffApp 构建 M-UI 的 BFF Elysia 应用。
 * BFF 是面向 SvelteKit shell 的公开入口，不参与内部 loopback 认证。
 * 它负责聚合 Core REST v0 数据、派生命令可用状态并透传任务执行请求。
 */
export function createMUiBffApp(deps: MUiBffDeps) {
  const routeDeps = createMUiBffRouteDeps(deps)

  return new Elysia()
    .use(
      cors({
        origin: true,
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['content-type', 'authorization'],
        credentials: true
      })
    ) // 开发环境允许任意 origin；生产部署需替换为具体允许域名。
    .use(
      openapi({
        path: '/openapi-ui',
        specPath: '/openapi',
        provider: null,
        documentation: {
          info: { title: 'Meristem M-UI BFF API', version: 'v0' }
        }
      })
    )
    .get('/health', () => ({ ok: true as const, service: 'm-ui-bff' as const }))
    .get('/ready', async () => {
      const result = await routeDeps.cf('/api/v0/health', undefined)
      return { ready: result.ok }
    })
    .use(createSduiScreenRoutes(routeDeps))
    .use(createBffDataRoutes(routeDeps))
    .use(createCommandWellRoutes(routeDeps))
}

export type MUiBffApp = ReturnType<typeof createMUiBffApp>
