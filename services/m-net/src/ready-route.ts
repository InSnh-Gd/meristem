import { Elysia } from 'elysia'
import { withExtractedSpan } from '../../../packages/telemetry/src/index.ts'
import type { MNetAppDeps } from './deps.ts'
import { requireInternal } from './route-helpers.ts'

/**
 * ready 路由只接受内部调用；它同时验证 PostgreSQL、M-EventBus 和 M-Log 依赖是否可用。
 */
export function createReadyRoute(deps: Pick<MNetAppDeps, 'readiness'>) {
  return new Elysia().get('/ready', async ({ headers, status }) => {
    const unauthorized = requireInternal(headers, status)
    if (unauthorized) return unauthorized
    return withExtractedSpan('m-net', 'm-net.ready', headers, () => deps.readiness())
  })
}
