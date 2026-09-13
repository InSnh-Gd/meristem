/**
 * v02-deploy-proof.ts — v0.2 deployment proof command。
 *
 * 该 proof 不再只检查前置条件；它会拉起或复用真实本地服务，
 * 并输出可机读 JSON 证据，而不是把失败折叠成泛化异常。
 */
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { mintLocalToken } from '../packages/auth/src/index.ts'
import { mintKeycloakTokenForActor } from './keycloak-dev-realm.ts'
import {
  ensureInfraAndWorkspace,
  prepareContext,
  waitForServiceReadiness
} from './v02-deploy-proof-context.ts'
import {
  authModeFromArgv,
  defaultDeps,
  failure,
  finalizeReport,
  joinHealthUrl,
  loadStoredState,
  managedServices,
  proofPaths,
  success,
  tailLogFile,
  targetFromArgv,
  updateStoredService
} from './v02-deploy-proof-support.ts'
import type {
  DeployProofDeps,
  DeployProofReport,
  DeployProofResult,
  JoinTicketResult,
  ManagedServiceName,
  PreparedContext,
  ServiceEvidence
} from './v02-deploy-proof-types.ts'

// 公共 API re-export，保持既有 `from './v02-deploy-proof.ts'` 消费点兼容。
export type {
  DeployAuthMode,
  DeployProofDeps,
  DeployProofReport,
  DeployProofResult,
  DeployTarget
} from './v02-deploy-proof-types.ts'

async function ensureManagedServices(
  context: PreparedContext,
  results: DeployProofResult[],
  services: Partial<Record<ManagedServiceName, ServiceEvidence>>,
  deps: DeployProofDeps
): Promise<boolean> {
  for (const definition of managedServices) {
    const endpoint = context.runtimeConfig.raw.readiness[definition.readinessKey]?.endpoint
    if (
      endpoint &&
      (await deps.probeReadyEndpoint(endpoint, context.sharedEnv.MERISTEM_INTERNAL_TOKEN))
    ) {
      services[definition.name] = {
        status: 'reused',
        detail: 'service already responded to readiness probe',
        endpoint
      }
      results.push(success(`service.${definition.name}`, `reused ${endpoint}`))
      continue
    }

    const prior = loadStoredState(context.paths.stateFile).services[definition.name]
    if (prior && deps.isPidAlive(prior.pid)) {
      deps.killPid(prior.pid)
      await deps.sleep(1_000)
      updateStoredService(context.paths.stateFile, definition.name, null)
    }

    const logFile = join(context.paths.logDir, `${definition.name}.log`)
    try {
      const pid = deps.startDetached(definition.command, logFile, context.sharedEnv)
      updateStoredService(context.paths.stateFile, definition.name, {
        logFile,
        pid,
        startedAt: deps.now().toISOString()
      })

      const ready = await waitForServiceReadiness(context, definition, deps)
      if (!ready) {
        services[definition.name] = {
          status: 'failure',
          detail: 'service did not become ready before timeout',
          ...(endpoint ? { endpoint } : {}),
          logFile,
          pid
        }
        results.push(
          failure(
            `service.${definition.name}`,
            'service.readiness_timeout',
            `Service ${definition.name} did not become ready in time`,
            tailLogFile(logFile)
          )
        )
        return false
      }

      services[definition.name] = {
        status: prior ? 'restarted' : 'started',
        detail: `service ready on ${endpoint ?? 'unknown endpoint'}`,
        ...(endpoint ? { endpoint } : {}),
        logFile,
        pid
      }
      results.push(success(`service.${definition.name}`, `started ${endpoint ?? definition.name}`))
    } catch (error) {
      services[definition.name] = {
        status: 'failure',
        detail: error instanceof Error ? error.message : String(error),
        ...(endpoint ? { endpoint } : {}),
        logFile
      }
      results.push(
        failure(
          `service.${definition.name}`,
          'service.start_failed',
          `Failed to start ${definition.name}`,
          error instanceof Error ? error.message : String(error)
        )
      )
      return false
    }
  }

  const joinHealthReady = await deps.probeReadyEndpoint(joinHealthUrl)
  if (!joinHealthReady) {
    results.push(
      failure(
        'service.m-net.join-ingress',
        'mnet.join_ingress_not_ready',
        'M-Net join ingress did not expose the public health endpoint',
        joinHealthUrl
      )
    )
    return false
  }
  results.push(success('service.m-net.join-ingress', joinHealthUrl))
  return true
}

function readRuntimeState(
  path: string
): { readonly nodeId: string; readonly runtimeToken: string; readonly savedAt: string } | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      nodeId?: unknown
      runtimeToken?: unknown
      savedAt?: unknown
    }
    return typeof parsed.nodeId === 'string' &&
      typeof parsed.runtimeToken === 'string' &&
      typeof parsed.savedAt === 'string'
      ? {
          nodeId: parsed.nodeId,
          runtimeToken: parsed.runtimeToken,
          savedAt: parsed.savedAt
        }
      : null
  } catch {
    return null
  }
}

async function mintOperatorToken(context: PreparedContext): Promise<string> {
  if (context.runtimeConfig.auth.provider === 'oidc') {
    const minted = await mintKeycloakTokenForActor(context.keycloakRealm, 'operator')
    return minted.accessToken
  }
  return await mintLocalToken({
    actor: 'operator',
    secret: context.sharedEnv.MERISTEM_JWT_SECRET ?? 'deploy-proof-jwt-secret-32-characters'
  })
}

async function createJoinTicket(context: PreparedContext): Promise<JoinTicketResult> {
  const token = await mintOperatorToken(context)
  const response = await fetch(
    `${context.runtimeConfig.raw.serviceUrls.core}/api/v0/node-tickets`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        kind: 'stem',
        name: `deploy-proof-${context.target}-${Date.now()}`
      })
    }
  )

  if (!response.ok) {
    return {
      ok: false,
      result: failure(
        'auth.operator-ticket',
        response.status === 401 || response.status === 403
          ? 'auth.operator_token_rejected'
          : 'core.join_ticket_failed',
        'Failed to verify configured auth mode through Core join-ticket creation',
        `HTTP ${response.status}`
      )
    }
  }

  const body = (await response.json().catch(() => null)) as { ticket?: unknown } | null
  if (typeof body?.ticket !== 'string' || body.ticket.length === 0) {
    return {
      ok: false,
      result: failure(
        'auth.operator-ticket',
        'core.join_ticket_invalid',
        'Core join-ticket route did not return a ticket string'
      )
    }
  }

  return { ok: true, ticket: body.ticket }
}

async function waitForRuntimeStateUpdate(
  path: string,
  previousSavedAt: string | null,
  deps: DeployProofDeps,
  timeoutMs = 45_000
): Promise<ReturnType<typeof readRuntimeState>> {
  const startedAt = deps.now().getTime()
  while (deps.now().getTime() - startedAt < timeoutMs) {
    const runtime = readRuntimeState(path)
    if (runtime && (previousSavedAt === null || runtime.savedAt !== previousSavedAt)) {
      return runtime
    }
    await deps.sleep(500)
  }
  return null
}

async function startNodeAgentWithJoinTicket(
  context: PreparedContext,
  joinTicket: string,
  previousSavedAt: string | null,
  deps: DeployProofDeps
): Promise<
  | {
      readonly ok: true
      readonly pid: number
      readonly runtime: NonNullable<ReturnType<typeof readRuntimeState>>
    }
  | {
      readonly ok: false
      readonly result: DeployProofResult
      readonly pid?: number
      readonly logFile: string
    }
> {
  rmSync(context.paths.runtimeStatePath, { force: true })
  const logFile = join(context.paths.logDir, 'node-agent.log')
  const pid = deps.startDetached(['bun', 'run', 'services/node-agent/src/index.ts'], logFile, {
    ...context.sharedEnv,
    MERISTEM_JOIN_TICKET: joinTicket,
    MERISTEM_HOST_PRIVATE_KEY_PATH: join(context.paths.workspaceDir, 'wg', 'private.key')
  })
  const runtime = await waitForRuntimeStateUpdate(
    context.paths.runtimeStatePath,
    previousSavedAt,
    deps
  )
  if (!runtime) {
    return {
      ok: false,
      pid,
      logFile,
      result: failure(
        'service.node-agent',
        'node-agent.session_timeout',
        'Node-agent did not establish a session after fresh join',
        tailLogFile(logFile)
      )
    }
  }
  return { ok: true, pid, runtime }
}

async function ensureNodeAgent(
  context: PreparedContext,
  results: DeployProofResult[],
  services: Partial<Record<ManagedServiceName, ServiceEvidence>>,
  deps: DeployProofDeps
): Promise<boolean> {
  const priorState = loadStoredState(context.paths.stateFile).services['node-agent']
  if (priorState && deps.isPidAlive(priorState.pid)) {
    deps.killPid(priorState.pid)
    await deps.sleep(1_000)
    updateStoredService(context.paths.stateFile, 'node-agent', null)
  }

  const previousRuntime = readRuntimeState(context.paths.runtimeStatePath)
  const joinTicketResult = await createJoinTicket(context)
  if (!joinTicketResult.ok) {
    results.push(joinTicketResult.result)
    services['node-agent'] = {
      status: 'failure',
      detail: joinTicketResult.result.message
    }
    return false
  }
  results.push(
    success('auth.operator-ticket', 'Core accepted operator token and minted a join ticket')
  )

  const started = await startNodeAgentWithJoinTicket(
    context,
    joinTicketResult.ticket,
    previousRuntime?.savedAt ?? null,
    deps
  )
  if (!started.ok) {
    if (started.pid) deps.killPid(started.pid)
    results.push(started.result)
    services['node-agent'] = {
      status: 'failure',
      detail: 'message' in started.result ? started.result.message : started.result.detail,
      logFile: started.logFile,
      ...(started.pid ? { pid: started.pid } : {})
    }
    return false
  }

  updateStoredService(context.paths.stateFile, 'node-agent', {
    logFile: join(context.paths.logDir, 'node-agent.log'),
    pid: started.pid,
    startedAt: deps.now().toISOString()
  })
  services['node-agent'] = {
    status: 'started',
    detail: `session established for ${started.runtime.nodeId}`,
    logFile: join(context.paths.logDir, 'node-agent.log'),
    pid: started.pid
  }
  results.push(success('service.node-agent', `session established for ${started.runtime.nodeId}`))
  return true
}

export async function runV02DeployProof(
  input: { readonly argv?: readonly string[] } = {},
  overrideDeps: Partial<DeployProofDeps> = {}
): Promise<DeployProofReport> {
  const deps = { ...defaultDeps, ...overrideDeps }
  const argv = input.argv ?? process.argv
  const target = targetFromArgv(argv)
  const authMode = authModeFromArgv(argv)
  const invalidTargetPath = proofPaths('nixos', 'oidc').deploymentConfigPath
  if (!target) {
    return finalizeReport('nixos', 'oidc', invalidTargetPath, null, {}, [
      failure(
        'target',
        'target.invalid',
        'Deploy proof only supports --target=nixos or --target=oci'
      )
    ])
  }
  if (!authMode) {
    return finalizeReport(
      target,
      'oidc',
      proofPaths(target, 'oidc').deploymentConfigPath,
      null,
      {},
      [
        failure(
          'auth.mode',
          'auth.mode_invalid',
          'Deploy proof only supports --auth=oidc or --auth=local-dev'
        )
      ]
    )
  }

  const results: DeployProofResult[] = []
  const services: Partial<Record<ManagedServiceName, ServiceEvidence>> = {}
  const prepared = await prepareContext(target, authMode, results, services, deps)
  if ('verdict' in prepared) return prepared

  if (!(await ensureInfraAndWorkspace(prepared, results, services, deps))) {
    return finalizeReport(
      target,
      authMode,
      prepared.paths.deploymentConfigPath,
      prepared.runtimeConfig,
      services,
      results
    )
  }
  if (!(await ensureManagedServices(prepared, results, services, deps))) {
    return finalizeReport(
      target,
      authMode,
      prepared.paths.deploymentConfigPath,
      prepared.runtimeConfig,
      services,
      results
    )
  }
  if (!(await ensureNodeAgent(prepared, results, services, deps))) {
    return finalizeReport(
      target,
      authMode,
      prepared.paths.deploymentConfigPath,
      prepared.runtimeConfig,
      services,
      results
    )
  }

  return finalizeReport(
    target,
    authMode,
    prepared.paths.deploymentConfigPath,
    prepared.runtimeConfig,
    services,
    results
  )
}

if (import.meta.main) {
  const report = await runV02DeployProof({ argv: process.argv })
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exit(0)
}
