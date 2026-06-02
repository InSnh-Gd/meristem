import { err, ok } from '../../../packages/common/src/result.ts'
import { hashNodeToken, mintNodeToken } from '../../../packages/auth/src/index.ts'
import type {
  ActorId,
  AuditLog,
  CreateNodeTicketRequest,
  CreateNetworkRequest,
  FullLog,
  MNode,
  MNetwork,
  MNetworkMember,
  NodeAgentTaskExecuteResponse,
  NetworkSummary,
  Permission,
  PolicyDecision,
  RegisterNodeRequest,
  ServiceSummary,
  TimelineLog
} from '../../../packages/contracts/src/index.ts'
import { rolePermissions, decidePermission } from '../../../packages/policy/src/index.ts'
import type { CoreDeps } from './types.ts'
import type { BackfillParams, BackfillResult, DLQRecord, ProjectionHealth } from '../../../packages/contracts/src/index.ts'

// 内存依赖只服务测试和契约验证，不模拟生产级并发、事务或网络抖动。
type InMemoryOptions = {
  actor?: ActorId
  policyAvailable?: boolean
  auditAvailable?: boolean
  mNetAvailable?: boolean
  searchAvailable?: boolean
  introspectionAvailable?: boolean
  configPolicyRequired?: boolean
}

type IdentityActorRecord = {
  id: ActorId
  displayName: string
  status: 'active' | 'disabled'
  createdAt: string
  updatedAt: string
}

type IdentityTokenRecord = {
  jti: string
  token: string
  actor: ActorId
  issuer: 'meristem-local'
  audience: 'meristem-core' | 'meristem-service'
  issuedAt: string
  expiresAt: string
  issuedBy: ActorId
  purpose: string
  status: 'active' | 'revoked' | 'expired'
  createdAt: string
  updatedAt: string
  revokedAt?: string
  revokedBy?: ActorId
  revokeReason?: string
  correlationId: string
}

type SecretRefRecord = {
  id: string
  name: string
  scope: string
  status: 'active' | 'rotated' | 'disabled'
  createdBy: ActorId
  createdAt: string
  updatedAt: string
  metadata: Record<string, string>
}

type SecretVersionRecord = {
  id: string
  secretRefId: string
  version: string
  value: string
  createdBy: ActorId
  createdAt: string
  disabledAt?: string
}

type ConfigRecord = {
  id: string
  configVersion: string
  schemaVersion: string
  configHash: string
  domain: string
  targetScope: string[]
  status: 'draft' | 'validated' | 'published' | 'applied' | 'failed' | 'rolled_back'
  payload: unknown
  createdBy: ActorId
  createdAt: string
  publishedBy?: ActorId
  publishedAt?: string
  rollbackVersion?: string
  updatedAt: string
}

type ConfigAckRecord = {
  ackId: string
  configId: string
  version: string
  targetService: string
  status: string
  error?: string
  correlationId: string
  ackedAt: string
}

function parseDurationMs(ttl: string): number | null {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(ttl)
  if (!match) return null
  const value = Number(match[1])
  const unit = match[2]
  const multiplier = unit === 'ms'
    ? 1
    : unit === 's'
      ? 1000
      : unit === 'm'
        ? 60_000
        : unit === 'h'
          ? 3_600_000
          : 86_400_000
  return value * multiplier
}

function encodeMockJwt(payload: { jti: string; actor: string }): string {
  return `mock-jwt.${encodeURIComponent(JSON.stringify(payload))}.sig`
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, '0')).join('')
}

function configVersionFor(index: number): string {
  return `1.0.${index}`
}

function latestSecretVersion(secretVersions: SecretVersionRecord[], secretRefId: string): SecretVersionRecord | null {
  return secretVersions
    .filter((version) => version.secretRefId === secretRefId)
    .at(-1) ?? null
}

function asServiceSummary(value: unknown): ServiceSummary | null {
  if (typeof value !== 'object' || value === null) return null

  const id = Reflect.get(value, 'id')
  const version = Reflect.get(value, 'version')
  const domain = Reflect.get(value, 'domain')
  const kind = Reflect.get(value, 'kind')

  if (typeof id !== 'string' || typeof version !== 'string' || typeof domain !== 'string' || typeof kind !== 'string') {
    return null
  }

  const normalizedKind = kind === 'service' ? 'internal' : kind
  const validDomain = domain === 'core'
    || domain === 'm-net'
    || domain === 'm-eventbus'
    || domain === 'm-log'
    || domain === 'm-policy'
    || domain === 'm-ui'
    || domain === 'm-cli'
    || domain === 'm-extension'
  const validKind = normalizedKind === 'core'
    || normalizedKind === 'internal'
    || normalizedKind === 'node'
    || normalizedKind === 'task'
    || normalizedKind === 'extension'
    || normalizedKind === 'bff'

  if (!validDomain || !validKind) return null

  return {
    id,
    version,
    domain,
    kind: normalizedKind,
    lifecycle: { reloadable: false, rollbackable: false, degradable: true },
    runtime: {
      liveness: false,
      readiness: false,
      mode: 'degraded',
      lastError: 'runtime state is not exposed for this service definition'
    }
  }
}

/**
 * createInMemoryCoreDeps 把 Core 需要的所有外部端口压缩成可预测的内存实现，
 * 让契约测试能在不启动 PostgreSQL/NATS/内部服务的前提下覆盖主业务语义。
 */
export function createInMemoryCoreDeps(options: InMemoryOptions = {}): CoreDeps {
  const actor = options.actor ?? 'operator'
  const now = new Date().toISOString()
  const nodes: MNode[] = []
  const taskCount = { value: 0 }
  const services: unknown[] = []
  const networks: MNetwork[] = []
  const memberships: MNetworkMember[] = []
  const timeline: TimelineLog[] = []
  const audit: AuditLog[] = []
  const full: FullLog[] = []
  const decisions: PolicyDecision[] = []
  const joinTickets = new Map<
    string,
    CreateNodeTicketRequest & { createdBy: ActorId; expiresAt: string; ticket: string }
  >()
  const nodeCredentials = new Map<string, { token: string; tokenHash: string; status: 'active' | 'revoked'; issuedAt: string; lastUsedAt?: string }>()
  const simulatedAgentExecutions = new Map<string, { completedAt: string }>()
  const actors: IdentityActorRecord[] = [
    { id: 'viewer', displayName: 'Viewer', status: 'active', createdAt: now, updatedAt: now },
    { id: 'operator', displayName: 'Operator', status: 'active', createdAt: now, updatedAt: now },
    { id: 'admin', displayName: 'Admin', status: 'active', createdAt: now, updatedAt: now },
    { id: 'security-admin', displayName: 'Security Admin', status: 'active', createdAt: now, updatedAt: now }
  ]
  const actorTokens: IdentityTokenRecord[] = []
  const secretRefs: SecretRefRecord[] = []
  const secretVersions: SecretVersionRecord[] = []
  const configRecords: ConfigRecord[] = []
  const configAcks: ConfigAckRecord[] = []

  function configOpsRequirePolicy(): boolean {
    return options.configPolicyRequired !== false
  }

  function ensureAuditAvailable(code: string, message: string) {
    return options.auditAvailable === false ? err({ code, message }) : null
  }

  function ensurePolicyAvailable(code: string, message: string) {
    return options.policyAvailable === false ? err({ code, message }) : null
  }

  function markExpiredToken(record: IdentityTokenRecord): IdentityTokenRecord {
    if (record.status === 'active' && Date.parse(record.expiresAt) <= Date.now()) {
      record.status = 'expired'
      record.updatedAt = new Date().toISOString()
    }
    return record
  }
  // 内建服务运行态在测试里显式建模，方便验证 reload、ready 和降级分支。
  const builtinServices: ServiceSummary[] = [
    {
      id: 'meristem-core',
      version: '0.1.0-test',
      domain: 'core',
      kind: 'core',
      lifecycle: { reloadable: false, rollbackable: false, degradable: true },
      runtime: { liveness: true, readiness: true, mode: 'normal' }
    },
    {
      id: 'm-policy',
      version: '0.1.0-test',
      domain: 'm-policy',
      kind: 'internal',
      lifecycle: { reloadable: false, rollbackable: false, degradable: true },
      runtime: { liveness: true, readiness: options.policyAvailable !== false, mode: options.policyAvailable === false ? 'degraded' : 'normal' }
    },
    {
      id: 'm-log',
      version: '0.1.0-test',
      domain: 'm-log',
      kind: 'internal',
      lifecycle: { reloadable: true, rollbackable: false, degradable: true },
      runtime: { liveness: true, readiness: options.auditAvailable !== false, mode: options.auditAvailable === false ? 'degraded' : 'normal' }
    },
    {
      id: 'm-eventbus',
      version: '0.1.0-test',
      domain: 'm-eventbus',
      kind: 'internal',
      lifecycle: { reloadable: false, rollbackable: false, degradable: true },
      runtime: { liveness: true, readiness: true, mode: 'normal' }
    },
    {
      id: 'm-net',
      version: '0.1.0-test',
      domain: 'm-net',
      kind: 'internal',
      lifecycle: { reloadable: false, rollbackable: false, degradable: true },
      runtime: { liveness: true, readiness: options.mNetAvailable !== false, mode: options.mNetAvailable === false ? 'degraded' : 'normal' }
    }
  ]

  const deps: CoreDeps & {
    __testing: {
      setNodeRuntime(nodeId: string, patch: Partial<Pick<MNode, 'status' | 'reachability' | 'lastSeenAt' | 'agentVersion'>>): void
    }
  } = {
    startedAt: Date.now(),
    version: '0.1.0-test',
    joinIngressPublicUrl: 'https://localhost:8443',
    auth: {
      async verify() {
        return { ok: true as const, actor }
      },
      async getPermissions() {
        return ok((rolePermissions[actor] ?? []) as Permission[])
      }
    },
    policy: {
      async authorize(input) {
        if (options.policyAvailable === false) {
          return err({ code: 'policy.unavailable', message: 'M-Policy unavailable' })
        }
        // 测试授权逻辑复用同一套纯函数策略规则，避免桩和生产语义脱节。
        const draft = decidePermission({
          actor: input.actor,
          action: input.action,
          resource: input.resource,
          permissions: rolePermissions[input.actor] as readonly Permission[]
        })
        const decision: PolicyDecision = {
          ...draft,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString()
        }
        decisions.push(decision)
        return ok(decision)
      },
      async getDecision(id: string) {
        return ok(decisions.find((decision) => decision.id === id) ?? null)
      }
    },
    log: {
      async writeTimeline(input) {
        const entry = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...input }
        timeline.unshift(entry)
        return ok(entry)
      },
      async writeFull(input) {
        const entry = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...input }
        full.unshift(entry)
        return ok(entry)
      },
      async writeAudit(input) {
        if (options.auditAvailable === false) {
          return err({ code: 'audit.unavailable', message: 'Audit Log unavailable' })
        }
        const entry = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...input }
        audit.unshift(entry)
        return ok(entry)
      },
      async listTimeline() {
        return ok(timeline)
      },
      async listFull() {
        return ok(full)
      },
      async listAudit() {
        return ok(audit)
      },
      async searchFull(_query) {
        if (options.searchAvailable === false) {
          return err({ code: 'search.unavailable', message: 'search unavailable' })
        }
        return ok({ entries: [], total: 0 })
      },
      async searchTimeline(_query) {
        if (options.searchAvailable === false) {
          return err({ code: 'search.unavailable', message: 'search unavailable' })
        }
        return ok({ entries: [], total: 0 })
      },
      async searchAudit(_query) {
        if (options.searchAvailable === false) {
          return err({ code: 'search.unavailable', message: 'search unavailable' })
        }
        return ok({ entries: [], total: 0 })
      }
    },
    events: {
      async publish(_subject, event) {
        return ok({ eventId: event.id })
      }
    },
    mNet: {
      async createNetwork(input: CreateNetworkRequest) {
        if (options.mNetAvailable === false) {
          return err({ code: 'mnet.unavailable', message: 'M-Net unavailable' })
        }

        const existing = networks.find((network) => network.name === input.name)
        if (existing) return err({ code: 'network.conflict', message: 'network name already exists' })

        const network: MNetwork = {
          id: crypto.randomUUID(),
          name: input.name,
          profileVersion: input.profileVersion ?? 'm-net-default@0.1.0',
          status: 'active',
          createdAt: new Date().toISOString()
        }
        networks.push(network)
        return ok(network)
      },
      async listNetworks() {
        if (options.mNetAvailable === false) {
          return err({ code: 'mnet.unavailable', message: 'M-Net unavailable' })
        }

        const summaries: NetworkSummary[] = networks.map((network) => ({
          ...network,
          memberCount: memberships.filter((member) => member.networkId === network.id).length
        }))
        return ok(summaries)
      },
      async joinNetwork(input) {
        if (options.mNetAvailable === false) {
          return err({ code: 'mnet.unavailable', message: 'M-Net unavailable' })
        }

        const network = networks.find((candidate) => candidate.id === input.networkId)
        if (!network) return err({ code: 'network.not_found', message: 'network not found' })

        const node = nodes.find((candidate) => candidate.id === input.nodeId)
        if (!node) return err({ code: 'node.not_found', message: 'node not found' })
        if (node.status !== 'healthy') return err({ code: 'node.invalid_status', message: 'node must be healthy' })

        const existingMembership = memberships.find(
          (membership) => membership.networkId === input.networkId && membership.nodeId === input.nodeId
        )
        if (existingMembership) return ok(existingMembership)

        const stemCount = memberships.filter((membership) => membership.networkId === input.networkId && membership.nodeKind === 'stem').length
        if (node.kind === 'leaf' && stemCount === 0) {
          return err({ code: 'network.stem_required', message: 'leaf nodes require a stem member' })
        }

        const member: MNetworkMember = {
          networkId: network.id,
          nodeId: node.id,
          nodeKind: node.kind,
          membershipMode: node.kind === 'stem' ? 'full' : 'restricted',
          status: 'joined',
          joinedAt: new Date().toISOString()
        }
        memberships.push(member)
        return ok(member)
      },
      async listNetworkMembers(networkId: string) {
        if (options.mNetAvailable === false) {
          return err({ code: 'mnet.unavailable', message: 'M-Net unavailable' })
        }

        const network = networks.find((candidate) => candidate.id === networkId)
        if (!network) return err({ code: 'network.not_found', message: 'network not found' })
        return ok(memberships.filter((membership) => membership.networkId === networkId))
      }
    },
    agentTasks: {
      async executeNoop(input): Promise<ReturnType<typeof ok<NodeAgentTaskExecuteResponse>> | ReturnType<typeof err<{ code: string; message: string }>>> {
        const node = nodes.find((candidate) => candidate.id === input.nodeId)
        if (!node) return err({ code: 'node.not_found', message: 'node not found' })
        if (node.status === 'offline') return err({ code: 'node.unreachable', message: 'node is unreachable' })
        const credential = nodeCredentials.get(input.nodeId)
        if (!credential || credential.status !== 'active') {
          return err({ code: 'node.credential_missing', message: 'node does not have an active credential' })
        }
        const completedAt = simulatedAgentExecutions.get(input.taskId)?.completedAt ?? new Date().toISOString()
        return ok({
          nodeId: input.nodeId,
          taskId: input.taskId,
          result: 'completed',
          completedAt
        })
      }
    },
    services: {
      async list() {
        const registered = services
          .map(asServiceSummary)
          .flatMap((service) => service && !builtinServices.some((builtin) => builtin.id === service.id) ? [service] : [])
        return ok([...builtinServices, ...registered])
      },
      async reload(input) {
        const builtin = builtinServices.find((service) => service.id === input.serviceId)
        if (!builtin) {
          const registered = services.find((service) => typeof service === 'object' && service !== null && Reflect.get(service, 'id') === input.serviceId)
          return registered
            ? err({ code: 'service.not_reloadable', message: 'service is not reloadable' })
            : err({ code: 'service.not_found', message: 'service not found' })
        }
        if (!builtin.lifecycle.reloadable) {
          return err({ code: 'service.not_reloadable', message: 'service is not reloadable' })
        }
        const reloadedAt = new Date().toISOString()
        builtin.runtime = { ...(builtin.runtime ?? { liveness: true, readiness: true, mode: 'normal' }), lastReloadedAt: reloadedAt }
        return ok({ serviceId: input.serviceId, reloadedAt })
      }
    },
    projection: {
      async getHealth() {
        const empty: ProjectionHealth[] = []
        return ok(empty)
      },
      async executeBackfill(_params: BackfillParams) {
        const result: BackfillResult = {
          jobId: crypto.randomUUID(),
          processedCount: 0,
          errors: 0,
          lastCursor: null,
          status: 'completed'
        }
        return ok(result)
      },
      async listDLQ(_index?: string) {
        const records: DLQRecord[] = []
        return ok(records)
      },
      async replayDLQ(_dlqId: string) {
        return ok(true)
      },
      async skipDLQ(_dlqId: string) {
        return ok(true)
      }
    },
    identity: {
      async listActors() {
        return ok(actors.map(({ id, displayName, status, createdAt, updatedAt }) => ({ id, displayName, status, createdAt, updatedAt })))
      },
      async getActor(id) {
        const record = actors.find((candidate) => candidate.id === id)
        return ok(record ? { ...record } : null)
      },
      async issueToken(input) {
        const identityActor = actors.find((candidate) => candidate.id === input.actor)
        if (!identityActor) {
          return err({ code: 'identity.actor.not_found', message: 'identity actor not found' })
        }
        const ttlMs = parseDurationMs(input.ttl)
        if (ttlMs === null) {
          return err({ code: 'identity.ttl.invalid', message: 'identity token ttl must use ms/s/m/h/d units' })
        }
        const issuedAt = new Date().toISOString()
        const expiresAt = new Date(Date.now() + ttlMs).toISOString()
        const jti = crypto.randomUUID()
        const token = encodeMockJwt({ jti, actor: input.actor })
        actorTokens.push({
          jti,
          token,
          actor: identityActor.id,
          issuer: 'meristem-local',
          audience: 'meristem-service',
          issuedAt,
          expiresAt,
          issuedBy: actor,
          purpose: input.purpose,
          status: 'active',
          createdAt: issuedAt,
          updatedAt: issuedAt,
          correlationId: input.correlationId
        })
        return ok({ jti, token, expiresAt, actor: identityActor.id })
      },
      async inspectToken(jti) {
        if (options.introspectionAvailable === false) {
          return err({ code: 'identity.introspection.unavailable', message: 'identity introspection unavailable' })
        }
        const record = actorTokens.find((candidate) => candidate.jti === jti)
        if (!record) return ok(null)
        const token = markExpiredToken(record)
        return ok({
          jti: token.jti,
          actor: token.actor,
          issuer: token.issuer,
          audience: token.audience,
          issuedAt: token.issuedAt,
          expiresAt: token.expiresAt,
          issuedBy: token.issuedBy,
          purpose: token.purpose,
          status: token.status,
          ...(token.revokedAt ? { revokedAt: token.revokedAt } : {}),
          ...(token.revokedBy ? { revokedBy: token.revokedBy } : {}),
          ...(token.revokeReason ? { revokeReason: token.revokeReason } : {})
        })
      },
      async revokeToken(jti, _input) {
        const auditUnavailable = ensureAuditAvailable('audit.unavailable', 'Audit Log unavailable')
        if (auditUnavailable) return auditUnavailable
        const record = actorTokens.find((candidate) => candidate.jti === jti)
        if (!record) {
          return err({ code: 'identity.token.not_found', message: 'identity token not found' })
        }
        const revokedAt = record.revokedAt ?? new Date().toISOString()
        record.status = 'revoked'
        record.revokedAt = revokedAt
        record.revokedBy = actor
        record.updatedAt = revokedAt
        record.revokeReason = _input.reason
        return ok({ jti: record.jti, status: record.status, revokedAt, revokedBy: actor })
      },
      async introspect(jti) {
        if (options.introspectionAvailable === false) {
          return err({ code: 'identity.introspection.unavailable', message: 'identity introspection unavailable' })
        }
        const record = actorTokens.find((candidate) => candidate.jti === jti)
        if (!record) return ok({ active: false })
        const token = markExpiredToken(record)
        if (token.status !== 'active') return ok({ active: false })
        return ok({ active: true, actor: token.actor, jti: token.jti })
      }
    },
    secrets: {
      async list() {
        return ok(secretRefs.map(({ id, name, scope, status, createdBy, createdAt, metadata }) => ({
          id,
          name,
          scope,
          status,
          createdBy,
          createdAt,
          metadata: { ...metadata }
        })))
      },
      async get(id) {
        const record = secretRefs.find((candidate) => candidate.id === id)
        return ok(record ? {
          id: record.id,
          name: record.name,
          scope: record.scope,
          status: record.status,
          createdBy: record.createdBy,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          metadata: { ...record.metadata }
        } : null)
      },
      async create(input) {
        const policyUnavailable = ensurePolicyAvailable('policy.unavailable', 'M-Policy unavailable')
        if (policyUnavailable) return policyUnavailable
        const auditUnavailable = ensureAuditAvailable('audit.unavailable', 'Audit Log unavailable')
        if (auditUnavailable) return auditUnavailable
        const createdAt = new Date().toISOString()
        const id = crypto.randomUUID()
        const version = 'v1'
        secretRefs.push({
          id,
          name: input.name,
          scope: input.scope,
          status: 'active',
          createdBy: actor,
          createdAt,
          updatedAt: createdAt,
          metadata: { ...(input.metadata ?? {}) }
        })
        secretVersions.push({
          id: crypto.randomUUID(),
          secretRefId: id,
          version,
          value: input.value,
          createdBy: actor,
          createdAt
        })
        return ok({ id, name: input.name, status: 'active', createdAt })
      },
      async rotate(id, input) {
        const policyUnavailable = ensurePolicyAvailable('policy.unavailable', 'M-Policy unavailable')
        if (policyUnavailable) return policyUnavailable
        const auditUnavailable = ensureAuditAvailable('audit.unavailable', 'Audit Log unavailable')
        if (auditUnavailable) return auditUnavailable
        const record = secretRefs.find((candidate) => candidate.id === id)
        if (!record) {
          return err({ code: 'secret.not_found', message: 'secret ref not found' })
        }
        const rotatedAt = new Date().toISOString()
        const version = `v${secretVersions.filter((candidate) => candidate.secretRefId === id).length + 1}`
        record.status = 'rotated'
        record.updatedAt = rotatedAt
        secretVersions.push({
          id: crypto.randomUUID(),
          secretRefId: id,
          version,
          value: input.value,
          createdBy: actor,
          createdAt: rotatedAt
        })
        return ok({ id, version, status: record.status, rotatedAt })
      },
      async disable(id, _input) {
        const policyUnavailable = ensurePolicyAvailable('policy.unavailable', 'M-Policy unavailable')
        if (policyUnavailable) return policyUnavailable
        const auditUnavailable = ensureAuditAvailable('audit.unavailable', 'Audit Log unavailable')
        if (auditUnavailable) return auditUnavailable
        const record = secretRefs.find((candidate) => candidate.id === id)
        if (!record) {
          return err({ code: 'secret.not_found', message: 'secret ref not found' })
        }
        const disabledAt = new Date().toISOString()
        record.status = 'disabled'
        record.updatedAt = disabledAt
        const currentVersion = latestSecretVersion(secretVersions, id)
        if (currentVersion && !currentVersion.disabledAt) {
          currentVersion.disabledAt = disabledAt
        }
        return ok({ id, status: record.status, disabledAt })
      },
      async reference(id) {
        const record = secretRefs.find((candidate) => candidate.id === id)
        if (!record) {
          return err({ code: 'secret.not_found', message: 'secret ref not found' })
        }
        const currentVersion = latestSecretVersion(secretVersions, id)
        if (!currentVersion) {
          return err({ code: 'secret.version.not_found', message: 'secret version not found' })
        }
        return ok({ id, currentVersion: currentVersion.version, status: record.status, metadata: { ...record.metadata } })
      }
    },
    config: {
      async list() {
        return ok(configRecords.map(({ id, configVersion, domain, status, createdBy, createdAt }) => ({ id, configVersion, domain, status, createdBy, createdAt })))
      },
      async get(id) {
        const record = configRecords.find((candidate) => candidate.id === id)
        return ok(record ? {
          id: record.id,
          configVersion: record.configVersion,
          schemaVersion: record.schemaVersion,
          configHash: record.configHash,
          domain: record.domain,
          targetScope: [...record.targetScope],
          status: record.status,
          payload: record.payload,
          createdBy: record.createdBy,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          ...(record.publishedBy ? { publishedBy: record.publishedBy } : {}),
          ...(record.publishedAt ? { publishedAt: record.publishedAt } : {}),
          ...(record.rollbackVersion ? { rollbackVersion: record.rollbackVersion } : {})
        } : null)
      },
      async draft(input) {
        const createdAt = new Date().toISOString()
        const id = crypto.randomUUID()
        const configVersion = configVersionFor(configRecords.length + 1)
        const configHash = await sha256Hex(JSON.stringify(input.payload))
        configRecords.push({
          id,
          configVersion,
          schemaVersion: 'config@0.1.0',
          configHash,
          domain: input.domain,
          targetScope: [...(input.targetScope ?? [])],
          status: 'draft',
          payload: input.payload,
          createdBy: actor,
          createdAt,
          updatedAt: createdAt
        })
        return ok({ id, configVersion, status: 'draft', createdAt })
      },
      async validate(id) {
        const record = configRecords.find((candidate) => candidate.id === id)
        if (!record) {
          return err({ code: 'config.not_found', message: 'config record not found' })
        }
        if (record.status !== 'draft') {
          return err({ code: 'config.invalid_state', message: 'config record must be in draft state' })
        }
        record.status = 'validated'
        record.updatedAt = new Date().toISOString()
        return ok({ id: record.id, status: record.status })
      },
      async publish(id, _input) {
        if (configOpsRequirePolicy()) {
          const policyUnavailable = ensurePolicyAvailable('policy.unavailable', 'M-Policy unavailable')
          if (policyUnavailable) return policyUnavailable
        }
        const record = configRecords.find((candidate) => candidate.id === id)
        if (!record) {
          return err({ code: 'config.not_found', message: 'config record not found' })
        }
        if (record.status !== 'validated') {
          return err({ code: 'config.invalid_state', message: 'config record must be validated before publish' })
        }
        const publishedAt = new Date().toISOString()
        record.status = 'published'
        record.publishedAt = publishedAt
        record.publishedBy = actor
        record.updatedAt = publishedAt
        return ok({ id: record.id, configVersion: record.configVersion, status: record.status, publishedAt, publishedBy: actor })
      },
      async rollback(id, input) {
        if (configOpsRequirePolicy()) {
          const policyUnavailable = ensurePolicyAvailable('policy.unavailable', 'M-Policy unavailable')
          if (policyUnavailable) return policyUnavailable
        }
        const record = configRecords.find((candidate) => candidate.id === id)
        if (!record) {
          return err({ code: 'config.not_found', message: 'config record not found' })
        }
        record.status = 'rolled_back'
        record.rollbackVersion = input.toVersion
        record.updatedAt = new Date().toISOString()
        return ok({ id: record.id, status: record.status })
      },
      async applyAck(id, input) {
        const record = configRecords.find((candidate) => candidate.id === id)
        if (!record) {
          return err({ code: 'config.not_found', message: 'config record not found' })
        }
        const existing = configAcks.find((candidate) => candidate.configId === id && candidate.targetService === input.targetService && candidate.version === input.version)
        if (existing) {
          return ok({ ackId: existing.ackId, status: existing.status, ackedAt: existing.ackedAt })
        }
        if (input.status === 'pending') {
          return err({ code: 'config.ack_timeout', message: 'config apply ack timed out while pending' })
        }
        const ackedAt = new Date().toISOString()
        const ack: ConfigAckRecord = {
          ackId: crypto.randomUUID(),
          configId: id,
          version: input.version,
          targetService: input.targetService,
          status: input.status,
          ...(input.error ? { error: input.error } : {}),
          correlationId: input.correlationId,
          ackedAt
        }
        configAcks.push(ack)
        record.status = input.status === 'failed' ? 'failed' : 'applied'
        record.updatedAt = ackedAt
        return ok({ ackId: ack.ackId, status: ack.status, ackedAt })
      }
    },
    storage: {
      async readiness() {
        return {
          postgres: 'ready',
          nats: 'ready',
          'm-policy': options.policyAvailable === false ? 'unavailable' : 'ready',
          'm-log': options.auditAvailable === false ? 'unavailable' : 'ready',
          'm-eventbus': 'ready',
          'm-net': options.mNetAvailable === false ? 'unavailable' : 'ready'
        }
      },
      async counts() {
        return { services: services.length, nodes: nodes.length, tasks: taskCount.value }
      },
      async registerNode(input: RegisterNodeRequest) {
        const now = new Date().toISOString()
        const node: MNode = {
          id: crypto.randomUUID(),
          kind: input.kind,
          name: input.name,
          mode: 'simulated',
          status: 'healthy',
          reachability: 'reachable',
          capabilities: input.capabilities ?? [],
          createdAt: now
        }
        nodes.push(node)
        return node
      },
      async createNodeTicket(input: CreateNodeTicketRequest & { createdBy: ActorId }) {
        const ticketId = crypto.randomUUID()
        const ticket = `mjt_${crypto.randomUUID().replaceAll('-', '')}`
        const expiresAt = new Date(Date.now() + ((input.expiresInSeconds ?? 300) * 1000)).toISOString()
        joinTickets.set(ticketId, { ...input, ticket, expiresAt })
        return { ticketId, ticket, expiresAt }
      },
      async issueNodeCredential(nodeId: string) {
        const node = nodes.find((candidate) => candidate.id === nodeId)
        if (!node) return null
        const token = mintNodeToken()
        const issuedAt = new Date().toISOString()
        nodeCredentials.set(nodeId, {
          token,
          tokenHash: await hashNodeToken(token),
          status: 'active',
          issuedAt
        })
        return { nodeId, token, issuedAt }
      },
      async hasActiveNodeCredential(nodeId: string) {
        return nodeCredentials.get(nodeId)?.status === 'active'
      },
      async validateNodeCredential(nodeId: string, token: string) {
        const credential = nodeCredentials.get(nodeId)
        if (!credential || credential.status !== 'active') return false
        const tokenHash = await hashNodeToken(token)
        if (tokenHash !== credential.tokenHash) return false
        credential.lastUsedAt = new Date().toISOString()
        return true
      },
      async listNodes() {
        return nodes
      },
      async getNode(id: string) {
        return nodes.find((node) => node.id === id) ?? null
      },
      async registerService(input: unknown) {
        services.push(input)
        return input
      },
      async listServices() {
        return [
          ...builtinServices,
          ...services
            .map(asServiceSummary)
            .flatMap((service) => service ? [service] : [])
        ]
      }
    },
    __testing: {
      // 测试可直接篡改节点运行态，用来覆盖 heartbeat/timeout/离线等场景。
      setNodeRuntime(nodeId, patch) {
        const node = nodes.find((candidate) => candidate.id === nodeId)
        if (!node) return
        if (patch.status) node.status = patch.status
        if (patch.reachability) node.reachability = patch.reachability
        if (patch.lastSeenAt !== undefined) node.lastSeenAt = patch.lastSeenAt
        if (patch.agentVersion !== undefined) node.agentVersion = patch.agentVersion
      }
    }
  }

  return deps
}
