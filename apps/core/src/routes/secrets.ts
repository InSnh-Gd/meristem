import type { CoreDeps } from '../types.ts'
import { createSecretCrudRoutes } from './secret-crud-routes.ts'
import { createSecretReferenceRoutes } from './secret-reference-routes.ts'

/**
 * SecretRef facade 只负责组装外部 CRUD 路由，保持 Core app.ts 的导出名不变。
 */
export const secrets = (deps: CoreDeps) => createSecretCrudRoutes(deps)

/**
 * SecretRef internal facade 继续暴露 reference 路由与 reject stub，不改变内部路径。
 */
export const secretReference = (deps: CoreDeps) => createSecretReferenceRoutes(deps)

export const secretsRoutes = secrets
