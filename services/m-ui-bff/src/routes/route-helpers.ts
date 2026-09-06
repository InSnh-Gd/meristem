import { Result } from 'effect'
import * as Schema from 'effect/Schema'
import { extractBearerToken } from '../../../../packages/auth/src/index.ts'
import type { CommandWellEligibilityFromSchema as CommandWellEligibility } from '../../../../packages/contracts/src/index.ts'
import { SessionResponseSchema } from '../../../../packages/contracts/src/index.ts'
import type { ServiceFetch, ServiceFetchResult } from '../deps.ts'
import {
  GENERIC_NOOP_COMMAND_ID,
  type GenericNoopEligibility,
  type StateSourceMetadata
} from '../types.ts'

/**
 * 从请求头里提取 Bearer token，兼容不同大小写拼写。
 */
export function bearerTokenFromHeaders(headers: Record<string, string | undefined>): string | null {
  const auth = headers.authorization ?? headers.Authorization
  return extractBearerToken(auth)
}

/** 需要鉴权的 BFF 路由统一在入口处取 Bearer token；缺失时立即返回固定错误契约。 */
export function requireBearerToken(headers: Record<string, string | undefined>): string | Response {
  const token = bearerTokenFromHeaders(headers)
  return token ?? bffError(401, 'auth.missing_token', 'Bearer token is required')
}

/** BFF 错误响应统一走 JSON + HTTP status，保留 Core 错误 envelope 透传能力。 */
export function bffError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

/** 透传 Core 侧返回的错误，保留原始 HTTP 状态码与 error envelope。 */
export function passthroughCoreError(result: ServiceFetchResult): Response {
  return new Response(JSON.stringify(result.data), {
    status: result.status || 502,
    headers: { 'content-type': 'application/json' }
  })
}

/** 给展示数据附加状态来源，BFF 只标注来源，不成为事实源。 */
export function withStateSource<T extends object>(
  value: T,
  stateSource: StateSourceMetadata
): T & { stateSource: StateSourceMetadata } {
  return { ...value, stateSource }
}

/**
 * 为 OpenAPI detail 附加 Meristem 状态来源元数据，方便契约测试校验每条路由都声明来源。
 */
export function withStateSourceDetail(
  summary: string,
  stateSources: readonly StateSourceMetadata['sourceType'][]
) {
  return {
    summary,
    description: `stateSources: ${stateSources.join(', ')}`,
    'x-meristem-state-sources': [...stateSources]
  }
}

/** 上游返回成功时仍需按契约 schema 解码，避免 BFF 用断言吞掉漂移。 */
export function decodeUpstreamData<A, I>(
  schema: Schema.Codec<A, I>,
  value: unknown,
  message: string
): A | Response {
  const decoded = Schema.decodeUnknownResult(schema)(value)
  return Result.isSuccess(decoded)
    ? decoded.success
    : bffError(502, 'bff.invalid_upstream_response', message)
}

/** 某些 BFF 端点仍透传动态对象；这里只允许 plain object 继续向下游流动。 */
export function requireObjectRecord(
  value: unknown,
  message: string
): Record<string, unknown> | Response {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>
  }
  return bffError(502, 'bff.invalid_upstream_response', message)
}

/** fetch + error passthrough + schema decode 的标准流水线，避免每个读路由重复拼接。 */
export async function fetchDecodedUpstream<A, I>(input: {
  fetcher: ServiceFetch
  path: string
  token: string
  schema: Schema.Codec<A, I>
  errorMessage: string
  init?: RequestInit
}): Promise<A | Response> {
  const result = await input.fetcher(input.path, input.token, input.init)
  if (!result.ok) return passthroughCoreError(result)
  return decodeUpstreamData(input.schema, result.data, input.errorMessage)
}

/** 某些展示端点把上游 404 解释为空集合；这里只把这种分支显式化，避免 handler 内联 IIFE。 */
export async function fetchDecodedUpstreamAllow404<A, I>(input: {
  fetcher: ServiceFetch
  path: string
  token: string
  schema: Schema.Codec<A, I>
  errorMessage: string
  init?: RequestInit
}): Promise<A | null | Response> {
  const result = await input.fetcher(input.path, input.token, input.init)
  if (!result.ok) {
    if (result.status === 404) return null
    return passthroughCoreError(result)
  }
  return decodeUpstreamData(input.schema, result.data, input.errorMessage)
}

/** 只要能成功读取 Core session，就说明当前 Bearer token 可用于 BFF 读路由。 */
export async function requireCoreSession(
  fetcher: ServiceFetch,
  headers: Record<string, string | undefined>
): Promise<Response | Schema.Schema.Type<typeof SessionResponseSchema>> {
  const token = requireBearerToken(headers)
  if (token instanceof Response) return token
  return fetchDecodedUpstream({
    fetcher,
    path: '/api/v0/session',
    token,
    schema: SessionResponseSchema,
    errorMessage: 'Core returned invalid session payload'
  })
}

/** 泛型 CommandWell 使用 SDUI v0.2 命令 ID，底层仍复用 noop 判定事实。 */
export function toGenericNoopEligibility(
  eligibility: CommandWellEligibility
): GenericNoopEligibility {
  if (eligibility.state === 'disabled') return eligibility
  return {
    state: 'enabled',
    command: {
      id: GENERIC_NOOP_COMMAND_ID,
      label: eligibility.command.label,
      action: eligibility.command.action,
      resource: eligibility.command.resource,
      risk: 'medium',
      requiredPermissions: [...eligibility.command.requiredPermissions],
      requiresPolicy: eligibility.command.requiresPolicy,
      requiresAudit: eligibility.command.requiresAudit
    }
  }
}

// ---- 请求体轻量 shape 读取 helpers ----
// CommandWell 与 M-Net dataplane mutation 路由共用，避免各自维护本地实现。

/** 仅接受 plain object 请求体；数组与 null 一律拒绝。 */
export function asObject(body: unknown): object | null {
  return typeof body === 'object' && body !== null ? body : null
}

/** 必填字符串字段：空字符串视为缺失。 */
export function stringField(body: object, key: string): string | undefined {
  const value = Reflect.get(body, key)
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** 可选字符串字段：缺失返回 undefined，类型错误返回 null（由调用方决定 400 语义）。 */
export function optionalStringField(body: object, key: string): string | undefined | null {
  const value = Reflect.get(body, key)
  if (value === undefined) return undefined
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** 与 optionalStringField 相同，但允许空字符串（break-glass reason 等场景）。 */
export function optionalStringFieldAllowEmpty(
  body: object,
  key: string
): string | undefined | null {
  const value = Reflect.get(body, key)
  if (value === undefined) return undefined
  return typeof value === 'string' ? value : null
}

/** 可选字符串数组字段：浅拷贝返回，避免持有请求体内部引用。 */
export function optionalStringArrayField(body: object, key: string): string[] | undefined | null {
  const value = Reflect.get(body, key)
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) return null
  return [...value]
}

/** 可选正整数字段。 */
export function optionalPositiveNumber(body: object, key: string): number | undefined | null {
  const value = Reflect.get(body, key)
  if (value === undefined) return undefined
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? value : null
}

/** 布尔字段：缺失返回 undefined，类型错误返回 null。 */
export function booleanField(body: object, key: string): boolean | null {
  const value = Reflect.get(body, key)
  return typeof value === 'boolean' ? value : null
}
