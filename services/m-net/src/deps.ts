import type {
  ActorId,
  CreateNetworkRequest,
  MNetOperationalEventIngestRequestFromSchema,
  MNetOperationalEventIngestResponseFromSchema,
  MNetOperationalSnapshotFromSchema,
  MNetwork,
  MNetworkMember,
  NetworkSummary,
  NetworkSuspendedOperation,
  NodeAgentRuntimeDesiredSidecar,
  NodeAgentRuntimeStatus,
  NodeAgentTaskExecuteResponse,
  NodeControlAction,
  NodeControlResponse
} from '../../../packages/contracts/src/index.ts'
import type { NetworkMapFromSchema } from '../../../packages/contracts/src/schemas/mnet-profile.ts'
import type { DataPlaneStores } from './data-plane-store-types.ts'
import type { GlobalDefaultsStore } from './global-defaults-store.ts'
import type { MigrationEngine } from './migration-engine-contract.ts'
import type { NetBirdResolvedControlPlaneConfig } from './netbird-adapter.ts'
import type { ProfileDisablePolicyStore } from './profile-disable-policy.ts'
import type { ProfileStore } from './profile-store.ts'
import type {
  ForcedRelayNodeContext,
  MNetDb,
  MNetServiceResult,
  NodeKeyRegistrationSuccess
} from './types.ts'
import type { MNetClosedLoopService } from './closed-loop-workflow.ts'

export type MNetAppDeps = {
  auth: {
    verify(
      token: string
    ): Promise<{ ok: true; actor: ActorId } | { ok: false; code: string; message: string }>
  }
  db?: MNetDb
  readiness(): Promise<{ ready: boolean }>
  createNetwork(input: CreateNetworkRequest): Promise<MNetServiceResult<MNetwork>>
  listNetworks(): Promise<MNetServiceResult<NetworkSummary[]>>
  joinNetwork(input: {
    networkId: string
    nodeId: string
  }): Promise<MNetServiceResult<MNetworkMember>>
  listMembers(input: { networkId: string }): Promise<MNetServiceResult<MNetworkMember[]>>
  deleteNetwork?: (input: {
    networkId: string
  }) => Promise<MNetServiceResult<{ networkId: string }>>
  removeMember?: (input: {
    networkId: string
    nodeId: string
  }) => Promise<MNetServiceResult<{ networkId: string; nodeId: string }>>
  updateNetworkMetadata?: (input: {
    networkId: string
    displayName?: string
  }) => Promise<MNetServiceResult<MNetwork>>
  executeNoop(input: {
    nodeId: string
    taskId: string
    correlationId: string
  }): Promise<MNetServiceResult<NodeAgentTaskExecuteResponse>>
  getOperationalState?: (networkId: string) => Promise<
    | MNetOperationalSnapshotFromSchema
    | {
        kind: 'failure'
        status: 400 | 401 | 403 | 404 | 409 | 503
        error: { code: string; message: string }
      }
  >
  ingestOperationalEvent?: (input: MNetOperationalEventIngestRequestFromSchema) => Promise<
    | MNetOperationalEventIngestResponseFromSchema
    | {
        kind: 'failure'
        status: 400 | 401 | 403 | 404 | 409 | 503
        error: { code: string; message: string }
      }
  >
  controlNode?: (input: {
    actor: ActorId
    nodeId: string
    action: NodeControlAction
    reason: string
    targetKind?: 'stem' | 'leaf'
  }) => Promise<
    | NodeControlResponse
    | {
        kind: 'failure'
        status: 403 | 404 | 409 | 503
        error: { code: string; message: string }
      }
  >
  // 复用 profile-store.ts 的权威 ProfileStore 定义，避免此处再声明一份 inline 结构
  // 造成类型重复（DFW-041 清理项）。
  profileStore?: ProfileStore
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
  describeForcedRelayNode?: (nodeId: string) => Promise<ForcedRelayNodeContext | null>
  profileDisablePolicy?: ProfileDisablePolicyStore
  policyHealthCheck?: {
    checkHealth(): Promise<{ healthy: boolean }>
  }
  /** 数据面存储（NATS KV/PostgreSQL 分区状态、操作锁、迁移记录） */
  dataPlane?: DataPlaneStores
  /** 全局默认 Profile 与批量 switch 状态存储 */
  globalDefaultsStore?: GlobalDefaultsStore
  /** 批量 Profile 迁移引擎 */
  migrationEngine?: MigrationEngine
  /** SecretProvider-resolved NetBird control-plane material for data-plane adapter activation. */
  resolveNetBirdControlPlane?: (input: {
    networkId: string
    profileVersion: 'm-net@0.3.0' | 'm-net-cn@0.3.0'
  }) => Promise<NetBirdResolvedControlPlaneConfig | null>
  /** node-agent runtime-token authenticated boundary for map reads and key registration */
  nodeRuntime?: {
    authorize(nodeId: string, token: string): Promise<boolean>
    fetchLatestNetworkMap(nodeId: string): Promise<
      | {
          map: NetworkMapFromSchema
          sidecar: NodeAgentRuntimeDesiredSidecar
        }
      | {
          kind: 'failure'
          status: 400 | 401 | 403 | 404 | 409 | 503
          error: { code: string; message: string }
        }
    >
    registerNodePublicKey(input: {
      nodeId: string
      keyId: string
      publicKey: string
      createdAt: string
      endpoint?: string
    }): Promise<
      | NodeKeyRegistrationSuccess
      | {
          kind: 'failure'
          status: 400 | 401 | 403 | 404 | 409 | 503
          error: { code: string; message: string }
        }
    >
    reportStatus?(input: { nodeId: string; runtimeStatus: NodeAgentRuntimeStatus }): Promise<void>
    reportTunnelHealth?(input: {
      nodeId: string
      health: Omit<
        import('../../../packages/contracts/src/index.ts').MNetTunnelHealthFromSchema,
        'nodeId' | 'stateSource'
      >
    }): Promise<
      | Awaited<ReturnType<MNetClosedLoopService['recordTunnelHealth']>>
      | {
          kind: 'failure'
          status: 400 | 401 | 403 | 404 | 409 | 503
          error: { code: string; message: string }
        }
    >
  }
  /** Closed-loop service facade; omitted only in narrow route tests that do not exercise it. */
  closedLoop?: MNetClosedLoopService
}
