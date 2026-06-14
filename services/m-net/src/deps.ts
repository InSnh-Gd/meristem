import type {
  CreateNetworkRequest,
  MNetwork,
  MNetworkMember,
  NetworkSummary,
  NodeAgentTaskExecuteResponse
} from '../../../packages/contracts/src/index.ts'
import type {
  MNetRegionalProfile,
  NetworkSuspendedOperation
} from '../../../packages/contracts/src/types/mnet-profile.ts'
import type { MNetServiceResult } from './types.ts'

export type MNetAppDeps = {
  readiness(): Promise<{ ready: boolean }>
  createNetwork(input: CreateNetworkRequest): Promise<MNetServiceResult<MNetwork>>
  listNetworks(): Promise<MNetServiceResult<NetworkSummary[]>>
  joinNetwork(input: {
    networkId: string
    nodeId: string
  }): Promise<MNetServiceResult<MNetworkMember>>
  listMembers(input: { networkId: string }): Promise<MNetServiceResult<MNetworkMember[]>>
  executeNoop(input: {
    nodeId: string
    taskId: string
    correlationId: string
  }): Promise<MNetServiceResult<NodeAgentTaskExecuteResponse>>
  profileStore?: {
    getDefinitions(): Promise<MNetRegionalProfile[]>
    getDefinition(profileVersion: string): Promise<MNetRegionalProfile | null>
    getNetworkState(networkId: string): Promise<{
      networkId: string
      profileVersion: string
      status: string
      updatedAt: string
    } | null>
    setNetworkState(
      networkId: string,
      state: { profileVersion: string; status: string }
    ): Promise<void>
    recordTransition(record: {
      networkId: string
      fromVersion: string
      toVersion: string
      fromStatus: string
      toStatus: string
      actor: string
      reason?: string
      policyDecisionId?: string
      correlationId?: string
    }): Promise<void>
  }
  networkUpdater?: {
    setProfileVersion(networkId: string, profileVersion: string): Promise<void>
  }
  policyAuthorize?: {
    authorize(
      actor: string,
      action: string,
      resource: string
    ): Promise<{
      result: 'allow' | 'deny' | 'require_manual_review' | 'require_multi_approval'
      id: string
      reasons: string[]
    }>
  }
  suspendedOps?: {
    create(input: {
      policyDecisionId: string
      action: string
      networkId: string
      fromProfileVersion: string
      toProfileVersion: string
      requestedBy: string
      reason?: string
      correlationId: string
      idempotencyKey: string
      expiresAt: string
    }): Promise<NetworkSuspendedOperation>
    get(id: string): Promise<NetworkSuspendedOperation | null>
    transition(
      id: string,
      status: string,
      terminalReason?: string
    ): Promise<NetworkSuspendedOperation | null>
  }
  approvals?: {
    create(input: {
      policyDecisionId: string
      originService: string
      operationId: string
      requestedBy: string
      requiredAction: string
      quorumRequired: number
      expiresAt: string
    }): Promise<
      | { ok: true; value: { approvalId: string } }
      | { ok: false; error: { code: string; message: string } }
    >
  }
  events?: {
    publish(subject: string, type: string, payload: unknown, correlationId?: string): Promise<void>
  }
  log?: {
    writeTimeline(summary: string, subject?: string, correlationId?: string): Promise<void>
    writeFull(
      level: string,
      message: string,
      correlationId?: string,
      payload?: unknown
    ): Promise<void>
    writeAudit(
      actor: string,
      action: string,
      resource: string,
      result: string,
      correlationId?: string,
      payload?: unknown
    ): Promise<void>
  }
}
