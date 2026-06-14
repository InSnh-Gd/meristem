import { extractBearerToken } from '../../../../packages/auth/src/index.ts'
import type { CommandWellEligibility } from '../../../../packages/contracts/src/index.ts'
import {
  GENERIC_NOOP_COMMAND_ID,
  type GenericNoopEligibility,
  type StateSourceMetadata
} from '../types.ts'
import type { ServiceFetchResult } from '../deps.ts'

/**
 * 从请求头里提取 Bearer token，兼容不同大小写拼写。
 */
export function bearerTokenFromHeaders(headers: Record<string, string | undefined>): string | null {
  const auth = headers.authorization ?? headers.Authorization
  return extractBearerToken(auth)
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

/** 泛型 CommandWell 使用 SDUI v0.2 命令 ID，底层仍复用 noop 判定事实。 */
export function toGenericNoopEligibility(
  eligibility: CommandWellEligibility
): GenericNoopEligibility {
  if (eligibility.state === 'disabled') return eligibility
  return {
    state: 'enabled',
    command: {
      ...eligibility.command,
      id: GENERIC_NOOP_COMMAND_ID,
      requiredPermissions: [...eligibility.command.requiredPermissions]
    }
  }
}
