import type {
  MNetProfileVersionFromSchema,
  MNetRelayTypeFromSchema,
  NetworkMapEnforcementDecisionFromSchema as NetworkMapEnforcementDecision,
  NetworkMapFromSchema as NetworkMap
} from '../../../packages/contracts/src/schemas/mnet-profile.ts'
import type { NodeKind } from '../../../packages/contracts/src/types.ts'

// 签名地图输入只携带已完成授权后的网络元数据，不在 agent 侧重新计算 M-Policy。
export type NetworkMapMemberInput = {
  readonly nodeId: string
  readonly nodeKind: NodeKind
  readonly tunnelIp: string
  readonly publicKey: string
}

export type RequestedAclRule = {
  readonly action: 'allow' | 'deny'
  readonly sourceNodeId: string
  readonly targetNodeId: string
  readonly protocol: 'any' | 'tcp' | 'udp' | 'icmp'
}

export type NetworkMapRelayAssignmentInput = {
  readonly relayType: MNetRelayTypeFromSchema
  readonly relayEndpoint: string
  readonly nodeIds: readonly string[]
}

export type NetworkMapRenderInput = {
  readonly profileVersion: MNetProfileVersionFromSchema
  readonly networkId: string
  readonly members: readonly NetworkMapMemberInput[]
  readonly requestedAclRules: readonly RequestedAclRule[]
  readonly relayAssignment?: NetworkMapRelayAssignmentInput
  readonly issuedAt: number
  readonly previousMapVersion: number
  readonly signingKeyId: string
  readonly signingPrivateKeyPem: string
  readonly staleTtlMs?: number
}

export type RenderedNetworkMap = {
  readonly nodeId: string
  readonly map: NetworkMap
}

export type NetworkMapEnforcementInput = {
  readonly map: NetworkMap
  readonly nowMs: number
  readonly previousMapVersion?: number
}

export type EnforcementDecision = NetworkMapEnforcementDecision
