import { afterEach, describe, expect, it } from 'bun:test'
import {
  createServiceLifecyclePort,
  dependencyStateFromReady
} from '../../../apps/core/src/adapters/service-lifecycle.ts'
import type { CoreStorage } from '../../../apps/core/src/types.ts'
import type { Result } from '../../../packages/common/src/result.ts'
import type { CoreDependencies, ServiceSummary } from '../../../packages/contracts/src/index.ts'
import { serviceUrl } from '../../../packages/internal-http/src/index.ts'

type FetchInput = Parameters<typeof fetch>[0]
type FetchInit = Parameters<typeof fetch>[1]
type InternalRuntimeService = 'm-policy' | 'm-log' | 'm-eventbus' | 'm-net'
type RuntimeProbeState = { health: boolean; ready: boolean }

const originalFetch: typeof globalThis.fetch = globalThis.fetch
const originalInternalToken = process.env.MERISTEM_INTERNAL_TOKEN
const internalServices: InternalRuntimeService[] = ['m-policy', 'm-log', 'm-eventbus', 'm-net']

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalInternalToken === undefined) delete process.env.MERISTEM_INTERNAL_TOKEN
  else process.env.MERISTEM_INTERNAL_TOKEN = originalInternalToken
})

function readyDependencies(overrides: Partial<CoreDependencies> = {}): CoreDependencies {
  return {
    postgres: 'ready',
    nats: 'ready',
    'm-policy': 'ready',
    'm-log': 'ready',
    'm-eventbus': 'ready',
    'm-net': 'ready',
    ...overrides
  }
}

function setFetchMock(handler: (url: string, init?: FetchInit) => Response | Promise<Response>) {
  const mockedFetch: typeof globalThis.fetch = Object.assign(
    async (input: FetchInput, init?: FetchInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      return handler(url, init)
    },
    { preconnect: originalFetch.preconnect }
  )

  globalThis.fetch = mockedFetch
}

function installInternalFetchMock(
  options: {
    runtimeByService?: Partial<Record<InternalRuntimeService, Partial<RuntimeProbeState>>>
    reloadResponse?: { status?: number; body: unknown }
  } = {}
) {
  process.env.MERISTEM_INTERNAL_TOKEN = 'test-internal-token'

  const runtimeByService: Record<InternalRuntimeService, RuntimeProbeState> = {
    'm-policy': { health: true, ready: true, ...options.runtimeByService?.['m-policy'] },
    'm-log': { health: true, ready: true, ...options.runtimeByService?.['m-log'] },
    'm-eventbus': { health: true, ready: true, ...options.runtimeByService?.['m-eventbus'] },
    'm-net': { health: true, ready: true, ...options.runtimeByService?.['m-net'] }
  }

  setFetchMock(async (url, init) => {
    for (const service of internalServices) {
      const state = runtimeByService[service]
      if (url === `${serviceUrl(service)}/health`) {
        return new Response(null, { status: state.health ? 200 : 503 })
      }
      if (url === `${serviceUrl(service)}/ready`) {
        return Response.json({ ready: state.ready }, { status: state.ready ? 200 : 503 })
      }
    }

    if (url === `${serviceUrl('m-log')}/internal/v0/lifecycle/reload` && init?.method === 'POST') {
      const response = options.reloadResponse ?? {
        body: {
          ok: true,
          serviceId: 'm-log',
          reloadedAt: '2026-06-18T08:00:00.000Z'
        }
      }
      return Response.json(response.body, { status: response.status ?? 200 })
    }

    throw new Error(`unexpected fetch ${url}`)
  })
}

function createStorage(rows: unknown[]): CoreStorage {
  return {
    readiness: async () => readyDependencies(),
    counts: async () => ({ services: rows.length, nodes: 0, tasks: 0 }),
    registerNode: async () => {
      throw new Error('registerNode not used in service lifecycle tests')
    },
    createNodeTicket: async () => {
      throw new Error('createNodeTicket not used in service lifecycle tests')
    },
    issueNodeCredential: async () => {
      throw new Error('issueNodeCredential not used in service lifecycle tests')
    },
    hasActiveNodeCredential: async () => {
      throw new Error('hasActiveNodeCredential not used in service lifecycle tests')
    },
    validateNodeCredential: async () => {
      throw new Error('validateNodeCredential not used in service lifecycle tests')
    },
    listNodes: async () => {
      throw new Error('listNodes not used in service lifecycle tests')
    },
    getNode: async () => {
      throw new Error('getNode not used in service lifecycle tests')
    },
    registerService: async input => input,
    listServices: async () => rows
  }
}

function createPort(
  options: {
    rows?: unknown[]
    dependencies?: CoreDependencies
    runtimeByService?: Partial<Record<InternalRuntimeService, Partial<RuntimeProbeState>>>
    reloadResponse?: { status?: number; body: unknown }
  } = {}
) {
  installInternalFetchMock({
    runtimeByService: options.runtimeByService,
    reloadResponse: options.reloadResponse
  })

  return createServiceLifecyclePort(
    createStorage(options.rows ?? []),
    async () => options.dependencies ?? readyDependencies()
  )
}

function expectOk<T, E>(result: Result<T, E>): T {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('expected ok result')
  return result.value
}

function expectErr<T, E>(result: Result<T, E>): E {
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('expected error result')
  return result.error
}

function findService(services: ServiceSummary[], id: string): ServiceSummary {
  const service = services.find(candidate => candidate.id === id)
  expect(service).toBeDefined()
  if (!service) throw new Error(`expected service ${id}`)
  return service
}

describe('dependencyStateFromReady', () => {
  it('returns ready when the ready probe succeeds', async () => {
    process.env.MERISTEM_INTERNAL_TOKEN = 'test-internal-token'
    setFetchMock(async () => Response.json({ ready: true }))

    await expect(dependencyStateFromReady('http://mock-service/ready')).resolves.toBe('ready')
  })

  it('returns unavailable when the ready probe fails or throws', async () => {
    process.env.MERISTEM_INTERNAL_TOKEN = 'test-internal-token'
    setFetchMock(async url => {
      if (url.endsWith('/throw')) throw new Error('boom')
      return Response.json({ ready: false }, { status: 503 })
    })

    await expect(dependencyStateFromReady('http://mock-service/not-ready')).resolves.toBe(
      'unavailable'
    )
    await expect(dependencyStateFromReady('http://mock-service/throw')).resolves.toBe('unavailable')
  })
})

describe('createServiceLifecyclePort', () => {
  it('lists builtin services with a normal core runtime when dependencies are ready', async () => {
    const services = expectOk(await createPort().list())

    expect(services).toHaveLength(5)
    expect(findService(services, 'meristem-core').runtime).toEqual({
      liveness: true,
      readiness: true,
      mode: 'normal'
    })
  })

  it('marks the core runtime degraded when a required dependency is unavailable', async () => {
    const services = expectOk(
      await createPort({ dependencies: readyDependencies({ postgres: 'unavailable' }) }).list()
    )
    const core = findService(services, 'meristem-core')

    expect(core.runtime?.liveness).toBe(true)
    expect(core.runtime?.readiness).toBe(false)
    expect(core.runtime?.mode).toBe('degraded')
    expect(core.runtime?.lastError).toBe('one or more required dependencies are unavailable')
  })

  it('uses separate health and ready probes for builtin internal services', async () => {
    const services = expectOk(
      await createPort({
        runtimeByService: {
          'm-policy': { health: false, ready: true },
          'm-log': { health: true, ready: false }
        }
      }).list()
    )

    expect(findService(services, 'm-policy').runtime).toEqual({
      liveness: false,
      readiness: true,
      mode: 'normal'
    })
    expect(findService(services, 'm-log').runtime).toEqual({
      liveness: true,
      readiness: false,
      mode: 'degraded',
      lastError: 'service is not ready'
    })
  })

  it('includes valid dynamic service definitions', async () => {
    const services = expectOk(
      await createPort({
        rows: [{ id: 'm-ui-bff', version: '0.1.0', domain: 'm-ui', kind: 'bff' }]
      }).list()
    )
    const dynamic = findService(services, 'm-ui-bff')

    expect(dynamic.domain).toBe('m-ui')
    expect(dynamic.kind).toBe('bff')
    expect(dynamic.lifecycle).toEqual({
      reloadable: false,
      rollbackable: false,
      degradable: true
    })
    expect(dynamic.runtime).toEqual({
      liveness: false,
      readiness: false,
      mode: 'degraded',
      lastError: 'runtime state is not exposed for this service definition'
    })
  })

  it('normalizes the legacy service kind to internal', async () => {
    const services = expectOk(
      await createPort({
        rows: [{ id: 'legacy-adapter', version: '0.1.0', domain: 'm-extension', kind: 'service' }]
      }).list()
    )

    expect(findService(services, 'legacy-adapter').kind).toBe('internal')
  })

  it('filters invalid rows and builtin duplicates from dynamic services', async () => {
    const services = expectOk(
      await createPort({
        rows: [
          null,
          42,
          { id: 'bad-domain', version: '0.1.0', domain: 'm-task', kind: 'internal' },
          { id: 'bad-kind', version: '0.1.0', domain: 'm-ui', kind: 'worker' },
          { id: 'meristem-core', version: '9.9.9', domain: 'm-ui', kind: 'bff' }
        ]
      }).list()
    )

    expect(services).toHaveLength(5)
    expect(services.some(service => service.id === 'bad-domain')).toBe(false)
    expect(services.some(service => service.id === 'bad-kind')).toBe(false)
    expect(services.filter(service => service.id === 'meristem-core')).toHaveLength(1)
  })

  it('gates reloads for non-reloadable and unknown services', async () => {
    const port = createPort({
      rows: [{ id: 'plugin-a', version: '0.1.0', domain: 'm-extension', kind: 'extension' }]
    })

    expect(
      expectErr(await port.reload({ serviceId: 'meristem-core', correlationId: 'c-1' }))
    ).toEqual({ code: 'service.not_reloadable', message: 'service is not reloadable' })
    expect(expectErr(await port.reload({ serviceId: 'plugin-a', correlationId: 'c-2' }))).toEqual({
      code: 'service.not_reloadable',
      message: 'service is not reloadable'
    })
    expect(expectErr(await port.reload({ serviceId: 'missing', correlationId: 'c-3' }))).toEqual({
      code: 'service.not_found',
      message: 'service not found'
    })
  })

  it('forwards the successful m-log reload response', async () => {
    const result = expectOk(
      await createPort({
        reloadResponse: {
          body: {
            ok: true,
            serviceId: 'm-log',
            reloadedAt: '2026-06-18T08:00:00.000Z'
          }
        }
      }).reload({
        serviceId: 'm-log',
        correlationId: 'corr-1',
        reason: 'rotate log sinks'
      })
    )

    expect(result).toEqual({
      serviceId: 'm-log',
      reloadedAt: '2026-06-18T08:00:00.000Z'
    })
  })
})
