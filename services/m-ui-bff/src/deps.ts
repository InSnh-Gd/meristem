import { internalRequestHeaders, serviceUrl } from '../../../packages/internal-http/src/index.ts'

export type MUiBffDeps = {
  coreBaseUrl: string
  mnetBaseUrl?: string
  taskBaseUrl?: string
  eventbusBaseUrl?: string
  policyBaseUrl?: string
}

export type ServiceFetchResult = {
  ok: boolean
  status: number
  data: unknown
}

export type ServiceFetch = (
  path: string,
  token?: string,
  init?: RequestInit
) => Promise<ServiceFetchResult>

export type RawServiceFetch = (
  path: string,
  token?: string,
  init?: RequestInit
) => Promise<Response>

export type MUiBffRouteDeps = {
  cf: ServiceFetch
  mf: ServiceFetch
  tf: ServiceFetch
  ef: (path: string, init?: RequestInit) => Promise<ServiceFetchResult>
  pf: (path: string, init?: RequestInit) => Promise<ServiceFetchResult>
  cfRaw: RawServiceFetch
  mfRaw: RawServiceFetch
}

function upstreamHeaders(token?: string, init?: RequestInit) {
  const hasBody = init?.body !== undefined
  return {
    ...(hasBody ? { 'content-type': 'application/json' } : {}),
    ...(init?.headers ?? {}),
    ...(token ? { authorization: `Bearer ${token}` } : {})
  }
}

function upstreamUnreachableResponse() {
  return new Response(
    JSON.stringify({
      error: { code: 'bff.service_unreachable', message: 'Upstream service unreachable' }
    }),
    {
      status: 502,
      headers: { 'content-type': 'application/json' }
    }
  )
}

async function serviceFetchRaw(
  baseUrl: string,
  path: string,
  token?: string,
  init?: RequestInit
): Promise<Response> {
  try {
    return await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: upstreamHeaders(token, init)
    })
  } catch {
    return upstreamUnreachableResponse()
  }
}

/**
 * serviceFetch 是对上游 REST v0 的薄封装：自动注入 Bearer token、统一错误契约。
 * BFF 同时面向 Core 读模型和 M-Task 命令面。
 */
async function serviceFetch(
  baseUrl: string,
  path: string,
  token?: string,
  init?: RequestInit
): Promise<ServiceFetchResult> {
  try {
    const response = await serviceFetchRaw(baseUrl, path, token, init)
    const data = await response.json()
    return { ok: response.ok, status: response.status, data }
  } catch {
    return {
      ok: false,
      status: 0,
      data: { error: { code: 'bff.service_unreachable', message: 'Upstream service unreachable' } }
    }
  }
}

async function internalServiceFetch(
  baseUrl: string,
  path: string,
  init?: RequestInit
): Promise<ServiceFetchResult> {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: internalRequestHeaders(init?.headers)
    })
    const data = await response.json()
    return { ok: response.ok, status: response.status, data }
  } catch {
    return {
      ok: false,
      status: 0,
      data: { error: { code: 'bff.service_unreachable', message: 'Upstream service unreachable' } }
    }
  }
}

/**
 * createMUiBffRouteDeps 预先绑定 Core 与 M-Task 请求器，避免路由模块持有 baseUrl 细节。
 */
export function createMUiBffRouteDeps(deps: MUiBffDeps): MUiBffRouteDeps {
  const eventbusBaseUrl = deps.eventbusBaseUrl ?? serviceUrl('m-eventbus')
  const policyBaseUrl = deps.policyBaseUrl ?? serviceUrl('m-policy')

  return {
    cf: (path, token, init) => serviceFetch(deps.coreBaseUrl, path, token, init),
    mf: (path, token, init) =>
      serviceFetch(deps.mnetBaseUrl ?? deps.coreBaseUrl, path, token, init),
    tf: (path, token, init) =>
      serviceFetch(deps.taskBaseUrl ?? deps.coreBaseUrl, path, token, init),
    ef: (path, init) => internalServiceFetch(eventbusBaseUrl, path, init),
    pf: (path, init) => internalServiceFetch(policyBaseUrl, path, init),
    cfRaw: (path, token, init) => serviceFetchRaw(deps.coreBaseUrl, path, token, init),
    mfRaw: (path, token, init) =>
      serviceFetchRaw(deps.mnetBaseUrl ?? deps.coreBaseUrl, path, token, init)
  }
}
