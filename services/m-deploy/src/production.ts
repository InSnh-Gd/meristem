import { createSharedAuthVerifier } from '../../../packages/auth/src/index.ts'
import {
  loadRuntimeDeploymentConfigOrThrow,
  type RuntimeDeploymentConfig
} from '../../../packages/config/src/index.ts'
import type { SecretRefFromSchema } from '../../../packages/contracts/src/index.ts'
import { createDb } from '../../../packages/db/src/client.ts'
import { createSecretManagerFromConfigs, type SecretManager } from '../../../packages/secrets/src/index.ts'
import type { ServedInternalApp } from '../../../packages/internal-http/src/index.ts'
import { serveMDeployApp } from './app.ts'
import type { MDeployDeps } from './deps.ts'
import { createPostgresMDeployStore } from './postgres-store.ts'
import { createProductionMDeployBoundaryAdapters } from './production-adapters.ts'
import { createTrustedEnvelopeVerifier } from './trusted-envelope-verifier.ts'

type MDeployHostAdapters = Pick<MDeployDeps, 'git' | 'agentIdentity' | 'runtime' | 'controller'>

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
  const deps: MDeployDeps = {
    ...boundary,
    ...options.host,
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

/** Starts M-Deploy from production configuration and closes its PostgreSQL pool with the server. */
export async function serveProductionMDeployApp(
  options: ProductionMDeployOptions
): Promise<ServedInternalApp> {
  const composition = await createProductionMDeployComposition(options)
  const server = serveMDeployApp(composition.deps)
  return {
    ...server,
    async stop() {
      await server.stop()
      await composition.close()
    }
  }
}

export type {
  ControllerTrustConfig,
  MDeployHostAdapters,
  ProductionMDeployComposition,
  ProductionMDeployOptions
}
