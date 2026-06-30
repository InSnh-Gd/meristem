import { Either } from 'effect'
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
  schema: Schema.Schema<A, I>,
  value: unknown,
  message: string
): A | Response {
  const decoded = Schema.decodeUnknownEither(schema)(value)
  return Either.isRight(decoded)
    ? decoded.right
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
  schema: Schema.Schema<A, I>
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
  schema: Schema.Schema<A, I>
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
