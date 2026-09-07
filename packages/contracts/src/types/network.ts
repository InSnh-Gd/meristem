import type { NodeKind } from './node.ts'

// 逻辑网络阶段只表达成员关系，不宣称真实传输路径或 P2P 能力。
export type NetworkStatus = 'active'
export type NetworkMembershipMode = 'full' | 'restricted'
export type NetworkMembershipStatus = 'joined'

export type CreateNetworkRequest = {
  name: string
  profileVersion?: string
}

export type MNetwork = {
  id: string
  name: string
  /** 展示名；可选元数据，identity 仍是 name。 */
  displayName?: string
  profileVersion: string
  status: NetworkStatus
  createdAt: string
}

export type NetworkSummary = MNetwork & {
  memberCount: number
}

export type CreateNetworkResponse = {
  network: MNetwork
  policyDecisionId: string
  correlationId: string
}

export type JoinNetworkRequest = {
  nodeId: string
}

export type MNetworkMember = {
  networkId: string
  nodeId: string
  nodeKind: NodeKind
  membershipMode: NetworkMembershipMode
  status: NetworkMembershipStatus
  joinedAt: string
}

export type JoinNetworkResponse = {
  member: MNetworkMember
  policyDecisionId: string
  correlationId: string
}
