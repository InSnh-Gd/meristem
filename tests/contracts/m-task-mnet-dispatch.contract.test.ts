import { describe, expect, it } from 'bun:test'
import { internalTokenHeaderName } from '../../packages/internal-http/src/index.ts'
import { createMNetApp } from '../../services/m-net/src/app.ts'
import type { MNetAppDeps } from '../../services/m-net/src/deps.ts'
import { createMTaskApp } from '../../services/m-task/src/app.ts'
import { createHttpMNetTaskDeliveryPort } from '../../services/m-task/src/mnet-delivery-port.ts'
import { createInMemoryMTaskDeps } from '../../services/m-task/src/testing.ts'

type LocalFetchApp = {
  handle(request: Request): Response | Promise<Response>
}

type FetchInput = Parameters<typeof fetch>[0]
type FetchInit = Parameters<typeof fetch>[1]

const internalToken = 'task-mnet-contract-token'

function localFetcher(app: LocalFetchApp): typeof fetch {
  const fetcher = (input: FetchInput, init?: FetchInit) => {
    const headers = new Headers(init?.headers)
    headers.set(internalTokenHeaderName, internalToken)
    const request =
      typeof input === 'string'
        ? new Request(input, { ...init, headers })
        : input instanceof URL
          ? new Request(input.toString(), { ...init, headers })
          : new Request(input, { ...init, headers })
    return app.handle(request)
  }

  return Object.assign(fetcher, { preconnect: fetch.preconnect }) as typeof fetch
}

function createMNetDeps(executeNoop: MNetAppDeps['executeNoop']): MNetAppDeps {
  return {
    async readiness() {
      return { ready: true }
    },
    async createNetwork() {
      return { ok: false, error: { code: 'network.unavailable', message: 'not used' } }
    },
    async listNetworks() {
      return { ok: false, error: { code: 'network.unavailable', message: 'not used' } }
    },
    async joinNetwork() {
      return { ok: false, error: { code: 'network.unavailable', message: 'not used' } }
    },
    async listMembers() {
      return { ok: false, error: { code: 'network.unavailable', message: 'not used' } }
    },
    executeNoop
  }
}

async function submitNoop(app: ReturnType<typeof createMTaskApp>) {
  return app.handle(
    new Request('http://localhost/api/v0/tasks', {
      method: 'POST',
      headers: {
        authorization: 'Bearer operator-token',
        'content-type': 'application/json',
        'x-correlation-id': 'corr-task-mnet-dispatch-contract'
      },
      body: JSON.stringify({ nodeId: 'leaf-1', type: 'noop' })
    })
  )
}

function deliveryFailureFromPayload(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const value = Reflect.get(payload, 'deliveryFailure')
  return typeof value === 'string' ? value : null
}

describe('M-Task → M-Net noop dispatch contract', () => {
  process.env.MERISTEM_INTERNAL_TOKEN = internalToken

  it('completes noop tasks when M-Net returns a schema-valid dispatch result', async () => {
    const mnet = createMNetApp(
      createMNetDeps(async input => ({
        ok: true,
        value: {
          nodeId: input.nodeId,
          taskId: input.taskId,
          result: 'completed',
          completedAt: '2026-06-18T12:00:00.000Z'
        }
      }))
    )
    const deps = createInMemoryMTaskDeps({ actor: 'operator' })
    const app = createMTaskApp({
      ...deps,
      delivery: createHttpMNetTaskDeliveryPort({
        baseUrl: 'http://internal.test',
        fetcher: localFetcher(mnet)
      })
    })

    const response = await submitNoop(app)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      task: {
        nodeId: 'leaf-1',
        status: 'completed',
        completedAt: '2026-06-18T12:00:00.000Z'
      }
    })
  })

  it('maps offline dispatch failures to typed M-Task failure with audit and full-log evidence', async () => {
    const mnet = createMNetApp(
      createMNetDeps(async () => ({
        ok: false,
        error: { code: 'node.unreachable', message: 'node is unreachable' }
      }))
    )
    const deps = createInMemoryMTaskDeps({ actor: 'operator' })
    const app = createMTaskApp({
      ...deps,
      delivery: createHttpMNetTaskDeliveryPort({
        baseUrl: 'http://internal.test',
        fetcher: localFetcher(mnet)
      })
    })

    const response = await submitNoop(app)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      task: {
        nodeId: 'leaf-1',
        status: 'failed'
      }
    })
    expect(
      deps.__testing.fullEntries().some(entry => entry.message.includes('dispatch.offline'))
    ).toBe(true)
    expect(
      deps.__testing
        .auditEntries()
        .some(
          entry =>
            entry.action === 'task.dispatch' &&
            entry.result === 'failure' &&
            deliveryFailureFromPayload(entry.payload) === 'dispatch.offline'
        )
    ).toBe(true)
  })

  it('maps stale-session dispatch failures to typed M-Task failure with audit and full-log evidence', async () => {
    const mnet = createMNetApp(
      createMNetDeps(async () => ({
        ok: false,
        error: { code: 'node.stale_session', message: 'node session state is stale' }
      }))
    )
    const deps = createInMemoryMTaskDeps({ actor: 'operator' })
    const app = createMTaskApp({
      ...deps,
      delivery: createHttpMNetTaskDeliveryPort({
        baseUrl: 'http://internal.test',
        fetcher: localFetcher(mnet)
      })
    })

    const response = await submitNoop(app)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      task: {
        nodeId: 'leaf-1',
        status: 'failed'
      }
    })
    expect(
      deps.__testing.fullEntries().some(entry => entry.message.includes('dispatch.stale_session'))
    ).toBe(true)
    expect(
      deps.__testing
        .auditEntries()
        .some(
          entry =>
            entry.action === 'task.dispatch' &&
            entry.result === 'failure' &&
            deliveryFailureFromPayload(entry.payload) === 'dispatch.stale_session'
        )
    ).toBe(true)
  })
})
