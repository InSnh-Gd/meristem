import { internalServicePorts } from '../../../packages/internal-http/src/index.ts'
import { initTelemetry, shutdownTelemetry } from '../../../packages/telemetry/src/index.ts'
import type { ControllerTrustConfig, MDeployHostAdapters } from './production.ts'
import { serveProductionMDeployApp } from './startup.ts'

type MDeployProductionHost = {
  readonly host: MDeployHostAdapters
  readonly controllerTrust: ControllerTrustConfig
}

type HostAdapterModule = {
  createMDeployProductionHost(env: NodeJS.ProcessEnv): Promise<unknown> | unknown
}

type ModuleImporter = (specifier: string) => Promise<unknown>

function hasFunction(value: unknown): value is (...args: readonly unknown[]) => unknown {
  return typeof value === 'function'
}

function isHostAdapterModule(value: unknown): value is HostAdapterModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    hasFunction(Reflect.get(value, 'createMDeployProductionHost'))
  )
}

function isMDeployHostAdapters(value: unknown): value is MDeployHostAdapters {
  if (typeof value !== 'object' || value === null) return false
  const git = Reflect.get(value, 'git')
  const agentIdentity = Reflect.get(value, 'agentIdentity')
  const controller = Reflect.get(value, 'controller')
  const runtime = Reflect.get(value, 'runtime')
  const infrastructureDriverEffects = Reflect.get(value, 'infrastructureDriverEffects')
  return (
    typeof git === 'object' &&
    git !== null &&
    hasFunction(Reflect.get(git, 'fetchSignedEnvelope')) &&
    typeof agentIdentity === 'object' &&
    agentIdentity !== null &&
    hasFunction(Reflect.get(agentIdentity, 'verifyEnrollment')) &&
    typeof controller === 'object' &&
    controller !== null &&
    hasFunction(Reflect.get(controller, 'isAvailable')) &&
    (runtime !== undefined || infrastructureDriverEffects !== undefined)
  )
}

function isControllerTrustConfig(value: unknown): value is ControllerTrustConfig {
  if (typeof value !== 'object' || value === null) return false
  return (
    typeof Reflect.get(value, 'publicKeyRef') === 'object' &&
    Reflect.get(value, 'publicKeyRef') !== null &&
    typeof Reflect.get(value, 'issuer') === 'string' &&
    typeof Reflect.get(value, 'audience') === 'string' &&
    typeof Reflect.get(value, 'publicKeyFingerprint') === 'string'
  )
}

function isMDeployProductionHost(value: unknown): value is MDeployProductionHost {
  if (typeof value !== 'object' || value === null) return false
  return (
    isMDeployHostAdapters(Reflect.get(value, 'host')) &&
    isControllerTrustConfig(Reflect.get(value, 'controllerTrust'))
  )
}

/** 加载部署包提供的 host adapter；镜像本身不得伪造 Git、agent 或 runtime 权限。 */
export async function loadMDeployProductionHost(
  env: NodeJS.ProcessEnv = process.env,
  importModule: ModuleImporter = specifier => import(specifier)
): Promise<MDeployProductionHost> {
  const modulePath = env.MERISTEM_MDEPLOY_HOST_ADAPTER_MODULE
  if (!modulePath) {
    throw new Error(
      'mdeploy.host_adapter_module_missing: MERISTEM_MDEPLOY_HOST_ADAPTER_MODULE is required for the serving runtime'
    )
  }

  let loaded: unknown
  try {
    loaded = await importModule(modulePath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`mdeploy.host_adapter_module_load_failed: ${message}`)
  }
  if (!isHostAdapterModule(loaded)) {
    throw new Error(
      'mdeploy.host_adapter_module_invalid: module must export createMDeployProductionHost(env)'
    )
  }

  const productionHost = await loaded.createMDeployProductionHost(env)
  if (!isMDeployProductionHost(productionHost)) {
    throw new Error(
      'mdeploy.host_adapter_module_invalid: production host must provide adapters and controller trust'
    )
  }
  return productionHost
}

/** 启动真实 M-Deploy HTTP 服务；缺少 host adapter、配置或 SecretRef 时必须在 admission 前失败。 */
export async function startMDeployProductionService(
  env: NodeJS.ProcessEnv = process.env,
  importModule?: ModuleImporter
) {
  const productionHost = await loadMDeployProductionHost(env, importModule)
  return serveProductionMDeployApp({
    ...productionHost,
    env
  })
}

if (import.meta.main) {
  initTelemetry('m-deploy')
  const server = await startMDeployProductionService()
  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    void server
      .stop()
      .then(() => shutdownTelemetry())
      .then(() => process.exit(0))
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  console.log(`m-deploy listening on http://127.0.0.1:${internalServicePorts['m-deploy']}`)
}
