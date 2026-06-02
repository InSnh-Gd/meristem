import { createDb } from '../../../packages/db/src/client.ts'
import { serviceUrl } from '../../../packages/internal-http/src/index.ts'
import { connectToNats } from '../../../packages/nats-rpc/src/index.ts'
import { extractBearerToken, mintActorToken } from '../../../packages/auth/src/index.ts'
import { ok } from '../../../packages/common/src/result.ts'
import type { CoreDependencies } from '../../../packages/contracts/src/index.ts'
import type { CoreDeps } from './types.ts'
import { createSessionAuthPort } from './adapters/auth.ts'
import { createDbStorage, createIdentityStore, createSecretRefStore } from './storage-adapter.ts'
import { createHttpPolicyPort } from './adapters/http-policy.ts'
import { createHttpLogPort } from './adapters/http-log.ts'
import { createHttpEventPort } from './adapters/http-eventbus.ts'
import { createHttpMNetPort } from './adapters/http-mnet.ts'
import { createHttpAgentTaskPort } from './adapters/http-agent-task.ts'
import { createServiceLifecyclePort, dependencyStateFromReady } from './adapters/service-lifecycle.ts'
import { createHttpProjectionPort } from './adapters/http-projection.ts'
import { createConfigStateMachine } from './config-state-machine.ts'

export { createSessionAuthPort } from './adapters/auth.ts'
export { createDbStorage } from './storage-adapter.ts'
export { createHttpPolicyPort } from './adapters/http-policy.ts'
export { createHttpLogPort } from './adapters/http-log.ts'
export { createHttpEventPort } from './adapters/http-eventbus.ts'
export { createHttpMNetPort } from './adapters/http-mnet.ts'
export { createHttpAgentTaskPort } from './adapters/http-agent-task.ts'
export { createServiceLifecyclePort } from './adapters/service-lifecycle.ts'
export { createRpcPolicyPort, createRpcLogPort, createRpcEventPort } from './adapters/rpc-legacy.ts'
export { createConfigStateMachine } from './config-state-machine.ts'

function parseDurationToMs(value: string): number {
  const numericSeconds = Number(value)
  if (Number.isFinite(numericSeconds) && numericSeconds > 0) return numericSeconds * 1_000
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value)
  if (!match) return 3_600_000
  const amount = Number(match[1])
  switch (match[2]) {
    case 'ms': return amount
    case 's': return amount * 1_000
    case 'm': return amount * 60_000
    case 'h': return amount * 3_600_000
    case 'd': return amount * 86_400_000
    default: return 3_600_000
  }
}

async function hashSecretValue(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function createProductionDeps(): Promise<CoreDeps & { close(): Promise<void> }> {
  const { db, client } = createDb()
  const natsUrl = process.env.NATS_URL ?? 'ws://localhost:4223'
  const readinessChecks = async (): Promise<CoreDependencies> => {
    const postgresReady = await client`select 1`
      .then(() => 'ready' as const)
      .catch(() => 'unavailable' as const)
    const natsReady = await connectToNats(natsUrl)
      .then(async (nc) => {
        await nc.drain()
        return 'ready' as const
      })
      .catch(() => 'unavailable' as const)
    const [policyReady, logReady, eventBusReady, mNetReady] = await Promise.all([
      dependencyStateFromReady(`${serviceUrl('m-policy')}/ready`),
      dependencyStateFromReady(`${serviceUrl('m-log')}/ready`),
      dependencyStateFromReady(`${serviceUrl('m-eventbus')}/ready`),
      dependencyStateFromReady(`${serviceUrl('m-net')}/ready`)
    ])
    return {
      postgres: postgresReady,
      nats: natsReady,
      'm-policy': policyReady,
      'm-log': logReady,
      'm-eventbus': eventBusReady,
      'm-net': mNetReady
    }
  }
  const storage = createDbStorage(db, readinessChecks)
  const identityStore = createIdentityStore(db)
  const secretStore = createSecretRefStore(db)
  const jwtSecret = process.env.MERISTEM_JWT_SECRET ?? 'change-me-local-secret'
  return {
    startedAt: Date.now(),
    version: '0.1.0',
    joinIngressPublicUrl: process.env.MERISTEM_JOIN_PUBLIC_URL ?? 'https://localhost:8443',
    auth: createSessionAuthPort(db),
    policy: createHttpPolicyPort(),
    log: createHttpLogPort(),
    events: createHttpEventPort(),
    mNet: createHttpMNetPort(),
    agentTasks: createHttpAgentTaskPort(),
    services: createServiceLifecyclePort(storage, readinessChecks),
    projection: createHttpProjectionPort(),
    identity: {
      async listActors() {
        return ok(await identityStore.listActors())
      },
      async getActor(id) {
        return ok(await identityStore.getActor(id))
      },
      async issueToken(input) {
        const jti = crypto.randomUUID()
        const issuedAt = new Date()
        const expiresAt = new Date(issuedAt.getTime() + parseDurationToMs(input.ttl))
        const token = await mintActorToken({
          actor: input.actor as 'viewer' | 'operator' | 'admin' | 'security-admin',
          secret: jwtSecret,
          jti,
          expiresIn: input.ttl,
          issuedBy: 'security-admin',
          purpose: input.purpose
        })
        await identityStore.createToken({
          jti,
          actorId: input.actor,
          issuer: 'meristem-local',
          audience: 'meristem-core',
          issuedAt,
          expiresAt,
          issuedBy: 'security-admin',
          purpose: input.purpose
        })
        return ok({ jti, token, expiresAt: expiresAt.toISOString(), actor: input.actor })
      },
      async inspectToken(jti) {
        const token = await identityStore.getToken(jti)
        if (!token) return ok(null)
        const revocation = await identityStore.getRevocation(jti)
        return ok({
          jti: token.jti,
          actor: token.actorId,
          issuer: token.issuer,
          audience: token.audience,
          issuedAt: token.issuedAt,
          expiresAt: token.expiresAt,
          issuedBy: token.issuedBy,
          purpose: token.purpose,
          status: revocation ? 'revoked' : token.status,
          ...(revocation ? { revokedAt: revocation.revokedAt, revokedBy: revocation.revokedBy, revokeReason: revocation.reason } : {})
        })
      },
      async revokeToken(jti, input) {
        const token = await identityStore.getToken(jti)
        if (!token) return ok({ jti, status: 'revoked', revokedAt: new Date().toISOString(), revokedBy: 'security-admin' })
        const revokedAt = new Date()
        await identityStore.revokeToken({
          jti,
          revokedBy: 'security-admin',
          reason: input.reason,
          correlationId: input.correlationId,
          revokedAt
        })
        return ok({ jti, status: 'revoked', revokedAt: revokedAt.toISOString(), revokedBy: 'security-admin' })
      },
      async introspect(jti) {
        const token = await identityStore.getToken(jti)
        if (!token) return ok({ active: false, jti })
        const revocation = await identityStore.getRevocation(jti)
        const expired = Date.parse(token.expiresAt) <= Date.now()
        return ok({ active: !revocation && !expired && token.status === 'active', actor: token.actorId, jti: token.jti })
      }
    },
    secrets: {
      async list() {
        return ok(await secretStore.list())
      },
      async get(id) {
        return ok(await secretStore.get(id))
      },
      async create(input) {
        const now = new Date()
        const id = crypto.randomUUID()
        await secretStore.create({
          id,
          name: input.name,
          scope: input.scope,
          status: 'active',
          createdBy: 'security-admin',
          metadata: input.metadata ?? {},
          createdAt: now
        })
        await secretStore.createVersion({
          id: crypto.randomUUID(),
          secretRefId: id,
          version: '1',
          valueCiphertext: await hashSecretValue(input.value),
          createdBy: 'security-admin',
          createdAt: now
        })
        await secretStore.recordTransition({
          id: crypto.randomUUID(),
          secretRefId: id,
          fromStatus: 'missing',
          toStatus: 'active',
          actor: 'security-admin',
          correlationId: input.correlationId,
          createdAt: now
        })
        return ok({ id, name: input.name, status: 'active', createdAt: now.toISOString() })
      },
      async rotate(id, input) {
        const current = await secretStore.get(id)
        if (!current) return ok({ id, version: '0', status: 'missing', rotatedAt: new Date().toISOString() })
        const latest = await secretStore.getLatestVersion(id)
        const nextVersion = String((latest ? Number(latest.version) : 0) + 1)
        const now = new Date()
        await secretStore.createVersion({
          id: crypto.randomUUID(),
          secretRefId: id,
          version: nextVersion,
          valueCiphertext: await hashSecretValue(input.value),
          createdBy: 'security-admin',
          createdAt: now
        })
        await secretStore.updateStatus(id, 'rotated')
        await secretStore.recordTransition({
          id: crypto.randomUUID(),
          secretRefId: id,
          fromStatus: current.status,
          toStatus: 'rotated',
          actor: 'security-admin',
          reason: input.reason,
          correlationId: input.correlationId,
          createdAt: now
        })
        return ok({ id, version: nextVersion, status: 'rotated', rotatedAt: now.toISOString() })
      },
      async disable(id, input) {
        const current = await secretStore.get(id)
        if (!current) return ok({ id, status: 'disabled', disabledAt: new Date().toISOString() })
        const now = new Date()
        await secretStore.updateStatus(id, 'disabled')
        await secretStore.recordTransition({
          id: crypto.randomUUID(),
          secretRefId: id,
          fromStatus: current.status,
          toStatus: 'disabled',
          actor: 'security-admin',
          reason: input.reason,
          correlationId: input.correlationId,
          createdAt: now
        })
        return ok({ id, status: 'disabled', disabledAt: now.toISOString() })
      },
      async reference(id) {
        const current = await secretStore.get(id)
        const latest = await secretStore.getLatestVersion(id)
        if (!current || !latest) return ok({ id, currentVersion: '0', status: 'missing', metadata: {} })
        return ok({ id, currentVersion: latest.version, status: current.status, metadata: current.metadata })
      }
    },
    config: createConfigStateMachine(db),
    storage,
    async close() {
      await client.end()
    }
  }
}

export function bearerTokenFromRequest(request: Request): string | null {
  return extractBearerToken(request.headers.get('authorization') ?? undefined)
}
