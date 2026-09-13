/**
 * v02 deploy proof 的 context 准备与基础设施拉起（从 v02-deploy-proof.ts 拆出，行为不变）。
 */
import { existsSync, mkdirSync } from 'node:fs'
import {
  createRuntimeSecretManager,
  resolveCoreOidcStartupSecrets
} from '../apps/core/src/adapters.ts'
import { RUNTIME_DEPLOYMENT_CONFIG_ENV } from '../packages/config/src/index.ts'
import { resolveDeploymentSecretBindings } from '../packages/secrets/src/index.ts'
import { keycloakClientSecretEnvVar } from './keycloak-dev-realm.ts'
import {
  buildDeploymentConfig,
  failure,
  finalizeReport,
  normalizeEnv,
  prerequisiteMissing,
  proofPaths,
  success
} from './v02-deploy-proof-support.ts'
import type {
  DeployAuthMode,
  DeployProofDeps,
  DeployProofReport,
  DeployProofResult,
  DeployTarget,
  ManagedServiceDefinition,
  ManagedServiceName,
  PreparedContext,
  ServiceEvidence
} from './v02-deploy-proof-types.ts'

export async function prepareContext(
  target: DeployTarget,
  authMode: DeployAuthMode,
  results: DeployProofResult[],
  services: Partial<Record<ManagedServiceName, ServiceEvidence>>,
  deps: DeployProofDeps
): Promise<PreparedContext | DeployProofReport> {
  const paths = proofPaths(target, authMode)
  mkdirSync(paths.workspaceDir, { recursive: true })
  mkdirSync(paths.logDir, { recursive: true })
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

  const keycloak = await deps.ensureKeycloakDevRealm()
  if (!keycloak.ok) {
    const report = prerequisiteMissing(
      'keycloak.start',
      keycloak.step,
      keycloak.message,
      'Keycloak dev realm is required for deploy proof orchestration'
    )
    results.push(report)
    services.keycloak = {
      status: 'prerequisite-missing',
      detail: keycloak.message
    }
    return finalizeReport(target, authMode, paths.deploymentConfigPath, null, services, results)
  }

  services.keycloak = {
    status: keycloak.startedNow ? 'started' : 'reused',
    detail: `${keycloak.realm.runtime}:${keycloak.realm.hostPort}`,
    endpoint: keycloak.realm.discoveryUrl
  }
  results.push(success('keycloak.start', `${keycloak.realm.runtime}:${keycloak.realm.hostPort}`))

  const discoveryResponse = await fetch(keycloak.realm.discoveryUrl)
  if (!discoveryResponse.ok) {
    results.push(
      failure(
        'keycloak.discovery',
        'keycloak.discovery_unreachable',
        'Keycloak discovery endpoint did not become reachable',
        `HTTP ${discoveryResponse.status}`
      )
    )
    return finalizeReport(target, authMode, paths.deploymentConfigPath, null, services, results)
  }
  results.push(success('keycloak.discovery', keycloak.realm.discoveryUrl))

  const jwksResponse = await fetch(keycloak.realm.jwksUrl)
  const jwksPayload = (await jwksResponse.json().catch(() => null)) as {
    keys?: readonly unknown[]
  } | null
  if (!jwksResponse.ok || !Array.isArray(jwksPayload?.keys) || jwksPayload.keys.length === 0) {
    results.push(
      failure(
        'keycloak.jwks',
        'keycloak.jwks_unreachable',
        'Keycloak JWKS endpoint returned no signing keys',
        `HTTP ${jwksResponse.status}`
      )
    )
    return finalizeReport(target, authMode, paths.deploymentConfigPath, null, services, results)
  }
  results.push(success('keycloak.jwks', `${jwksPayload.keys.length} signing key(s)`))

  const deploymentConfig = buildDeploymentConfig(
    keycloak.realm,
    target,
    authMode,
    paths.runtimeStatePath
  )
  await deps.writeTextFile(
    paths.deploymentConfigPath,
    `${JSON.stringify(deploymentConfig, null, 2)}\n`
  )

  const sharedEnv = {
    ...normalizeEnv(process.env),
    [RUNTIME_DEPLOYMENT_CONFIG_ENV]: paths.deploymentConfigPath,
    [keycloakClientSecretEnvVar]: keycloak.realm.clientSecret,
    DATABASE_URL:
      process.env.DATABASE_URL ?? 'postgres://meristem:meristem@localhost:55432/meristem',
    MERISTEM_AGENT_HEARTBEAT_INTERVAL_MS: process.env.MERISTEM_AGENT_HEARTBEAT_INTERVAL_MS ?? '500',
    MERISTEM_AGENT_HEARTBEAT_TIMEOUT_MS: process.env.MERISTEM_AGENT_HEARTBEAT_TIMEOUT_MS ?? '2000',
    MERISTEM_AGENT_TASK_TIMEOUT_MS: process.env.MERISTEM_AGENT_TASK_TIMEOUT_MS ?? '2000',
    MERISTEM_CORE_HOST: '127.0.0.1',
    MERISTEM_CORE_URL: 'http://127.0.0.1:3000',
    MERISTEM_EVENTBUS_URL: 'http://127.0.0.1:3103',
    MERISTEM_EXTENSION_URL: 'http://127.0.0.1:3106',
    MERISTEM_INTERNAL_TOKEN: process.env.MERISTEM_INTERNAL_TOKEN ?? 'deploy-proof-internal-token',
    MERISTEM_JOIN_PUBLIC_URL: 'https://127.0.0.1:8443',
    MERISTEM_JOIN_URL: 'wss://127.0.0.1:8443/join/v0/session',
    MERISTEM_JWT_SECRET: process.env.MERISTEM_JWT_SECRET ?? 'deploy-proof-jwt-secret-32-characters',
    MERISTEM_MNET_CONTROL_URL: 'http://127.0.0.1:3104',
    MERISTEM_MNET_URL: 'http://127.0.0.1:3104',
    MERISTEM_NODE_RUNTIME_STATE_PATH: paths.runtimeStatePath,
    MERISTEM_POLICY_URL: 'http://127.0.0.1:3101',
    MERISTEM_TASK_URL: 'http://127.0.0.1:3105',
    MERISTEM_BFF_PORT: '3200',
    NATS_URL: process.env.NATS_URL ?? 'ws://localhost:4223',
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
    NO_PROXY: '127.0.0.1,localhost',
    PORT: '3000'
  }
  Object.assign(process.env, sharedEnv)

  const runtimeConfigResult = await deps.loadRuntimeDeploymentConfig(
    { [RUNTIME_DEPLOYMENT_CONFIG_ENV]: paths.deploymentConfigPath },
    deps.readTextFile
  )
  if (!runtimeConfigResult.ok) {
    results.push(
      failure(
        'deployment-config.load',
        runtimeConfigResult.error.code,
        runtimeConfigResult.error.message
      )
    )
    return finalizeReport(target, authMode, paths.deploymentConfigPath, null, services, results)
  }
  results.push(success('deployment-config.load', runtimeConfigResult.value.deploymentTarget))

  if (!runtimeConfigResult.value.raw.nodeAgentCapabilities.netAdmin) {
    results.push(
      prerequisiteMissing(
        'node-agent.capability',
        'node-agent.net_admin_disabled',
        'Deployment config does not declare CAP_NET_ADMIN for node-agent runtime'
      )
    )
    return finalizeReport(
      target,
      authMode,
      paths.deploymentConfigPath,
      runtimeConfigResult.value,
      services,
      results
    )
  }

  if (!deps.hasCapNetAdmin()) {
    results.push(
      prerequisiteMissing(
        'node-agent.capability',
        'node-agent.cap_net_admin_missing',
        'Current shell does not carry CAP_NET_ADMIN required by node-agent host capability checks'
      )
    )
    return finalizeReport(
      target,
      authMode,
      paths.deploymentConfigPath,
      runtimeConfigResult.value,
      services,
      results
    )
  }

  const wgVersion = deps.runVersionCommand([
    runtimeConfigResult.value.raw.nodeAgentCapabilities.wgBinaryPath,
    '--version'
  ])
  if (wgVersion.exitCode !== 0) {
    results.push(
      prerequisiteMissing(
        'node-agent.wg',
        'node-agent.wg_missing',
        'Configured WireGuard binary is not executable',
        runtimeConfigResult.value.raw.nodeAgentCapabilities.wgBinaryPath
      )
    )
    return finalizeReport(
      target,
      authMode,
      paths.deploymentConfigPath,
      runtimeConfigResult.value,
      services,
      results
    )
  }
  results.push(success('node-agent.wg', wgVersion.stdout || wgVersion.stderr))

  if (!existsSync(runtimeConfigResult.value.raw.nodeAgentCapabilities.wireguardModulePath)) {
    results.push(
      prerequisiteMissing(
        'node-agent.wireguard-module',
        'node-agent.wireguard_module_missing',
        'Configured WireGuard module path is not visible on the host',
        runtimeConfigResult.value.raw.nodeAgentCapabilities.wireguardModulePath
      )
    )
    return finalizeReport(
      target,
      authMode,
      paths.deploymentConfigPath,
      runtimeConfigResult.value,
      services,
      results
    )
  }
  results.push(
    success(
      'node-agent.wireguard-module',
      runtimeConfigResult.value.raw.nodeAgentCapabilities.wireguardModulePath
    )
  )

  const secretManager = createRuntimeSecretManager(runtimeConfigResult.value, sharedEnv)
  const deploymentBindings = await resolveDeploymentSecretBindings(
    secretManager,
    runtimeConfigResult.value.raw.secretBindings
  )
  if (!deploymentBindings.ok) {
    results.push(
      failure(
        'secret-provider.bindings',
        deploymentBindings.error.code,
        'SecretProvider failed to resolve deployment bindings',
        deploymentBindings.error.message
      )
    )
    return finalizeReport(
      target,
      authMode,
      paths.deploymentConfigPath,
      runtimeConfigResult.value,
      services,
      results
    )
  }
  results.push(
    success(
      'secret-provider.bindings',
      `${Object.keys(deploymentBindings.value).length} binding(s) resolved`
    )
  )

  if (runtimeConfigResult.value.auth.provider === 'oidc') {
    try {
      await resolveCoreOidcStartupSecrets(runtimeConfigResult.value, secretManager)
      results.push(success('auth.mode', `oidc:${runtimeConfigResult.value.auth.issuer}`))
    } catch (error) {
      results.push(
        failure(
          'auth.mode',
          'auth.oidc_secret_resolution_failed',
          'OIDC auth provider selection failed closed before service startup',
          error instanceof Error ? error.message : String(error)
        )
      )
      return finalizeReport(
        target,
        authMode,
        paths.deploymentConfigPath,
        runtimeConfigResult.value,
        services,
        results
      )
    }
  } else {
    results.push(success('auth.mode', 'local-dev'))
  }

  return {
    authMode,
    keycloakRealm: keycloak.realm,
    paths,
    runtimeConfig: runtimeConfigResult.value,
    sharedEnv,
    target
  }
}

export async function ensureInfraAndWorkspace(
  context: PreparedContext,
  results: DeployProofResult[],
  services: Partial<Record<ManagedServiceName, ServiceEvidence>>,
  deps: DeployProofDeps
): Promise<boolean> {
  const databaseUrl =
    context.sharedEnv.DATABASE_URL ?? 'postgres://meristem:meristem@localhost:55432/meristem'
  const natsUrl = context.sharedEnv.NATS_URL ?? 'ws://localhost:4223'
  const postgresWasReady = await deps.postgresReady(databaseUrl)
  const natsWasReady = await deps.natsReady(natsUrl)
  if (!postgresWasReady || !natsWasReady) {
    const dockerVersion = deps.runVersionCommand(['docker', '--version'])
    const composeVersion = deps.runVersionCommand(['docker', 'compose', 'version'])
    if (dockerVersion.exitCode !== 0 || composeVersion.exitCode !== 0) {
      const result = prerequisiteMissing(
        'infra.compose',
        'infra.compose_missing',
        'docker + docker compose are required when PostgreSQL or NATS are not already reachable'
      )
      results.push(result)
      services.postgres = { status: 'prerequisite-missing', detail: result.message }
      services.nats = { status: 'prerequisite-missing', detail: result.message }
      return false
    }

    try {
      await deps.prepareInfra()
    } catch (error) {
      results.push(
        failure(
          'infra.start',
          'infra.start_failed',
          'Failed to start PostgreSQL/NATS for deploy proof',
          error instanceof Error ? error.message : String(error)
        )
      )
      services.postgres = { status: 'failure', detail: 'docker compose up failed' }
      services.nats = { status: 'failure', detail: 'docker compose up failed' }
      return false
    }
  }

  const postgresReadyNow = await deps.postgresReady(databaseUrl)
  const natsReadyNow = await deps.natsReady(natsUrl)
  if (!postgresReadyNow || !natsReadyNow) {
    results.push(
      failure(
        'infra.readiness',
        'infra.not_ready',
        'PostgreSQL or NATS still failed readiness after orchestration',
        `postgres=${postgresReadyNow} nats=${natsReadyNow}`
      )
    )
    return false
  }

  services.postgres = {
    status: postgresWasReady ? 'reused' : 'ready',
    detail: databaseUrl
  }
  services.nats = {
    status: natsWasReady ? 'reused' : 'ready',
    detail: natsUrl
  }
  results.push(
    success(
      'infra.postgres',
      postgresWasReady ? 'reused existing PostgreSQL' : 'started PostgreSQL'
    )
  )
  results.push(success('infra.nats', natsWasReady ? 'reused existing NATS' : 'started NATS'))

  try {
    await deps.prepareWorkspace()
    results.push(success('workspace.prepare', 'certs, migration, seed, and defaults prepared'))
    return true
  } catch (error) {
    results.push(
      failure(
        'workspace.prepare',
        'workspace.prepare_failed',
        'Failed to prepare workspace prerequisites for deploy proof',
        error instanceof Error ? error.message : String(error)
      )
    )
    return false
  }
}

export async function waitForServiceReadiness(
  context: PreparedContext,
  definition: ManagedServiceDefinition,
  deps: DeployProofDeps,
  timeoutMs = 60_000
): Promise<boolean> {
  const startedAt = deps.now().getTime()
  const readiness = context.runtimeConfig.raw.readiness[definition.readinessKey]
  if (!readiness) return false
  const endpoint = readiness.endpoint
  if (!endpoint) return false
  while (deps.now().getTime() - startedAt < timeoutMs) {
    if (await deps.probeReadyEndpoint(endpoint, context.sharedEnv.MERISTEM_INTERNAL_TOKEN)) {
      return true
    }
    await deps.sleep(500)
  }
  return false
}
