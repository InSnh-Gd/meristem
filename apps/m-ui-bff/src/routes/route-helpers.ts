import * as Schema from 'effect/Schema'
import type { ServiceFetch, ServiceFetchResult } from '../deps.ts'

export function bffError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

export function requireBearerToken(headers: Record<string, string | undefined>): string | Response {
  const authorization = headers.authorization ?? headers.Authorization
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  return token && token.length > 0
    ? token
    : bffError(401, 'auth.missing_token', 'Bearer token is required')
}

function passthroughUpstreamError(result: ServiceFetchResult): Response {
  return new Response(JSON.stringify(result.data), {
    status: result.status || 502,
    headers: { 'content-type': 'application/json' }
  })
}

/** BFF 在跨服务边界先解码响应，拒绝未满足 UI 展示契约的上游数据。 */
export async function fetchDecodedUpstream<Output, Input>(input: {
  fetcher: ServiceFetch
  path: string
  token: string
  schema: Schema.Schema<Output, Input>
  errorMessage: string
  init?: RequestInit
}): Promise<Output | Response> {
  const result = await input.fetcher(input.path, input.token, input.init)
  if (!result.ok) return passthroughUpstreamError(result)

  try {
    return Schema.decodeUnknownSync(input.schema)(result.data)
  } catch {
    return bffError(502, 'bff.invalid_upstream_response', input.errorMessage)
  }
}
