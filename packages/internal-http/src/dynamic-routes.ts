import type { Result } from '../../common/src/result.ts'
import { err, ok } from '../../common/src/result.ts'
import { serviceErrorFromEnvelope } from './index.ts'

export type DynamicRouteError = {
  code: string
  message: string
}

type DynamicRouteInput = {
  params?: Record<string, string | number | boolean>
  headers?: Record<string, string>
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  expected?: unknown
}

type DynamicRouteAdapterConfig = {
  baseUrl: string
  defaultHeaders?: Record<string, string>
  traceHeaders?: () => Record<string, string>
  fetcher?: typeof fetch
}

export type DynamicRouteAdapter = {
  postJson<TResponse>(
    path: string,
    input?: DynamicRouteInput
  ): Promise<Result<TResponse, DynamicRouteError>>
  getJson<TResponse>(
    path: string,
    input?: DynamicRouteInput
  ): Promise<Result<TResponse, DynamicRouteError>>
}

/**
 * Creates a shared dynamic route adapter for Meristem REST paths where Eden inference is brittle.
 * 来源：`docs/contracts/CONTRACT-VERSIONING.md` 的内部 HTTP 契约边界。
 */
export function createDynamicRouteAdapter(config: DynamicRouteAdapterConfig): DynamicRouteAdapter {
  async function requestJson<TResponse>(
    method: 'GET' | 'POST',
    path: string,
    input: DynamicRouteInput = {}
  ): Promise<Result<TResponse, DynamicRouteError>> {
    const url = buildUrl(config.baseUrl, path, input.params ?? {}, input.query ?? {})
    const headers = {
      ...(input.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(config.defaultHeaders ?? {}),
      ...(config.traceHeaders?.() ?? {}),
      ...(input.headers ?? {})
    }

    try {
      const response = await (config.fetcher ?? fetch)(url, {
        method,
        headers,
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) })
      })
      const parsed = await parseJson(response)
      if (!parsed.ok) return parsed
      if (!response.ok) {
        return err(
          serviceErrorFromEnvelope(parsed.value, {
            code: `http.${response.status}`,
            message: `request failed: ${response.status}`
          })
        )
      }
      return ok(parsed.value as TResponse)
    } catch (error) {
      return err({
        code: 'http.unavailable',
        message: error instanceof Error ? error.message : 'request unavailable'
      })
    }
  }

  return {
    postJson: (path, input) => requestJson('POST', path, input),
    getJson: (path, input) => requestJson('GET', path, input)
  }
}

function buildUrl(
  baseUrl: string,
  path: string,
  params: Record<string, string | number | boolean>,
  query: Record<string, string | number | boolean | undefined>
): string {
  const expanded = path.replace(/:([A-Za-z0-9_]+)/g, (_match, key: string) =>
    encodeURIComponent(String(params[key] ?? ''))
  )
  const url = new URL(expanded, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  return url.toString()
}

async function parseJson(response: Response): Promise<Result<unknown, DynamicRouteError>> {
  try {
    return ok(await response.json())
  } catch {
    return err({ code: 'http.invalid_json', message: 'response body is not valid JSON' })
  }
}
