import { createCoreApp } from '../../../apps/core/src/app.ts'
import type { CoreApp } from '../../../apps/core/src/public-types.ts'
import { createInMemoryCoreDeps } from '../../../apps/core/src/testing.ts'
import { createInMemoryMTaskDeps, createMTaskApp } from '../../../services/m-task/src/app.ts'
import type { MTaskApp } from '../../../services/m-task/src/public-types.ts'
import { createMUiBffApp } from '../../../services/m-ui-bff/src/app.ts'
import type { MUiBffApp } from '../../../services/m-ui-bff/src/public-types.ts'

export type { CoreApp, MTaskApp, MUiBffApp }
export { createCoreApp, createInMemoryCoreDeps, createInMemoryMTaskDeps, createMTaskApp }

export const CORE_BASE = 'http://mock-core'
export const MNET_BASE = 'http://mock-mnet'
export const TASK_BASE = 'http://mock-task'
export const EVENTBUS_BASE = 'http://mock-eventbus'
export const POLICY_BASE = 'http://mock-policy'

type HandleApp = {
  handle(request: Request): Response | Promise<Response>
}

let originalFetch: typeof globalThis.fetch = globalThis.fetch

export function captureOriginalFetch() {
  originalFetch = globalThis.fetch
}

export function restoreOriginalFetch() {
  globalThis.fetch = originalFetch
}

export function makeRequest(
  app: MUiBffApp,
  path: string,
  method: string = 'GET',
  token?: string,
  body?: unknown
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const init: RequestInit = { method, headers }
  if (body !== undefined) init.body = JSON.stringify(body)
  return app.handle(new Request(`http://localhost${path}`, init))
}

export function createBffWithCore(coreApp: CoreApp, taskApp?: MTaskApp): MUiBffApp {
  return taskApp ? createBffWithServices({ coreApp, taskApp }) : createBffWithServices({ coreApp })
}

export function createBffWithServices(input: {
  coreApp: HandleApp
  mnetApp?: HandleApp
  taskApp?: HandleApp
  eventbusApp?: HandleApp
  policyApp?: HandleApp
}): MUiBffApp {
  const app = createMUiBffApp(
    input.taskApp || input.eventbusApp || input.policyApp
      ? {
          coreBaseUrl: CORE_BASE,
          mnetBaseUrl: MNET_BASE,
          ...(input.taskApp ? { taskBaseUrl: TASK_BASE } : {}),
          ...(input.eventbusApp ? { eventbusBaseUrl: EVENTBUS_BASE } : {}),
          ...(input.policyApp ? { policyBaseUrl: POLICY_BASE } : {})
        }
      : { coreBaseUrl: CORE_BASE, mnetBaseUrl: MNET_BASE }
  )
  // 用新的代理 app 重新挂载测试服务，确保测试里追加的 mock route 能覆盖基础 facade。
  const coreProxy = input.coreApp
  const mnetProxy = input.mnetApp ?? null
  const taskProxy = input.taskApp ?? null
  const eventbusProxy = input.eventbusApp ?? null
  const policyProxy = input.policyApp ?? null

  /**
   * 将 fetch 入参重写为本地 Request，同时完整保留 method / headers / body，
   * 避免测试代理在转发 POST/PUT 时丢失请求体导致上游 schema 误判。
   */
  function rewriteRequest(targetBase: string, original: Request): Request {
    const path = original.url.slice(targetBase.length)
    return new Request(`http://localhost${path}`, original)
  }

  globalThis.fetch = (async (input, init?) => {
    const request =
      input instanceof Request
        ? input
        : new Request(typeof input === 'string' ? input : input.href, init)
    const url = request.url
    if (url.startsWith(CORE_BASE)) {
      return coreProxy.handle(rewriteRequest(CORE_BASE, request))
    }
    if (mnetProxy && url.startsWith(MNET_BASE)) {
      return mnetProxy.handle(rewriteRequest(MNET_BASE, request))
    }
    if (taskProxy && url.startsWith(TASK_BASE)) {
      return taskProxy.handle(rewriteRequest(TASK_BASE, request))
    }
    if (eventbusProxy && url.startsWith(EVENTBUS_BASE)) {
      return eventbusProxy.handle(rewriteRequest(EVENTBUS_BASE, request))
    }
    if (policyProxy && url.startsWith(POLICY_BASE)) {
      return policyProxy.handle(rewriteRequest(POLICY_BASE, request))
    }
    return originalFetch(input, init)
  }) as typeof globalThis.fetch

  return app
}
