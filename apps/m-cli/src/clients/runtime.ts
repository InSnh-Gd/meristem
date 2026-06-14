import { edenTreaty } from '@elysiajs/eden'
import { createDynamicRouteAdapter } from '../../../../packages/internal-http/src/dynamic-routes.ts'
import { injectTraceHeaders } from '../../../../packages/telemetry/src/index.ts'
import type { CoreApp } from '../../../core/src/public-types.ts'
import {
  authHeaders,
  type CliConfig,
  type EdenResponse,
  type FetchInit,
  type FetchInput
} from './shared.ts'

type NetworkRoute = {
  members: {
    post(params: {
      nodeId: string
      $headers: Record<string, string>
    }): Promise<EdenResponse<unknown>>
    get(params: { $headers: Record<string, string> }): Promise<EdenResponse<unknown>>
  }
}

type ServiceRoute = {
  reload: {
    post(params: {
      reason?: string
      $headers: Record<string, string>
    }): Promise<EdenResponse<unknown>>
  }
}

type NodeRoute = {
  credentials: {
    post(params: { $headers: Record<string, string> }): Promise<EdenResponse<unknown>>
  }
}

export type CliRuntime = {
  client: ReturnType<typeof edenTreaty<CoreApp>>
  headers: Record<string, string>
  coreRoutes: ReturnType<typeof createDynamicRouteAdapter>
  taskRoutes: ReturnType<typeof createDynamicRouteAdapter>
  policyRoutes: ReturnType<typeof createDynamicRouteAdapter>
  mnetRoutes: ReturnType<typeof createDynamicRouteAdapter>
  extensionRoutes: ReturnType<typeof createDynamicRouteAdapter>
  networkRoutes: Record<string, NetworkRoute>
  serviceRoutes: Record<string, ServiceRoute>
  nodeRoutes: Record<string, NodeRoute>
}

/**
 * CLI 运行时统一创建 Eden 和动态路由适配器，保证 trace 头和默认鉴权头在所有域上保持一致。
 */
export function createCliRuntime(config: CliConfig): CliRuntime {
  const fetcher = Object.assign(
    (input: FetchInput, init?: FetchInit) =>
      fetch(input, {
        ...init,
        headers: injectTraceHeaders(Object.fromEntries(new Headers(init?.headers).entries()))
      }),
    { preconnect: fetch.preconnect }
  ) as typeof fetch
  const client = edenTreaty<CoreApp>(config.coreUrl, { fetcher })
  const headers = authHeaders(config.token)

  return {
    client,
    headers,
    coreRoutes: createDynamicRouteAdapter({
      baseUrl: config.coreUrl,
      defaultHeaders: headers,
      traceHeaders: () => injectTraceHeaders({})
    }),
    taskRoutes: createDynamicRouteAdapter({
      baseUrl: config.taskUrl,
      defaultHeaders: headers,
      traceHeaders: () => injectTraceHeaders({})
    }),
    policyRoutes: createDynamicRouteAdapter({
      baseUrl: config.policyUrl,
      defaultHeaders: headers,
      traceHeaders: () => injectTraceHeaders({})
    }),
    mnetRoutes: createDynamicRouteAdapter({
      baseUrl: config.mnetUrl,
      defaultHeaders: headers,
      traceHeaders: () => injectTraceHeaders({})
    }),
    extensionRoutes: createDynamicRouteAdapter({
      baseUrl: config.extensionUrl,
      defaultHeaders: headers,
      traceHeaders: () => injectTraceHeaders({})
    }),
    networkRoutes: client.api.v0.networks as Record<string, NetworkRoute>,
    serviceRoutes: client.api.v0.services as Record<string, ServiceRoute>,
    nodeRoutes: client.api.v0.nodes as Record<string, NodeRoute>
  }
}
