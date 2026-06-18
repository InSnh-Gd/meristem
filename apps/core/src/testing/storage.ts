import { addSeconds } from 'date-fns'
import { hashNodeToken, mintNodeToken } from '../../../../packages/auth/src/index.ts'
import type { CreateNodeTicketRequest, MNode } from '../../../../packages/contracts/src/index.ts'
import type { CoreStorage } from '../types.ts'
import { mergeServiceSummaries } from './network-runtime.ts'
import type {
  InMemoryCoreTestingHelpers,
  InMemoryCoreTestingState,
  NodeRuntimePatch
} from './shared.ts'

/**
 * createStoragePort 维持权威写模型测试边界，同时保留节点与服务注册的可观察状态。
 */
export function createStoragePort(
  state: InMemoryCoreTestingState,
  helpers: InMemoryCoreTestingHelpers
): CoreStorage {
  return {
    async readiness() {
      return {
        postgres: 'ready',
        nats: 'ready',
        'm-policy': helpers.options.policyAvailable === false ? 'unavailable' : 'ready',
        'm-log': helpers.options.auditAvailable === false ? 'unavailable' : 'ready',
        'm-eventbus': 'ready',
        'm-net': helpers.options.mNetAvailable === false ? 'unavailable' : 'ready'
      }
    },
    async counts() {
      return {
        services: state.services.length,
        nodes: state.nodes.length,
        tasks: state.taskCount.value
      }
    },
    async registerNode(input) {
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
      state.nodes.push(node)
      return node
    },
    async createNodeTicket(
      input: CreateNodeTicketRequest & {
        createdBy: import('../../../../packages/contracts/src/index.ts').ActorId
      }
    ) {
      const ticketId = crypto.randomUUID()
      const ticket = `mjt_${crypto.randomUUID().replaceAll('-', '')}`
      const expiresAt = addSeconds(new Date(), input.expiresInSeconds ?? 300).toISOString()
      state.joinTickets.set(ticketId, { ...input, ticket, expiresAt })
      return { ticketId, ticket, expiresAt }
    },
    async issueNodeCredential(nodeId: string) {
      const node = state.nodes.find(candidate => candidate.id === nodeId)
      if (!node) return null
      const token = mintNodeToken()
      const issuedAt = new Date().toISOString()
      state.nodeCredentials.set(nodeId, {
        token,
        tokenHash: await hashNodeToken(token),
        status: 'active',
        issuedAt
      })
      return { nodeId, token, issuedAt }
    },
    async hasActiveNodeCredential(nodeId: string) {
      return state.nodeCredentials.get(nodeId)?.status === 'active'
    },
    async validateNodeCredential(nodeId: string, token: string) {
      const credential = state.nodeCredentials.get(nodeId)
      if (credential?.status !== 'active') return false
      const tokenHash = await hashNodeToken(token)
      if (tokenHash !== credential.tokenHash) return false
      credential.lastUsedAt = new Date().toISOString()
      return true
    },
    async listNodes() {
      return state.nodes
    },
    async getNode(id: string) {
      return state.nodes.find(node => node.id === id) ?? null
    },
    async registerService(input: unknown) {
      state.services.push(input)
      return input
    },
    async listServices() {
      return mergeServiceSummaries(state.builtinServices, state.services)
    }
  }
}

export function createTestingControls(state: InMemoryCoreTestingState): {
  setNodeRuntime(nodeId: string, patch: NodeRuntimePatch): void
} {
  return {
    setNodeRuntime(nodeId, patch) {
      const node = state.nodes.find(candidate => candidate.id === nodeId)
      if (!node) return
      if (patch.status) node.status = patch.status
      if (patch.reachability) node.reachability = patch.reachability
      if (patch.lastSeenAt !== undefined) node.lastSeenAt = patch.lastSeenAt
      if (patch.agentVersion !== undefined) node.agentVersion = patch.agentVersion
    }
  }
}
