import type { ApiError } from '../../../packages/contracts/src/index.ts'

export type StatusFn = (code: never, body: never) => unknown

/**
 * Core 对外统一输出版本化错误 envelope，避免路由各自拼装不一致的错误形状。
 */
export function apiError(
  status: StatusFn,
  code: number,
  errorCode: string,
  message: string,
  correlationId?: string
): never {
  const error: ApiError['error'] = {
    code: errorCode,
    message
  }
  if (correlationId) error.correlationId = correlationId

  return (status as (code: never, body: never) => unknown)(code as never, {
    error
  } as never) as never
}

/**
 * 相关链路没有显式传入 correlationId 时，在入口层补一个随机值，保证日志与事件可串联。
 */
export function correlationIdFromHeader(header: string | undefined): string {
  return header && header.length > 0 ? header : crypto.randomUUID()
}
