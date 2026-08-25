import { createServer } from 'node:net'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { decodeJwt, type JWTPayload } from 'jose'
import {
  actorDefinitions,
  buildKeycloakAuthConfig,
  buildKeycloakDeploymentConfig,
  buildRealmState,
  keycloakContainerName,
  realmImportFile,
  stateFile,
  workspaceDir,
  writeRealmImport,
  type KeycloakDevRealmPrerequisiteMissing,
  type KeycloakDevRealmResult,
  type KeycloakMintedToken,
  type KeycloakRealmState,
  type KeycloakRuntime,
  type KeycloakTestActor
} from './keycloak-dev-realm-model.ts'

type CommandResult = {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

type KeycloakProofResult =
  | {
      readonly detail: string
      readonly status: 'success'
      readonly step: string
    }
  | {
      readonly message: string
      readonly status: 'prerequisite-missing'
      readonly step: string
    }

type KeycloakTokenResponse = {
  readonly access_token?: unknown
  readonly error?: unknown
  readonly error_description?: unknown
  readonly expires_in?: unknown
  readonly token_type?: unknown
}

function ensureWorkspaceDir(): void {
  mkdirSync(workspaceDir, { recursive: true })
}

function run(command: readonly string[]): CommandResult {
  const child = Bun.spawnSync([...command], {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe'
  })

  return {
    exitCode: child.exitCode,
    stdout: child.stdout.toString().trim(),
    stderr: child.stderr.toString().trim()
  }
}

function readState(): KeycloakRealmState | null {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8')) as KeycloakRealmState
  } catch {
    return null
  }
}

function writeState(realm: KeycloakRealmState): void {
  ensureWorkspaceDir()
  writeFileSync(stateFile, `${JSON.stringify(realm, null, 2)}\n`)
}

function prerequisiteMissing(
  step: KeycloakDevRealmPrerequisiteMissing['step'],
  message: string
): KeycloakDevRealmPrerequisiteMissing {
  return { ok: false, status: 'prerequisite-missing', step, message }
}

function isPrerequisiteMissing(
  value: KeycloakRuntime | KeycloakDevRealmPrerequisiteMissing
): value is KeycloakDevRealmPrerequisiteMissing {
  return typeof value === 'object' && value !== null && value.ok === false
}

/**
 * 只接受 docker / podman 两种本地容器运行时；缺失时返回 typed prerequisite-missing。
 */
function resolveRuntime(): KeycloakRuntime | KeycloakDevRealmPrerequisiteMissing {
  for (const runtime of ['docker', 'podman'] as const) {
    const version = run([runtime, '--version'])
    if (version.exitCode !== 0) continue

    const health = run([runtime, 'ps', '--format', '{{.ID}}'])
    if (health.exitCode === 0) return runtime

    return prerequisiteMissing(
      'container_runtime_access',
      `${runtime} is installed but unavailable: ${health.stderr || health.stdout || 'unknown runtime error'}`
    )
  }

  return prerequisiteMissing(
    'container_runtime',
    'Neither docker nor podman is available for the Keycloak dev realm'
  )
}

function containerExists(runtime: KeycloakRuntime): boolean {
  return run([runtime, 'inspect', keycloakContainerName]).exitCode === 0
}

function containerRunning(runtime: KeycloakRuntime): boolean {
  const result = run([runtime, 'inspect', '--format', '{{.State.Running}}', keycloakContainerName])
  return result.exitCode === 0 && result.stdout === 'true'
}

function removeContainer(runtime: KeycloakRuntime): void {
  if (containerExists(runtime)) {
    run([runtime, 'rm', '-f', keycloakContainerName])
  }
}

async function allocatePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address !== 'object' || address === null) {
        server.close(() => reject(new Error('Port allocation returned no address object')))
        return
      }

      server.close(error => {
        if (error) {
          reject(error)
          return
        }
        resolve(address.port)
      })
    })
  })
}

async function waitForDiscovery(realm: KeycloakRealmState, timeoutMs = 120_000): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(realm.discoveryUrl)
      if (response.ok) return
    } catch {
      // Keycloak 启动期允许短暂失败；超时后再统一报错。
    }
    await Bun.sleep(1_000)
  }

  throw new Error(`Timed out waiting for Keycloak discovery at ${realm.discoveryUrl}`)
}

function shouldReportImagePrerequisite(detail: string): boolean {
  return detail.includes('Unable to find image') || detail.includes('pull access denied')
}

async function startFreshRealm(runtime: KeycloakRuntime): Promise<KeycloakDevRealmResult> {
  const configuredPort = process.env.MERISTEM_KEYCLOAK_PORT
  const hostPort = configuredPort ? Number(configuredPort) : await allocatePort()
  if (!Number.isFinite(hostPort) || hostPort <= 0) {
    return prerequisiteMissing(
      'port_allocation',
      'Could not allocate a local host port for the Keycloak dev realm'
    )
  }

  const realm = buildRealmState(runtime, hostPort)
  ensureWorkspaceDir()
  writeRealmImport(realm)
  removeContainer(runtime)

  const start = run([
    runtime,
    'run',
    '--detach',
    '--name',
    realm.containerName,
    '--publish',
    `${realm.hostPort}:8080`,
    '--volume',
    `${realm.realmImportFile}:/opt/keycloak/data/import/meristem-realm.json:ro`,
    '--env',
    `KC_BOOTSTRAP_ADMIN_USERNAME=${realm.adminUsername}`,
    '--env',
    `KC_BOOTSTRAP_ADMIN_PASSWORD=${realm.adminPassword}`,
    realm.image,
    'start-dev',
    '--import-realm',
    '--http-port=8080',
    `--hostname=${realm.baseUrl}`,
    '--hostname-strict=false'
  ])

  if (start.exitCode !== 0) {
    const detail = `${start.stderr} ${start.stdout}`.trim()
    if (shouldReportImagePrerequisite(detail)) {
      return prerequisiteMissing('image_pull', detail || `Could not pull ${realm.image}`)
    }
    throw new Error(`Keycloak container failed to start: ${detail || 'unknown runtime failure'}`)
  }

  writeState(realm)
  await waitForDiscovery(realm)
  return { ok: true, realm, startedNow: true }
}

/**
 * 启动或复用本地 Keycloak dev realm；缺少运行时时返回 typed prerequisite-missing，而不是抛异常。
 */
export async function ensureKeycloakDevRealm(): Promise<KeycloakDevRealmResult> {
  ensureWorkspaceDir()
  const runtime = resolveRuntime()
  if (isPrerequisiteMissing(runtime)) {
    const persisted = readState()
    if (persisted && containerRunning(persisted.runtime)) {
      await waitForDiscovery(persisted)
      return { ok: true, realm: persisted, startedNow: false }
    }
    return runtime
  }

  const persisted = readState()
  if (persisted && persisted.runtime === runtime && containerRunning(runtime)) {
    await waitForDiscovery(persisted)
    return { ok: true, realm: persisted, startedNow: false }
  }

  if (containerExists(runtime) && !containerRunning(runtime)) {
    removeContainer(runtime)
  }

  return await startFreshRealm(runtime)
}

/**
 * 停止 dev realm 并清理本地状态，供测试和 proof 做环境回收。
 */
export async function stopKeycloakDevRealm(): Promise<void> {
  const state = readState()
  if (state) {
    removeContainer(state.runtime)
  } else {
    const runtime = resolveRuntime()
    if (!isPrerequisiteMissing(runtime)) {
      removeContainer(runtime)
    }
  }

  rmSync(stateFile, { force: true })
  rmSync(realmImportFile, { force: true })
}

function isTokenResponse(value: unknown): value is KeycloakTokenResponse {
  return typeof value === 'object' && value !== null
}

export type KeycloakMintedTokenWithClaims = {
  readonly accessToken: string
  readonly actor: KeycloakTestActor
  readonly claims: JWTPayload
  readonly expiresIn: number
  readonly tokenType: string
}

/**
 * 通过固定 direct-grant client 为测试 actor 申请 access token，保证 token 形状可重复。
 */
export async function mintKeycloakTokenForActor(
  realm: KeycloakRealmState,
  actor: KeycloakTestActor
): Promise<KeycloakMintedToken> {
  const actorConfig = realm.actorCredentials[actor]
  const response = await fetch(realm.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: realm.clientId,
      client_secret: realm.clientSecret,
      username: actorConfig.username,
      password: actorConfig.password,
      scope: 'openid profile email roles'
    }).toString()
  })

  const payload = (await response.json()) as unknown
  if (!isTokenResponse(payload)) {
    throw new Error('Keycloak token endpoint returned a non-object payload')
  }

  if (!response.ok) {
    const code = typeof payload.error === 'string' ? payload.error : 'unknown_error'
    const description =
      typeof payload.error_description === 'string'
        ? payload.error_description
        : `HTTP ${response.status}`
    throw new Error(`Keycloak token mint failed for ${actor}: ${code} ${description}`)
  }

  if (typeof payload.access_token !== 'string') {
    throw new Error(`Keycloak token endpoint returned no access token for ${actor}`)
  }
  if (typeof payload.token_type !== 'string') {
    throw new Error(`Keycloak token endpoint returned no token_type for ${actor}`)
  }
  if (typeof payload.expires_in !== 'number') {
    throw new Error(`Keycloak token endpoint returned no expires_in for ${actor}`)
  }

  return {
    actor,
    accessToken: payload.access_token,
    tokenType: payload.token_type,
    expiresIn: payload.expires_in,
    claims: decodeJwt(payload.access_token)
  }
}

/**
 * proof 同时验证 discovery、JWKS 和三类固定 actor token minting；不把缺少容器运行时计为成功。
 */
export async function runKeycloakProof(): Promise<{
  readonly discoveryUrl?: string
  readonly issuer?: string
  readonly jwksUrl?: string
  readonly proof: 'keycloak-dev-realm'
  readonly results: readonly KeycloakProofResult[]
  readonly verdict: 'pass' | 'prerequisite-missing'
}> {
  const realmResult = await ensureKeycloakDevRealm()
  if (!realmResult.ok) {
    return {
      proof: 'keycloak-dev-realm',
      verdict: 'prerequisite-missing',
      results: [
        {
          status: 'prerequisite-missing',
          step: realmResult.step,
          message: realmResult.message
        }
      ]
    }
  }

  const { realm, startedNow } = realmResult
  const results: KeycloakProofResult[] = []

  try {
    results.push({
      status: 'success',
      step: 'realm.start',
      detail: `${realm.runtime}:${realm.hostPort}`
    })

    const discoveryResponse = await fetch(realm.discoveryUrl)
    const discoveryPayload = (await discoveryResponse.json()) as Record<string, unknown>
    if (!discoveryResponse.ok) {
      throw new Error(`Discovery request failed with HTTP ${discoveryResponse.status}`)
    }
    results.push({
      status: 'success',
      step: 'oidc.discovery',
      detail: String(discoveryPayload.issuer ?? realm.discoveryUrl)
    })

    const jwksResponse = await fetch(realm.jwksUrl)
    const jwksPayload = (await jwksResponse.json()) as Record<string, unknown>
    const keys = Array.isArray(jwksPayload.keys) ? jwksPayload.keys : []
    if (!jwksResponse.ok || keys.length === 0) {
      throw new Error('JWKS endpoint returned no signing keys')
    }
    results.push({ status: 'success', step: 'oidc.jwks', detail: `${keys.length} signing key(s)` })

    for (const actor of Object.keys(actorDefinitions) as KeycloakTestActor[]) {
      const minted = await mintKeycloakTokenForActor(realm, actor)
      results.push({
        status: 'success',
        step: `token.${actor}`,
        detail: `${String(minted.claims.sub ?? 'missing-sub')} -> ${String(minted.claims.iss ?? 'missing-iss')}`
      })
    }

    return {
      proof: 'keycloak-dev-realm',
      verdict: 'pass',
      results,
      issuer: realm.issuer,
      discoveryUrl: realm.discoveryUrl,
      jwksUrl: realm.jwksUrl
    }
  } finally {
    if (startedNow) {
      await stopKeycloakDevRealm()
    }
  }
}

export { buildKeycloakAuthConfig, buildKeycloakDeploymentConfig, readState }
