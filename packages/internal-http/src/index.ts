import { injectTraceHeaders } from '../../telemetry/src/index.ts'

// internal-http 是所有 loopback 内部服务共用的最小 HTTP 边界，不承担业务语义。
export type InternalServiceName =
  | 'm-policy'
  | 'm-log'
  | 'm-eventbus'
  | 'm-net'
  | 'm-task'
  | 'm-extension'

export type ServedInternalApp = {
  name: InternalServiceName
  port: number
  url: string
  stop(): Promise<void>
}

export const internalServicePorts: Record<InternalServiceName, number> = {
  'm-policy': 3101,
  'm-log': 3102,
  'm-eventbus': 3103,
  'm-net': 3104,
  'm-task': 3105,
  'm-extension': 3106
}

export const internalTokenHeaderName = 'x-meristem-internal-token'
export const internalApiPaths = {
  authorize: '/internal/v0/authorize',
  timelineLog: '/internal/v0/timeline',
  fullLog: '/internal/v0/full',
  auditLog: '/internal/v0/audit',
  publishEvent: '/internal/v0/publish',
  eventBusPublishMetrics: '/internal/v0/metrics/publish-summary'
} as const
type FetchInput = Parameters<typeof fetch>[0]
type FetchInit = Parameters<typeof fetch>[1]
type HeaderRecord = Record<string, string | undefined>
type HeaderSource = ConstructorParameters<typeof Headers>[0] | HeaderRecord

function headerSource(
  headers?: HeaderSource
): ConstructorParameters<typeof Headers>[0] | undefined {
  if (!headers) return undefined
  if (headers instanceof Headers || Array.isArray(headers)) return headers

  return Object.fromEntries(
    Object.entries(headers).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value]] : []
    )
  )
}

/**
 * 内部控制面调用统一携带共享 token，确保在 MVP 阶段不依赖
 * service mesh 或 mTLS 时，loopback HTTP 仍然具备明确认证边界。
 */
export function requiredInternalToken(token = process.env.MERISTEM_INTERNAL_TOKEN): string {
  if (!token) throw new Error('MERISTEM_INTERNAL_TOKEN is required')
  return token
}

export function serviceUrl(name: InternalServiceName): string {
  return `http://127.0.0.1:${internalServicePorts[name]}`
}

/**
 * 每个内部 HTTP 请求都必须同时携带共享 token 和当前 trace 头，
 * 下游服务据此统一做认证校验并保持 OTel 链路连续。
 */
export function internalRequestHeaders(headers?: HeaderSource): Record<string, string> {
  const requestHeaders = new Headers(headerSource(headers))
  requestHeaders.set(internalTokenHeaderName, requiredInternalToken())
  return injectTraceHeaders(Object.fromEntries(requestHeaders.entries()))
}

export function createInternalFetcher(): typeof fetch {
  // 内部 fetcher 自动补 token 和 trace 头，调用方无需每次重复拼装样板代码。
  const fetcher = (input: FetchInput, init?: FetchInit) =>
    fetch(input, {
      ...init,
      headers: internalRequestHeaders(init?.headers)
    })

  return Object.assign(fetcher, { preconnect: fetch.preconnect }) as typeof fetch
}

/**
 * ponytail: 仓库内已经统一使用 `{ error: { code, message } }` envelope，
 * 这里直接提供最小解析 helper，避免 Core / M-Task / internal-http 各写一份 Reflect 样板。
 */
export function serviceErrorFromEnvelope(
  value: unknown,
  fallback: { code: string; message: string }
): { code: string; message: string } {
  if (typeof value !== 'object' || value === null) return fallback
  const maybeError = Reflect.get(value, 'error')
  if (typeof maybeError !== 'object' || maybeError === null) return fallback
  const code = Reflect.get(maybeError, 'code')
  const message = Reflect.get(maybeError, 'message')
  return {
    code: typeof code === 'string' ? code : fallback.code,
    message: typeof message === 'string' ? message : fallback.message
  }
}

export function errorMessageFromEnvelope(value: unknown, fallback: string): string {
  return serviceErrorFromEnvelope(value, { code: 'ignored', message: fallback }).message
}

export type DegradedWarning = {
  target: string
  error: string
  message: string
}

type SqlProbeClient = (strings: TemplateStringsArray, ...values: ReadonlyArray<unknown>) => unknown

/**
 * ponytail: 多个服务都在做“记录 degraded 原因并返回 fallback”的同一件事，
 * 这里只统一消息拼装和返回值，不统一日志框架。
 */
export function warnDegradedAndReturn<T>(input: {
  service: string
  target: string
  error: unknown
  context: string
  fallback: T
  warn(warning: DegradedWarning): void
}): T {
  const errorMessage = input.error instanceof Error ? input.error.message : String(input.error)
  input.warn({
    target: input.target,
    error: errorMessage,
    message: `${input.service}: ${input.target} ${input.context} - ${errorMessage}`
  })
  return input.fallback
}

/**
 * ponytail: 多个服务的 PostgreSQL readiness 都只是同一个 `select 1` 探针；
 * 这里只收掉重复样板，不接管各服务自己的 ready 组合逻辑。
 */
export async function probePostgresReadiness<T>(input: {
  client: SqlProbeClient
  service: string
  readyValue: T
  fallback: T
  warn(warning: DegradedWarning): void
}): Promise<T> {
  try {
    await input.client`select 1`
    return input.readyValue
  } catch (error) {
    return warnDegradedAndReturn({
      service: input.service,
      target: 'postgres',
      error,
      context: 'readiness probe degraded',
      fallback: input.fallback,
      warn: input.warn
    })
  }
}

/**
 * 所有内部服务路由统一走这一段认证逻辑，保证未授权 loopback 调用
 * 使用同一套错误契约返回，而不是各服务自行发散。
 */
export function validateInternalRequest(
  headers: HeaderSource
): { ok: true } | { ok: false; error: { code: string; message: string } } {
  try {
    const expectedToken = requiredInternalToken()
    const actualToken =
      headers instanceof Headers
        ? headers.get(internalTokenHeaderName)
        : new Headers(headerSource(headers)).get(internalTokenHeaderName)
    return actualToken === expectedToken
      ? { ok: true }
      : { ok: false, error: { code: 'internal.unauthorized', message: 'invalid internal token' } }
  } catch {
    return {
      ok: false,
      error: { code: 'internal.unavailable', message: 'internal auth is not configured' }
    }
  }
}

export async function fetchReadyState(url: string): Promise<boolean> {
  try {
    const response = await createInternalFetcher()(url, { method: 'GET' })
    const body = (await response.json()) as { ready?: boolean }
    return response.ok && body.ready === true
  } catch {
    return false
  }
}

/**
 * Meristem 内部服务执行 Bun-only 规则，因此共享 loopback 服务边界
 * 必须避免 Node.js server API，同时保留 Elysia 与 Eden 现有的 fetch 风格契约。
 */
export function serveHttpApp(
  name: InternalServiceName,
  fetchHandler: (request: Request) => Response | Promise<Response>
): ServedInternalApp {
  const port = internalServicePorts[name]
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    fetch: fetchHandler,
    error() {
      return new Response('internal server error', { status: 500 })
    }
  })

  return {
    name,
    port,
    url: `http://127.0.0.1:${port}`,
    async stop() {
      server.stop(true)
    }
  }
}
