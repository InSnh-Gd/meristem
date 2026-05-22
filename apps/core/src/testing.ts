import { err, ok } from '../../../packages/common/src/result.ts'
import { hashNodeToken, mintNodeToken } from '../../../packages/auth/src/index.ts'
import type {
  ActorId,
  AssignTaskRequest,
  AuditLog,
  CreateNodeTicketRequest,
  CreateNetworkRequest,
  FullLog,
  MNode,
  MNetwork,
  MNetworkMember,
  NodeAgentTaskExecuteResponse,
  NetworkSummary,
  MTask,
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
  // Phase 10
  searchAvailable?: boolean
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
  const nodes: MNode[] = []
  const tasks: MTask[] = []
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
        return { services: services.length, nodes: nodes.length, tasks: tasks.length }
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
      async assignTask(input: AssignTaskRequest) {
        const node = nodes.find((candidate) => candidate.id === input.leafNodeId)
        if (!node || node.kind !== 'leaf') throw new Error('target must be an existing Leaf node')
        const now = new Date().toISOString()
        const task: MTask = {
          id: crypto.randomUUID(),
          leafNodeId: input.leafNodeId,
          type: 'noop',
          status: 'completed',
          createdAt: now,
          completedAt: now
        }
        tasks.push(task)
        return task
      },
      async createTaskRequest(input: AssignTaskRequest) {
        const node = nodes.find((candidate) => candidate.id === input.leafNodeId)
        if (!node || node.kind !== 'leaf') throw new Error('target must be an existing Leaf node')
        const task: MTask = {
          id: crypto.randomUUID(),
          leafNodeId: input.leafNodeId,
          type: 'noop',
          status: 'requested',
          createdAt: new Date().toISOString()
        }
        tasks.push(task)
        return task
      },
      async completeTask(input: { taskId: string; completedAt: string }) {
        const task = tasks.find((candidate) => candidate.id === input.taskId) ?? null
        if (!task) return null
        task.status = 'completed'
        task.completedAt = input.completedAt
        return task
      },
      async getTask(id: string) {
        return tasks.find((task) => task.id === id) ?? null
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
