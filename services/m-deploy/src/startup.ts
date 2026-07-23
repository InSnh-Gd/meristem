import type { ServedInternalApp } from '../../../packages/internal-http/src/index.ts'
import { serveMDeployApp } from './app.ts'
import { createProductionMDeployComposition, type ProductionMDeployOptions } from './production.ts'

/**
 * 生产启动边界负责将已组合的依赖交给服务入口，并在停止时关闭 PostgreSQL 客户端。
 */
export async function serveProductionMDeployApp(
  options: ProductionMDeployOptions
): Promise<ServedInternalApp> {
  const composition = await createProductionMDeployComposition(options)
  const server = serveMDeployApp(composition.deps)
  return {
    ...server,
    async stop() {
      await server.stop()
      await composition.close()
    }
  }
}
