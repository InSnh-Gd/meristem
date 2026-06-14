/**
 * 最小 Result 语义用于跨服务边界的纯函数与端口返回值，避免在领域层抛异常传递控制流。
 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

/**
 * ok 辅助函数统一生成成功分支，便于测试和模式匹配。
 */
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })

/**
 * err 辅助函数统一生成失败分支，避免边界层发散出多套错误包装。
 */
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })
