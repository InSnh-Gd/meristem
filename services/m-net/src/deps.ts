import type {
  ActorId,
  CreateNetworkRequest,
  MNetOperationalEventIngestRequestFromSchema,
  MNetOperationalEventIngestResponseFromSchema,
  MNetOperationalSnapshotFromSchema,
  MNetwork,
  MNetworkMember,
  NodeAgentRuntimeDesiredSidecar,
  NodeAgentRuntimeStatus,
  NetworkSummary,
  NodeAgentTaskExecuteResponse,
  NodeControlAction,
  NodeControlResponse
} from '../../../packages/contracts/src/index.ts'
import type { NetworkMapFromSchema } from '../../../packages/contracts/src/schemas/mnet-profile.ts'
import type {
  MNetRegionalProfile,
  NetworkSuspendedOperation
} from '../../../packages/contracts/src/index.ts'
import type { DataPlaneStores } from './data-plane-store-types.ts'
import type { ForcedRelayNodeContext } from './forced-relay-node-context.ts'
import type { GlobalDefaultsStore } from './global-defaults-store.ts'
import type { MigrationEngine } from './migration-engine.ts'
import type { MNetDb } from './clients.ts'
import type { NodeKeyRegistrationSuccess } from './mnet-dataplane-support.ts'
import type { ProfileDisablePolicyStore } from './profile-disable-policy.ts'
import type { MNetServiceResult } from './types.ts'

export type MNetAppDeps = {
  db?: MNetDb
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
    /** 列出所有网络 Profile 状态（用于批量迁移扫描） */
    listNetworkStates(): Promise<
      Array<{ networkId: string; profileVersion: string; status: string; updatedAt: string }>
    >
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
  }
}
