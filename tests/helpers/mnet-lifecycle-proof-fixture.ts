import type { HeartbeatRuntimeContext } from '@m-net/agent/agent-runtime-session-lifecycle.ts'
import { createInMemoryMNetClosedLoopStore } from '@m-net/closed-loop/closed-loop-store-memory.ts'
import {
  createMNetClosedLoopService,
  type MNetClosedLoopDeps
} from '@m-net/closed-loop/closed-loop-workflow.ts'
import { createInMemoryDataPlaneStores } from '@m-net/data-plane/data-plane-store-memory.ts'
import type {
  BreakGlassDataPlaneDeps,
  DataPlaneDeps
} from '@m-net/data-plane/mnet-dataplane-support.ts'
import { createMigrationEngine } from '@m-net/migration/migration-engine.ts'
import { createInMemoryGlobalDefaultsStore } from '@m-net/profile/global-defaults-store.ts'
import { createInMemoryProfileStore } from '@m-net/profile/profile-store.ts'
import type {
  DeploymentConfigV02FromSchema,
  MNetworkMember,
  NodeAgentRuntimeDesiredSidecar
} from '../../packages/contracts/src/index.ts'
import type { nodes } from '../../packages/db/src/schema.ts'
import type { SecretManager } from '../../packages/secrets/src/index.ts'

export const lifecycleNetworkId = 'network-mnet-lifecycle-proof'
export const lifecycleNodeId = 'leaf-mnet-lifecycle-proof'
export const lifecycleStemId = 'stem-mnet-lifecycle-proof'
export const lifecycleProfileVersion = 'm-net-cn@0.3.0' as const
export const lifecycleLegacyProfileVersion = 'm-net-cn@0.2.0' as const
export const lifecycleStartedAt = '2026-07-24T10:00:00.000Z'

type PolicyResult = 'allow' | 'deny' | 'require_manual_review' | 'require_multi_approval'

type LifecycleFixtureOptions = {
  policyResult?: PolicyResult
  now?: string
}

export function createMNetLifecycleFixture(options: LifecycleFixtureOptions = {}) {
  const store = createInMemoryMNetClosedLoopStore()
  const dataPlane = createInMemoryDataPlaneStores()
  const calls: string[] = []
  const events: Array<{
    subject: string
    type: string
    payload: unknown
    correlationId?: string
  }> = []
  const audits: Array<{ action: string; result: string }> = []
  let currentNow = options.now ?? lifecycleStartedAt
  let currentPolicyResult = options.policyResult ?? 'allow'
  let idSequence = 0

  let rotateHandler: MNetClosedLoopDeps['credentials']['rotate'] = async input => ({
    ok: true,
    credentialRef: {
      provider: 'vault-kv-v2',
      keyPath: `secret/data/mnet/${input.credentialId}`,
      version: 2
    }
  })

  const members: MNetworkMember[] = [
    {
      networkId: lifecycleNetworkId,
      nodeId: lifecycleNodeId,
      nodeKind: 'leaf',
      membershipMode: 'restricted',
      status: 'joined',
      joinedAt: lifecycleStartedAt
    }
  ]

  const service = createMNetClosedLoopService({
    store,
    dataPlane,
    now: () => new Date(currentNow),
    id: prefix => `${prefix}-lifecycle-${++idSequence}`,
    policy: {
      async authorize(_actor, action) {
        calls.push(`policy:${action}`)
        return {
          result: currentPolicyResult,
          id: `policy-${action}-${idSequence}`,
          reasons:
            currentPolicyResult === 'allow'
              ? ['allowed by lifecycle proof fixture']
              : ['controlled lifecycle proof decision']
        }
      }
    },
    log: {
      async writeAudit(_actor, action, _resource, result) {
        calls.push(`audit:${action}:${result}`)
        audits.push({ action, result })
      },
      async writeTimeline() {},
      async writeFull() {}
    },
    events: {
      async publish(subject, type, payload, correlationId) {
        calls.push(`event:${subject}`)
        events.push({
          subject,
          type,
          payload,
          ...(correlationId === undefined ? {} : { correlationId })
        })
      }
    },
    credentials: {
      async issue(input) {
        calls.push(`secret:issue:${input.credentialId}`)
        return {
          ok: true,
          credentialRef: {
            provider: 'vault-kv-v2',
            keyPath: `secret/data/mnet/${input.credentialId}`,
            version: 1
          }
        }
      },
      async rotate(input) {
        calls.push(`secret:rotate:${input.credentialId}`)
        return rotateHandler(input)
      },
      async revoke(input) {
        calls.push(`secret:revoke:${input.credentialId}`)
        return { ok: true }
      }
    },
    network: {
      async listNetworks() {
        return {
          ok: true,
          value: [
            {
              id: lifecycleNetworkId,
              name: 'M-Net lifecycle proof overlay',
              profileVersion: lifecycleProfileVersion,
              status: 'active',
              createdAt: lifecycleStartedAt,
              memberCount: members.length
            }
          ]
        }
      },
      async listMembers(input) {
        return { ok: true, value: members.filter(member => member.networkId === input.networkId) }
      }
    },
    migration: {
      async apply(input) {
        calls.push(`migration:apply:${input.networkId}`)
        return { ok: true, appliedNetworkIds: [input.networkId] }
      },
      async rollback(input) {
        calls.push(`migration:rollback:${input.networkId}`)
        return { ok: true, appliedNetworkIds: [input.networkId] }
      }
    },
    onMutation(kind) {
      calls.push(`mutation:${kind}`)
    }
  })

  return {
    service,
    store,
    dataPlane,
    calls,
    events,
    audits,
    setNow(value: string) {
      currentNow = value
    },
    setPolicyResult(value: PolicyResult) {
      currentPolicyResult = value
    },
    setRotateHandler(handler: MNetClosedLoopDeps['credentials']['rotate']) {
      rotateHandler = handler
    }
  }
}

export async function submitLifecycleJoin(
  fixture: ReturnType<typeof createMNetLifecycleFixture>,
  requestId = 'join-mnet-lifecycle-proof'
) {
  const result = await fixture.service.submitJoinRequest({
    requestId,
    networkId: lifecycleNetworkId,
    nodeId: lifecycleNodeId,
    requestedNodeKind: 'leaf',
    requestedProfileVersion: lifecycleProfileVersion,
    requestedBy: 'operator',
    expiresAt: '2026-07-24T11:00:00.000Z',
    correlationId: `correlation-${requestId}`
  })
  if (!('kind' in result) || result.kind !== 'mutation') {
    throw new Error('expected lifecycle join request mutation')
  }
  return result.value
}

export function createDataPlaneLifecycleFixture() {
  const dataPlane = createInMemoryDataPlaneStores()
  const profileStore = createInMemoryProfileStore()
  const globalDefaultsStore = createInMemoryGlobalDefaultsStore(profileStore)
  const members: MNetworkMember[] = [
    {
      networkId: lifecycleNetworkId,
      nodeId: lifecycleStemId,
      nodeKind: 'stem',
      membershipMode: 'full',
      status: 'joined',
      joinedAt: lifecycleStartedAt
    },
    {
      networkId: lifecycleNetworkId,
      nodeId: lifecycleNodeId,
      nodeKind: 'leaf',
      membershipMode: 'restricted',
      status: 'joined',
      joinedAt: lifecycleStartedAt
    }
  ]
  const events: Array<{
    subject: string
    type: string
    payload: unknown
    correlationId?: string
  }> = []

  const policyAuthorize: DataPlaneDeps['policyAuthorize'] = {
    async authorize() {
      return { result: 'allow', id: 'policy-data-plane-allow', reasons: [] }
    }
  }
  const listMembers: DataPlaneDeps['listMembers'] = async input => ({
    ok: true,
    value: members.filter(member => member.networkId === input.networkId)
  })
  const eventPublisher: NonNullable<DataPlaneDeps['events']> = {
    async publish(subject, type, payload, correlationId) {
      events.push({
        subject,
        type,
        payload,
        ...(correlationId === undefined ? {} : { correlationId })
      })
    }
  }
  const log: NonNullable<DataPlaneDeps['log']> = {
    async writeTimeline() {},
    async writeFull() {},
    async writeAudit() {}
  }
  const resolveNetBirdControlPlane: NonNullable<
    DataPlaneDeps['resolveNetBirdControlPlane']
  > = async () => ({
    managementUrl: 'https://netbird.lifecycle.test',
    setupKey: 'netbird-lifecycle-setup-key',
    signalConfigRef: { configRef: 'netbird/signal/lifecycle' },
    relayConfigRef: { configRef: 'netbird/relay/lifecycle' },
    stunConfigRef: { configRef: 'netbird/stun/lifecycle' },
    sidecarCredentialRef: {
      provider: 'vault-kv-v2',
      keyPath: 'secret/data/mnet/lifecycle-sidecar',
      version: 1
    },
    sidecarCredentialStatus: 'ready',
    sidecarHealthStatus: 'healthy',
    prerequisites: { signalReady: true, relayReady: true, stunReady: true }
  })
  const dataPlaneDeps: DataPlaneDeps = {
    profileStore,
    policyAuthorize,
    listMembers,
    dataPlane,
    events: eventPublisher,
    log,
    resolveNetBirdControlPlane
  }
  const breakGlassDeps: BreakGlassDataPlaneDeps = {
    profileStore,
    policyAuthorize,
    listMembers,
    dataPlane,
    events: eventPublisher,
    log
  }
  const migrationEngine = createMigrationEngine({
    globalDefaultsStore,
    profileStore,
    dataPlane,
    listMembers,
    async writeAudit() {
      return 'migration-lifecycle-audit'
    },
    async writeFull() {},
    async writeTimeline() {}
  })

  return {
    dataPlane,
    profileStore,
    globalDefaultsStore,
    members,
    events,
    dataPlaneDeps,
    breakGlassDeps,
    migrationEngine
  }
}

export const netBirdDeploymentConfig: DeploymentConfigV02FromSchema = {
  track: 'nixos',
  serviceUrls: {
    core: 'http://core.lifecycle.test',
    mnet: 'http://mnet.lifecycle.test',
    policy: 'http://policy.lifecycle.test',
    log: 'http://log.lifecycle.test',
    eventbus: 'http://eventbus.lifecycle.test',
    task: 'http://task.lifecycle.test',
    extension: 'http://extension.lifecycle.test',
    uiBff: 'http://ui-bff.lifecycle.test',
    nodeAgent: 'http://node-agent.lifecycle.test'
  },
  internalAuth: {
    headerName: 'x-meristem-internal-token',
    tokenEnvVar: 'MERISTEM_INTERNAL_TOKEN'
  },
  oidc: {
    provider: 'oidc',
    issuer: 'https://keycloak.lifecycle.test/realms/meristem',
    audiences: ['meristem-core']
  },
  secretProvider: {
    providerName: 'runtime',
    backend: 'local-dev-env',
    namedProvider: {
      name: 'runtime',
      config: {
        backend: 'local-dev-env',
        envMappings: {}
      }
    }
  },
  secretBindings: [],
  netbird: {
    signalEndpoint: 'https://signal.lifecycle.test',
    relayEndpoint: 'https://relay.lifecycle.test',
    stunEndpoint: 'stun:stun.lifecycle.test:3478'
  },
  nodeAgentCapabilities: {
    netAdmin: true,
    wireguardModulePath: '/lib/modules/wireguard.ko',
    wgBinaryPath: '/usr/bin/wg',
    ipBinaryPath: '/usr/bin/ip'
  },
  readiness: {
    postgres: { kind: 'postgres-select-1', target: 'postgres' },
    core: { kind: 'http-get', target: 'core', endpoint: '/ready' },
    mnet: { kind: 'http-get', target: 'mnet', endpoint: '/ready' },
    policy: { kind: 'http-get', target: 'policy', endpoint: '/ready' },
    log: { kind: 'http-get', target: 'log', endpoint: '/ready' },
    eventbus: { kind: 'http-get', target: 'eventbus', endpoint: '/ready' },
    task: { kind: 'http-get', target: 'task', endpoint: '/ready' },
    extension: { kind: 'http-get', target: 'extension', endpoint: '/ready' },
    uiBff: { kind: 'http-get', target: 'ui-bff', endpoint: '/ready' },
    nodeAgent: { kind: 'http-get', target: 'node-agent', endpoint: '/ready' }
  }
}

export const netBirdDesiredSidecar: NodeAgentRuntimeDesiredSidecar = {
  desiredState: 'start',
  credentialStatus: 'ready',
  healthStatus: 'healthy',
  signalConfigRef: { configRef: 'netbird/signal/lifecycle' },
  relayConfigRef: { configRef: 'netbird/relay/lifecycle' },
  stunConfigRef: { configRef: 'netbird/stun/lifecycle' },
  sidecarCredentialRef: { provider: 'runtime', keyPath: 'netbird/sidecar/lifecycle' }
}

export function createNetBirdSecretManager(
  secrets: Readonly<Record<string, string>>
): SecretManager {
  return {
    async read(ref) {
      const value = secrets[ref.keyPath]
      return value
        ? { ok: true, value }
        : {
            ok: false,
            error: {
              code: 'secret_missing',
              provider: ref.provider,
              ref: { provider: ref.provider, keyPath: ref.keyPath },
              message: 'secret is missing'
            }
          }
    },
    async list() {
      return { ok: true, value: Object.keys(secrets) }
    },
    async write() {
      return { ok: true, value: undefined }
    }
  }
}

export function completeNetBirdSecrets(): Readonly<Record<string, string>> {
  return {
    'netbird/signal/lifecycle': 'signal-lifecycle-secret',
    'netbird/relay/lifecycle': 'relay-lifecycle-secret',
    'netbird/stun/lifecycle': 'stun-lifecycle-secret',
    'netbird/sidecar/lifecycle': 'sidecar-lifecycle-secret'
  }
}

type LifecycleNodeRow = typeof nodes.$inferSelect

export function createHeartbeatRuntimeHarness(initial: Partial<LifecycleNodeRow> = {}) {
  let currentNode: LifecycleNodeRow = {
    id: lifecycleNodeId,
    kind: 'leaf',
    name: 'M-Net lifecycle proof node',
    mode: 'agent',
    status: 'healthy',
    reachability: 'reachable',
    lastSeenAt: new Date(lifecycleStartedAt),
    agentVersion: '0.1.0',
    capabilities: ['session'],
    scope: {},
    createdAt: new Date(lifecycleStartedAt),
    updatedAt: new Date(lifecycleStartedAt),
    ...initial
  }
  const events: Array<{ subject: string; type: string; payload: unknown }> = []
  const timeline: Array<{ summary: string; subject?: string }> = []
  const audits: Array<{ resource: string; action: string; payload: unknown }> = []
  let eventUnavailable = false
  let timelineUnavailable = false
  let fullLogUnavailable = false
  let auditUnavailable = false

  const db: HeartbeatRuntimeContext['db'] = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                async limit() {
                  return [currentNode]
                }
              }
            }
          }
        }
      }
    },
    update() {
      return {
        set(values: Partial<LifecycleNodeRow>) {
          return {
            async where() {
              currentNode = { ...currentNode, ...values }
            }
          }
        }
      }
    }
  }

  const context: HeartbeatRuntimeContext = {
    db,
    async publishEvent(subject, type, payload) {
      if (eventUnavailable) throw new Error('event bus unavailable')
      events.push({ subject, type, payload })
    },
    async writeTimeline(summary, subject) {
      if (timelineUnavailable) throw new Error('timeline unavailable')
      timeline.push({ summary, ...(subject === undefined ? {} : { subject }) })
    },
    async writeFull() {
      if (fullLogUnavailable) throw new Error('full log unavailable')
    },
    async writeAudit(resource, action, _correlationId, _traceId, payload) {
      if (auditUnavailable) throw new Error('audit unavailable')
      audits.push({ resource, action, payload })
    }
  }

  return {
    context,
    events,
    timeline,
    audits,
    snapshot() {
      return { ...currentNode }
    },
    setNode(values: Partial<LifecycleNodeRow>) {
      currentNode = { ...currentNode, ...values }
    },
    setAvailability(input: {
      eventUnavailable?: boolean
      timelineUnavailable?: boolean
      fullLogUnavailable?: boolean
      auditUnavailable?: boolean
    }) {
      eventUnavailable = input.eventUnavailable ?? eventUnavailable
      timelineUnavailable = input.timelineUnavailable ?? timelineUnavailable
      fullLogUnavailable = input.fullLogUnavailable ?? fullLogUnavailable
      auditUnavailable = input.auditUnavailable ?? auditUnavailable
    }
  }
}
