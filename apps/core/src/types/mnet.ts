import type { Result } from '../../../../packages/common/src/result.ts'
import type {
  CreateNetworkRequest,
  MNetwork,
  MNetworkMember,
  NetworkSummary,
  NodeControlAction,
  NodeControlResponse
} from '../../../../packages/contracts/src/index.ts'
import type { ServiceError } from './common.ts'

/**
 * MNetPort 暴露逻辑组网的最小能力，真实传输能力仍由后续阶段单独扩展。
 */
export type MNetPort = {
  createNetwork(input: CreateNetworkRequest): Promise<Result<MNetwork, ServiceError>>
  listNetworks(): Promise<Result<NetworkSummary[], ServiceError>>
  joinNetwork(input: {
    networkId: string
    nodeId: string
  }): Promise<Result<MNetworkMember, ServiceError>>
  listNetworkMembers(networkId: string): Promise<Result<MNetworkMember[], ServiceError>>
  deleteNetwork(input: { networkId: string }): Promise<Result<{ networkId: string }, ServiceError>>
  removeMember(input: {
    networkId: string
    nodeId: string
    correlationId: string
  }): Promise<Result<{ networkId: string; nodeId: string }, ServiceError>>
  updateNetworkMetadata(input: {
    networkId: string
    displayName?: string
  }): Promise<Result<MNetwork, ServiceError>>
  controlNode(input: {
    nodeId: string
    action: NodeControlAction
    reason: string
    targetKind?: 'stem' | 'leaf'
    bearerToken: string
  }): Promise<Result<NodeControlResponse, ServiceError>>
}
