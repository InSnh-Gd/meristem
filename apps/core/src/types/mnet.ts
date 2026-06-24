import type { Result } from '../../../../packages/common/src/result.ts'
import type {
  CreateNetworkRequest,
  MNetwork,
  MNetworkMember,
  NodeControlAction,
  NodeControlResponse,
  NetworkSummary
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
  controlNode(input: {
    nodeId: string
    action: NodeControlAction
    reason: string
    targetKind?: 'stem' | 'leaf'
    bearerToken: string
  }): Promise<Result<NodeControlResponse, ServiceError>>
}
