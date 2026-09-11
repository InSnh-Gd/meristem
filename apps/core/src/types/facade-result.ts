import type { Result } from '../../../../packages/common/src/result.ts'

/**
 * facade 层共享的 result 类型放到独立叶模块，避免 `types/` 反向依赖 `routes/`。
 * 该模块只依赖 packages/common 的 Result 别名，不引入任何 core 内部模块，
 * 因此 `types/mdeploy-facade.ts` 与 `routes/facade-support.ts` 都能安全引用它。
 */
export type ServiceErrorLike = { code: string; message: string }

export type FacadeServiceResult<T> = Result<T, ServiceErrorLike>
