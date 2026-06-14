import { createCoreApp } from '../../../apps/core/src/app.ts'
import type { CoreApp } from '../../../apps/core/src/public-types.ts'
import { createInMemoryCoreDeps } from '../../../apps/core/src/testing.ts'
import { createInMemoryMTaskDeps, createMTaskApp } from '../../../services/m-task/src/app.ts'
import type { MTaskApp } from '../../../services/m-task/src/public-types.ts'
import { createMUiBffApp } from '../../../services/m-ui-bff/src/app.ts'
import type { MUiBffApp } from '../../../services/m-ui-bff/src/public-types.ts'

export { createCoreApp, createInMemoryCoreDeps, createInMemoryMTaskDeps, createMTaskApp }
export type { CoreApp, MTaskApp, MUiBffApp }

export const CORE_BASE = 'http://mock-core'
export const TASK_BASE = 'http://mock-task'

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
  const app = createMUiBffApp(
    taskApp ? { coreBaseUrl: CORE_BASE, taskBaseUrl: TASK_BASE } : { coreBaseUrl: CORE_BASE }
  )

  globalThis.fetch = (async (input, init?) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith(CORE_BASE)) {
      const path = url.slice(CORE_BASE.length)
      return coreApp.handle(new Request(`http://localhost${path}`, init))
    }
    if (taskApp && url.startsWith(TASK_BASE)) {
      const path = url.slice(TASK_BASE.length)
      return taskApp.handle(new Request(`http://localhost${path}`, init))
    }
    return originalFetch(input, init)
  }) as typeof globalThis.fetch

  return app
}
