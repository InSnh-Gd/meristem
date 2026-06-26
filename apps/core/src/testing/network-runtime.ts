import { err, ok } from '../../../../packages/common/src/result.ts'
import type {
  BackfillParams,
  BackfillResult,
  DLQRecord,
  MNetwork,
  MNetworkMember,
  NetworkSummary,
  NodeAgentTaskExecuteResponse,
  NodeKind,
  NodeStatus,
  ProjectionHealth,
  ServiceSummary
} from '../../../../packages/contracts/src/index.ts'
import type { AgentTaskPort, MNetPort, ProjectionPort, ServiceLifecyclePort } from '../types.ts'
import type { InMemoryCoreTestingHelpers, InMemoryCoreTestingState } from './shared.ts'
import { asServiceSummary } from './shared.ts'

/**
 * createMNetPort 保留组网约束，确保 leaf/stem 依赖与降级语义继续由测试覆盖。
 */
export function createMNetPort(
  state: InMemoryCoreTestingState,
  helpers: InMemoryCoreTestingHelpers
): MNetPort {
  return {
    async createNetwork(input) {
      if (helpers.options.mNetAvailable === false) {
        return err({ code: 'mnet.unavailable', message: 'M-Net unavailable' })
      }

      const existing = state.networks.find(network => network.name === input.name)
      if (existing) {
        return err({ code: 'network.conflict', message: 'network name already exists' })
      }

      const network: MNetwork = {
        id: crypto.randomUUID(),
        name: input.name,
        profileVersion: input.profileVersion ?? 'm-net-default@0.1.0',
        status: 'active',
        createdAt: new Date().toISOString()
      }
      state.networks.push(network)
      return ok(network)
    },
    async listNetworks() {
      if (helpers.options.mNetAvailable === false) {
        return err({ code: 'mnet.unavailable', message: 'M-Net unavailable' })
      }

      const summaries: NetworkSummary[] = state.networks.map(network => ({
        ...network,
        memberCount: state.memberships.filter(member => member.networkId === network.id).length
      }))
      return ok(summaries)
    },
    async joinNetwork(input) {
      if (helpers.options.mNetAvailable === false) {
        return err({ code: 'mnet.unavailable', message: 'M-Net unavailable' })
      }

      const network = state.networks.find(candidate => candidate.id === input.networkId)
      if (!network) return err({ code: 'network.not_found', message: 'network not found' })

      const node = state.nodes.find(candidate => candidate.id === input.nodeId)
      if (!node) return err({ code: 'node.not_found', message: 'node not found' })
      if (node.status !== 'healthy') {
        return err({ code: 'node.invalid_status', message: 'node must be healthy' })
      }

      const existingMembership = state.memberships.find(
        membership => membership.networkId === input.networkId && membership.nodeId === input.nodeId
      )
      if (existingMembership) return ok(existingMembership)

      const stemCount = state.memberships.filter(
        membership => membership.networkId === input.networkId && membership.nodeKind === 'stem'
      ).length
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
      state.memberships.push(member)
      return ok(member)
    },
    async listNetworkMembers(networkId: string) {
      if (helpers.options.mNetAvailable === false) {
        return err({ code: 'mnet.unavailable', message: 'M-Net unavailable' })
      }

      const network = state.networks.find(candidate => candidate.id === networkId)
      if (!network) return err({ code: 'network.not_found', message: 'network not found' })
      return ok(state.memberships.filter(membership => membership.networkId === networkId))
    },
    async controlNode(input) {
      if (helpers.options.mNetAvailable === false) {
        return err({ code: 'mnet.unavailable', message: 'M-Net unavailable' })
      }

      const node = state.nodes.find(candidate => candidate.id === input.nodeId)
      if (!node) return err({ code: 'node.not_found', message: 'node not found' })
      if (input.action === 'switch-role') {
        if (!input.targetKind) {
          return err({
            code: 'node.control.target_kind_required',
            message: 'target kind is required for role switch'
          })
        }
        if (node.kind === input.targetKind) {
          return err({
            code: 'node.control.role_unchanged',
            message: 'node already has requested role'
          })
        }
        const joinedStemCount = state.memberships.filter(
          membership => membership.networkId && membership.nodeKind === 'stem'
        ).length
        if (node.kind === 'stem' && input.targetKind === 'leaf' && joinedStemCount <= 1) {
          return err({
            code: 'node.control.last_stem_required',
            message: 'network requires at least one stem member'
          })
        }
        const nextKind: NodeKind = input.targetKind
        const updated: typeof node = { ...node, kind: nextKind }
        state.nodes = state.nodes.map(candidate =>
          candidate.id === input.nodeId ? updated : candidate
        )
        state.memberships = state.memberships.map(membership =>
          membership.nodeId === input.nodeId
            ? {
                ...membership,
                nodeKind: nextKind,
                membershipMode: nextKind === 'stem' ? 'full' : 'restricted'
              }
            : membership
        )
        return ok({
          node: updated,
          policyDecisionId: 'mnet-decision-test',
          correlationId: 'mnet-correlation-test'
        })
      }
      const nextStatus: NodeStatus =
        input.action === 'recover'
          ? 'recovering'
          : input.action === 'isolate'
            ? 'isolated'
            : 'disabled'
      const updated: typeof node = { ...node, status: nextStatus }
      state.nodes = state.nodes.map(candidate =>
        candidate.id === input.nodeId ? updated : candidate
      )
      return ok({
        node: updated,
        policyDecisionId: 'mnet-decision-test',
        correlationId: 'mnet-correlation-test'
      })
    }
  }
}

export function createAgentTaskPort(state: InMemoryCoreTestingState): AgentTaskPort {
  return {
    async executeNoop(
      input
    ): Promise<
      | ReturnType<typeof ok<NodeAgentTaskExecuteResponse>>
      | ReturnType<typeof err<{ code: string; message: string }>>
    > {
      const node = state.nodes.find(candidate => candidate.id === input.nodeId)
      if (!node) return err({ code: 'node.not_found', message: 'node not found' })
      if (node.status === 'offline') {
        return err({ code: 'node.unreachable', message: 'node is unreachable' })
      }

      const credential = state.nodeCredentials.get(input.nodeId)
      if (credential?.status !== 'active') {
        return err({
          code: 'node.credential_missing',
          message: 'node does not have an active credential'
        })
      }

      const completedAt =
        state.simulatedAgentExecutions.get(input.taskId)?.completedAt ?? new Date().toISOString()
      return ok({
        nodeId: input.nodeId,
        taskId: input.taskId,
        result: 'completed',
        completedAt
      })
    }
  }
}

/**
 * createServiceLifecyclePort 只暴露 Core 允许看到的运行态与 reload 行为。
 */
export function createServiceLifecyclePort(state: InMemoryCoreTestingState): ServiceLifecyclePort {
  return {
    async list() {
      const registered = state.services
        .map(asServiceSummary)
        .flatMap(service =>
          service && !state.builtinServices.some(builtin => builtin.id === service.id)
            ? [service]
            : []
        )
      return ok([...state.builtinServices, ...registered])
    },
    async reload(input) {
      const builtin = state.builtinServices.find(service => service.id === input.serviceId)
      if (!builtin) {
        const registered = state.services.find(
          service =>
            typeof service === 'object' &&
            service !== null &&
            Reflect.get(service, 'id') === input.serviceId
        )
        return registered
          ? err({ code: 'service.not_reloadable', message: 'service is not reloadable' })
          : err({ code: 'service.not_found', message: 'service not found' })
      }

      if (!builtin.lifecycle.reloadable) {
        return err({ code: 'service.not_reloadable', message: 'service is not reloadable' })
      }

      const reloadedAt = new Date().toISOString()
      builtin.runtime = {
        ...(builtin.runtime ?? { liveness: true, readiness: true, mode: 'normal' }),
        lastReloadedAt: reloadedAt
      }
      return ok({ serviceId: input.serviceId, reloadedAt })
    }
  }
}

export function createProjectionPort(): ProjectionPort {
  return {
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
  }
}

export function mergeServiceSummaries(
  builtinServices: ServiceSummary[],
  services: unknown[]
): ServiceSummary[] {
  return [
    ...builtinServices,
    ...services.map(asServiceSummary).flatMap(service => (service ? [service] : []))
  ]
}
