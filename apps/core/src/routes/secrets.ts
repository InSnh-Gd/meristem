import { Elysia } from 'elysia'
import type { CoreDeps } from '../types.ts'

/**
 * secretsRoutes 先提供可导入的空插件，避免在 SecretRef 路由真正落地前阻塞编译与模块装配测试。
 */
export function secretsRoutes(_deps: CoreDeps) {
  return new Elysia()
}
