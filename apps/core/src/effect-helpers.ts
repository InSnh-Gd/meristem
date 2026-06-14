import { Effect } from 'effect'
import { err, ok } from '../../../packages/common/src/result.ts'
import { createInternalFetcher as createInternalHttpFetcher } from '../../../packages/internal-http/src/index.ts'

export type ServiceFailure = { code: string; message: string }

/**
 * Eden 客户端失败时优先尝试解包统一错误体，保证 Core 侧错误文案
 * 不依赖某个服务的偶然字符串实现。
 */
export function errorMessageFromHttpResponse(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null) return fallback
  const maybeError = Reflect.get(value, 'error')
  if (typeof maybeError !== 'object' || maybeError === null) return fallback
  const message = Reflect.get(maybeError, 'message')
  return typeof message === 'string' ? message : fallback
}

export function serviceErrorFromHttpResponse(
  value: unknown,
  fallbackCode: string,
  fallbackMessage: string
): { code: string; message: string } {
  if (typeof value !== 'object' || value === null) {
    return { code: fallbackCode, message: fallbackMessage }
  }
  const maybeError = Reflect.get(value, 'error')
  if (typeof maybeError !== 'object' || maybeError === null) {
    return { code: fallbackCode, message: fallbackMessage }
  }
  const code = Reflect.get(maybeError, 'code')
  const message = Reflect.get(maybeError, 'message')
  return {
    code: typeof code === 'string' ? code : fallbackCode,
    message: typeof message === 'string' ? message : fallbackMessage
  }
}

/**
 * 复杂的内部服务边界统一走 Effect：这里集中承载 Promise 失败、动态分支和错误映射，
 * 保持上层端口继续输出仓库既有的 Result 语义，而不是把 Effect 暴露到整个代码库。
 */
export async function runServiceEffect<T>(program: Effect.Effect<T, ServiceFailure>) {
  return Effect.runPromise(
    program.pipe(
      Effect.map(value => ok(value)),
      Effect.catchAll(failure => Effect.succeed(err(failure)))
    )
  )
}

export function tryServiceCall<T>(
  thunk: () => Promise<T>,
  failure: ServiceFailure
): Effect.Effect<T, ServiceFailure> {
  return Effect.tryPromise({
    try: thunk,
    catch: () => failure
  })
}

export function requireServiceData<T>(
  response: { data: T | null; error: { value: unknown; status: number } | null },
  failure: ServiceFailure
): Effect.Effect<T, ServiceFailure> {
  return response.error || !response.data
    ? Effect.fail({
        code: failure.code,
        message: errorMessageFromHttpResponse(response.error?.value, failure.message)
      })
    : Effect.succeed(response.data)
}

export function requireServiceRoute<T>(
  route: T | undefined,
  failure: ServiceFailure
): Effect.Effect<T, ServiceFailure> {
  return route ? Effect.succeed(route) : Effect.fail(failure)
}

/**
 * 内部服务 HTTP 客户端工厂，保持轻量封装避免各端口文件重复构造逻辑。
 */
export function createInternalFetcher() {
  return createInternalHttpFetcher()
}
