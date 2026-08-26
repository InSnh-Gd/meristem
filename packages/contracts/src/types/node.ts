// 节点运行态同时表达部署模式、可达性和生命周期状态。
export type NodeKind = 'stem' | 'leaf'
export type NodeMode = 'agent' | 'managed' | 'simulated'
export type NodeReachability = 'unknown' | 'public' | 'private' | 'reachable' | 'unreachable'
export type NodeStatus =
  | 'ready'
  | 'joining'
  | 'healthy'
  | 'degraded'
  | 'offline'
  | 'disabled'
  | 'isolated'
  | 'recovering'
  | 'revoked'
export type NodeJoinTicketStatus = 'active' | 'redeemed' | 'expired' | 'revoked'
export type NodeControlAction = 'disable' | 'isolate' | 'recover' | 'switch-role'

export type RegisterNodeRequest = {
  kind: NodeKind
  name: string
  mode?: Extract<NodeMode, 'simulated'>
  capabilities?: string[]
}

export type MNode = {
  id: string
  kind: NodeKind
  name: string
  mode: NodeMode
  status: NodeStatus
  reachability: NodeReachability
  lastSeenAt?: string
  agentVersion?: string
  capabilities: string[]
  createdAt: string
}

export type RegisterNodeResponse = {
  node: MNode
  policyDecisionId: string
  correlationId: string
}

export type NodeControlRequest = {
  action: NodeControlAction
  reason: string
  targetKind?: NodeKind
}

export type NodeControlResponse = {
  node: MNode
  policyDecisionId: string
  correlationId: string
}

export type CreateNodeTicketRequest = {
  kind: NodeKind
  name: string
  capabilities?: string[]
  expiresInSeconds?: number
}

export type CreateNodeTicketResponse = {
  ticketId: string
  ticket: string
  expiresAt: string
  joinUrl: string
  policyDecisionId: string
  correlationId: string
}
