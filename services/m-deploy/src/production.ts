import { createSharedAuthVerifier } from '../../../packages/auth/src/index.ts'
import {
  loadRuntimeDeploymentConfigOrThrow,
  type RuntimeDeploymentConfig
} from '../../../packages/config/src/index.ts'
import type { SecretRefFromSchema } from '../../../packages/contracts/src/index.ts'
import { createDb } from '../../../packages/db/src/client.ts'
import {
  createSecretManagerFromConfigs,
  type SecretManager
} from '../../../packages/secrets/src/index.ts'
import type { MDeployDeps } from './deps.ts'
import {
  createMDeployInfrastructureAgentAdapter,
  createPodmanRuntimeDriver
} from './infrastructure-driver-adapters.ts'
import type {
  MDeployDriverEffects,
  MDeployInfrastructureAgentAdapterOptions
} from './infrastructure-driver-types.ts'
import { createPostgresMDeployStore } from './postgres-store.ts'
import { createProductionMDeployBoundaryAdapters } from './production-adapters.ts'
import { createTrustedEnvelopeVerifier } from './trusted-envelope-verifier.ts'

type MDeployHostAdapterBase = Pick<MDeployDeps, 'git' | 'agentIdentity' | 'controller'>

type MDeployHostAdapters =
  | (MDeployHostAdapterBase & {
      runtime: MDeployDeps['runtime']
      infrastructureDriverEffects?: never
    })
  | (MDeployHostAdapterBase & {
      runtime?: never
      infrastructureDriverEffects: MDeployDriverEffects
    })

type ControllerTrustConfig = {
  publicKeyRef: SecretRefFromSchema
  issuer: string
  audience: string
  publicKeyFingerprint: string
}

type ProductionMDeployOptions = {
  host: MDeployHostAdapters
  controllerTrust: ControllerTrustConfig
  runtimeConfig?: RuntimeDeploymentConfig
  databaseUrl?: string
  secretManager?: SecretManager
  fetchImpl?: typeof fetch
  now?: () => string
  snapshotTtlMs?: number
  approvalTtlMs?: number
  infrastructure?: MDeployInfrastructureAgentAdapterOptions
  env?: NodeJS.ProcessEnv
}

type ProductionMDeployComposition = {
  deps: MDeployDeps
  close(): Promise<void>
}

function requiredJwtSecret(env: NodeJS.ProcessEnv): string {
  const secret = env.MERISTEM_JWT_SECRET
  if (!secret) throw new Error('MERISTEM_JWT_SECRET is required for local-dev auth')
  return secret
}

function createRuntimeSecretManager(config: RuntimeDeploymentConfig, env: NodeJS.ProcessEnv) {
  const named = config.secretProvider.namedProvider
  return createSecretManagerFromConfigs({
    providers: [{ name: named.name, config: named.config }],
    ...(named.cache ? { cache: named.cache } : {}),
    env
  })
}

/**
 * 生产包必须显式提供直接 runtime 或本地 driver effects；这里仅连接 agent 本机边界，绝不创建 SSH 推送路径。
 */
export function resolveMDeployRuntimeAdapter(host: MDeployHostAdapters): MDeployDeps['runtime'] {
  return host.runtime ?? createPodmanRuntimeDriver(host.infrastructureDriverEffects)
}

/** 仅在部署包显式提供本地 IaC/health/drift 输入时启用基础设施检查边界。 */
export function resolveMDeployInfrastructureAdapter(
  options: Pick<ProductionMDeployOptions, 'infrastructure'>
): MDeployDeps['infrastructure'] {
  return options.infrastructure
    ? createMDeployInfrastructureAgentAdapter(options.infrastructure)
    : undefined
}

/** Named production composition: durable state plus real Meristem authority adapters. */
export async function createProductionMDeployComposition(
  options: ProductionMDeployOptions
): Promise<ProductionMDeployComposition> {
  const env = options.env ?? process.env
  const runtimeConfig = options.runtimeConfig ?? (await loadRuntimeDeploymentConfigOrThrow({ env }))
  const authVerifier = createSharedAuthVerifier(
    runtimeConfig.auth.provider === 'local-dev'
      ? { auth: runtimeConfig.auth, localDev: { jwtSecret: requiredJwtSecret(env) } }
      : { auth: runtimeConfig.auth }
  )
  const secretManager = options.secretManager ?? createRuntimeSecretManager(runtimeConfig, env)
  const { db, client } = createDb(options.databaseUrl)
  const now = options.now ?? (() => new Date().toISOString())
  const boundary = createProductionMDeployBoundaryAdapters({
    urls: {
      policy: runtimeConfig.raw.serviceUrls.policy,
      log: runtimeConfig.raw.serviceUrls.log,
      eventbus: runtimeConfig.raw.serviceUrls.eventbus
    },
    authVerifier,
    secretManager,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    now,
    ...(options.approvalTtlMs ? { approvalTtlMs: options.approvalTtlMs } : {})
  })
  const runtime = resolveMDeployRuntimeAdapter(options.host)
  const infrastructure = resolveMDeployInfrastructureAdapter(options)
  const deps: MDeployDeps = {
    ...boundary,
    git: options.host.git,
    agentIdentity: options.host.agentIdentity,
    controller: options.host.controller,
    runtime,
    ...(infrastructure ? { infrastructure } : {}),
    store: createPostgresMDeployStore(db),
    envelopeVerifier: createTrustedEnvelopeVerifier({
      secretManager,
      ...options.controllerTrust,
      now
    }),
    now,
    snapshotTtlMs: options.snapshotTtlMs ?? 15 * 60 * 1000
  }
  return {
    deps,
    async close() {
      await client.end()
    }
  }
}

export type {
  ControllerTrustConfig,
  MDeployHostAdapters,
  ProductionMDeployComposition,
  ProductionMDeployOptions
}
