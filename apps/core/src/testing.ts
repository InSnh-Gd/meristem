import { err, ok } from '../../../packages/common/src/result.ts'
import type {
  ActorId,
  AssignTaskRequest,
  AuditLog,
  CreateNetworkRequest,
  FullLog,
  MNode,
  MNetwork,
  MNetworkMember,
  NetworkSummary,
  MTask,
  Permission,
  PolicyDecision,
  RegisterNodeRequest,
  TimelineLog
} from '../../../packages/contracts/src/index.ts'
import { rolePermissions, decidePermission } from '../../../packages/policy/src/index.ts'
import type { CoreDeps } from './types.ts'

type InMemoryOptions = {
  actor?: ActorId
  policyAvailable?: boolean
  auditAvailable?: boolean
  mNetAvailable?: boolean
}

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

  return {
    startedAt: Date.now(),
    version: '0.1.0-test',
    auth: {
      async verify() {
        return { ok: true as const, actor }
      }
    },
    policy: {
      async authorize(input) {
        if (options.policyAvailable === false) {
          return err({ code: 'policy.unavailable', message: 'M-Policy unavailable' })
        }
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
    storage: {
      async readiness() {
        return { postgres: 'ready', nats: 'ready' }
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
          status: 'healthy',
          capabilities: input.capabilities ?? [],
          createdAt: now
        }
        nodes.push(node)
        return node
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
      async getTask(id: string) {
        return tasks.find((task) => task.id === id) ?? null
      },
      async registerService(input: unknown) {
        services.push(input)
        return input
      },
      async listServices() {
        return services
      }
    }
  }
}
