import { createDb } from '../../../packages/db/src/client.ts'
import { serviceUrl } from '../../../packages/internal-http/src/index.ts'
import { connectToNats } from '../../../packages/nats-rpc/src/index.ts'
import { extractBearerToken } from '../../../packages/auth/src/index.ts'
import { err } from '../../../packages/common/src/result.ts'
import type { CoreDependencies } from '../../../packages/contracts/src/index.ts'
import type { CoreDeps } from './types.ts'
import { createSessionAuthPort } from './adapters/auth.ts'
import { createDbStorage } from './storage-adapter.ts'
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
  const identityUnavailable = { code: 'identity.unavailable', message: 'Identity port not implemented' }
  const secretUnavailable = { code: 'secret.unavailable', message: 'SecretRef port not implemented' }
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
        return err(identityUnavailable)
      },
      async getActor() {
        return err(identityUnavailable)
      },
      async issueToken() {
        return err(identityUnavailable)
      },
      async inspectToken() {
        return err(identityUnavailable)
      },
      async revokeToken() {
        return err(identityUnavailable)
      },
      async introspect() {
        return err(identityUnavailable)
      }
    },
    secrets: {
      async list() {
        return err(secretUnavailable)
      },
      async get() {
        return err(secretUnavailable)
      },
      async create() {
        return err(secretUnavailable)
      },
      async rotate() {
        return err(secretUnavailable)
      },
      async disable() {
        return err(secretUnavailable)
      },
      async reference() {
        return err(secretUnavailable)
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
