import { edenTreaty } from '@elysiajs/eden'
import { err, ok } from '../../../../packages/common/src/result.ts'
import type { CoreDependencies, ServiceSummary } from '../../../../packages/contracts/src/index.ts'
import { fetchReadyState, serviceUrl } from '../../../../packages/internal-http/src/index.ts'
import type { LogApp } from '../../../../services/m-log/src/app.ts'
import type { CoreStorage } from '../types.ts'
import { createInternalFetcher, errorMessageFromHttpResponse } from '../effect-helpers.ts'

type BuiltinServiceDefinition = Pick<ServiceSummary, 'id' | 'version' | 'domain' | 'kind' | 'lifecycle'>
type DynamicServiceRow = { id: string; version: string; domain: string; kind: string }

// 这组内建服务是 MVP 运行态聚合的固定骨架，动态服务定义只会在此基础上补充。
const builtinServices: BuiltinServiceDefinition[] = [
  {
    id: 'meristem-core',
    version: '0.1.0',
    domain: 'core',
    kind: 'core',
    lifecycle: { reloadable: false, rollbackable: false, degradable: true }
  },
  {
    id: 'm-policy',
    version: '0.1.0',
    domain: 'm-policy',
    kind: 'internal',
    lifecycle: { reloadable: false, rollbackable: false, degradable: true }
  },
  {
    id: 'm-log',
    version: '0.1.0',
    domain: 'm-log',
    kind: 'internal',
    lifecycle: { reloadable: true, rollbackable: false, degradable: true }
  },
  {
    id: 'm-eventbus',
    version: '0.1.0',
    domain: 'm-eventbus',
    kind: 'internal',
    lifecycle: { reloadable: false, rollbackable: false, degradable: true }
  },
  {
    id: 'm-net',
    version: '0.1.0',
    domain: 'm-net',
    kind: 'internal',
    lifecycle: { reloadable: false, rollbackable: false, degradable: true }
  }
]

export async function dependencyStateFromReady(url: string): Promise<'ready' | 'unavailable'> {
  return (await fetchReadyState(url)) ? 'ready' : 'unavailable'
}

/**
 * health 探测只判断进程是否响应，不把 ready 语义混到这里。
 */
async function fetchHealthState(url: string): Promise<boolean> {
  try {
    const response = await createInternalFetcher()(url, { method: 'GET' })
    return response.ok
  } catch {
    return false
  }
}

function isServiceDomain(value: string): value is ServiceSummary['domain'] {
  return value === 'core'
    || value === 'm-net'
    || value === 'm-eventbus'
    || value === 'm-log'
    || value === 'm-policy'
    || value === 'm-ui'
    || value === 'm-cli'
    || value === 'm-extension'
}

function isServiceKind(value: string): value is ServiceSummary['kind'] {
  return value === 'core'
    || value === 'internal'
    || value === 'node'
    || value === 'task'
    || value === 'extension'
    || value === 'bff'
}

/**
 * 兼容旧草稿里的通用 `service` kind；运行态摘要仍收敛到文档约定的 `internal`。
 */
function normalizeServiceKind(value: string): ServiceSummary['kind'] | null {
  if (value === 'service') return 'internal'
  return isServiceKind(value) ? value : null
}

function normalizeDynamicServiceRow(row: unknown): DynamicServiceRow | null {
  if (typeof row !== 'object' || row === null) return null
  const id = Reflect.get(row, 'id')
  const version = Reflect.get(row, 'version')
  const domain = Reflect.get(row, 'domain')
  const kind = Reflect.get(row, 'kind')
  return typeof id === 'string'
    && typeof version === 'string'
    && typeof domain === 'string'
    && typeof kind === 'string'
    ? { id, version, domain, kind }
    : null
}

/**
 * Core 运行态由 required dependencies 聚合而来；任何一个依赖掉线都让 Core 进入 degraded。
 */
function coreRuntimeFromDependencies(dependencies: CoreDependencies): NonNullable<ServiceSummary['runtime']> {
  const dependencyStates = Object.values(dependencies)
  const ready = dependencyStates.every((state) => state === 'ready')
  return ready
    ? { liveness: true, readiness: true, mode: 'normal' }
    : {
        liveness: true,
        readiness: false,
        mode: 'degraded',
        lastError: 'one or more required dependencies are unavailable'
      }
}

/**
 * 内部服务运行态一律通过 /health + /ready 实时探测，而不是缓存某次启动时的结论。
 */
async function runtimeFromInternalReadiness(
  name: 'm-policy' | 'm-log' | 'm-eventbus' | 'm-net'
): Promise<NonNullable<ServiceSummary['runtime']>> {
  const [liveness, readiness] = await Promise.all([
    fetchHealthState(`${serviceUrl(name)}/health`),
    fetchReadyState(`${serviceUrl(name)}/ready`)
  ])
  return readiness
    ? { liveness, readiness: true, mode: 'normal' }
    : {
        liveness,
        readiness: false,
        mode: 'degraded',
        lastError: 'service is not ready'
      }
}

function dynamicServiceSummary(row: DynamicServiceRow): ServiceSummary | null {
  const kind = normalizeServiceKind(row.kind)
  if (!isServiceDomain(row.domain) || kind === null) return null
  return {
    id: row.id,
    version: row.version,
    domain: row.domain,
    kind,
    lifecycle: { reloadable: false, rollbackable: false, degradable: true },
    runtime: {
      liveness: false,
      readiness: false,
      mode: 'degraded',
      lastError: 'runtime state is not exposed for this service definition'
    }
  }
}

export function createServiceLifecyclePort(storage: CoreStorage, readinessChecks: () => Promise<CoreDependencies>) {
  const client = edenTreaty<LogApp>(serviceUrl('m-log'), { fetcher: createInternalFetcher() })
  const lifecycleRoutes = client.internal.v0.lifecycle as {
    reload: {
      post(input: { correlationId?: string; reason?: string }): Promise<{
        data: { ok: true; serviceId: string; reloadedAt: string } | null
        error: { value: unknown; status: number } | null
        status: number
      }>
    }
  }

  return {
    async list() {
      try {
        // service list 既展示静态定义，也补齐当前实时运行态，供 CLI 和后续 UI 直接消费。
        const [dependencies, rows, policyRuntime, logRuntime, eventBusRuntime, mNetRuntime] = await Promise.all([
          readinessChecks(),
          storage.listServices(),
          runtimeFromInternalReadiness('m-policy'),
          runtimeFromInternalReadiness('m-log'),
          runtimeFromInternalReadiness('m-eventbus'),
          runtimeFromInternalReadiness('m-net')
        ])
        const builtinRuntimeById = new Map<string, ServiceSummary>(
          builtinServices.map((service) => {
            if (service.id === 'meristem-core') return [service.id, { ...service, runtime: coreRuntimeFromDependencies(dependencies) }]
            if (service.id === 'm-policy') return [service.id, { ...service, runtime: policyRuntime }]
            if (service.id === 'm-log') return [service.id, { ...service, runtime: logRuntime }]
            if (service.id === 'm-eventbus') return [service.id, { ...service, runtime: eventBusRuntime }]
            return [service.id, { ...service, runtime: mNetRuntime }]
          })
        )
        const dynamicServices = rows
          .map(normalizeDynamicServiceRow)
          .flatMap((row) => row ? [row] : [])
          .filter((row) => !builtinRuntimeById.has(row.id))
          .map(dynamicServiceSummary)
          .flatMap((service) => service ? [service] : [])
        return ok([...builtinRuntimeById.values(), ...dynamicServices])
      } catch {
        return err({ code: 'service.unavailable', message: 'service lifecycle unavailable' })
      }
    },
    async reload(input: { serviceId: string; correlationId: string; reason?: string }) {
      // 当前只有 m-log 具备 reload 原型，其它服务要么不可 reload，要么尚未暴露该能力。
      const builtinService = builtinServices.find((service) => service.id === input.serviceId)
      if (builtinService && !builtinService.lifecycle.reloadable) {
        return err({ code: 'service.not_reloadable', message: 'service is not reloadable' })
      }

      if (builtinService?.id === 'm-log') {
        try {
          const response = await lifecycleRoutes.reload.post({
            correlationId: input.correlationId,
            ...(input.reason ? { reason: input.reason } : {})
          })
          if (response.error || !response.data) {
            return err({
              code: 'service.unavailable',
              message: errorMessageFromHttpResponse(response.error?.value, 'service reload failed')
            })
          }
          return ok({
            serviceId: response.data.serviceId,
            reloadedAt: response.data.reloadedAt
          })
        } catch {
          return err({ code: 'service.unavailable', message: 'service reload failed' })
        }
      }

      try {
        const serviceExists = (await storage.listServices())
          .map(normalizeDynamicServiceRow)
          .some((row) => row?.id === input.serviceId)
        return serviceExists
          ? err({ code: 'service.not_reloadable', message: 'service is not reloadable' })
          : err({ code: 'service.not_found', message: 'service not found' })
      } catch {
        return err({ code: 'service.unavailable', message: 'service lifecycle unavailable' })
      }
    }
  }
}

