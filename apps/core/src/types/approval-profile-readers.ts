import type { Result } from '../../../../packages/common/src/result.ts'
import type {
  ActorId,
  ApprovalDetailResponse,
  ApprovalListResponse,
  Permission
} from '../../../../packages/contracts/src/index.ts'
import type { ServiceError } from './common.ts'

export type NetworkProfileDto = {
  profileVersion: 'm-net@0.3.0' | 'm-net-cn@0.3.0'
  region: 'default' | 'cn'
  displayName: string
  schemaVersion: 'mnet-profile@0.3.0'
  status: 'available' | 'deprecated'
  rules: Record<string, unknown>
  capabilities: {
    controlPlaneOnly: false
    managementPlaneExcluded: true
    realNetBirdSidecar: true
    signalConfigRef: { configRef: string }
    relayConfigRef: { configRef: string }
    stunConfigRef: { configRef: string }
    sidecarDesiredState: 'install' | 'configure' | 'start' | 'drain' | 'stop'
    sidecarCredentialRef: { provider: string; keyPath: string; version: number }
    sidecarCredentialStatus: 'missing' | 'pending' | 'ready' | 'expired' | 'rotation_required'
    sidecarHealthStatus: 'unknown' | 'healthy' | 'degraded' | 'unhealthy'
  }
  forcedTcpRelaySelector?: {
    enabled: true
    selectorOwnership: 'operator' | 'policy'
    selector:
      | { selectorType: 'all-leaf-nodes'; includeAllLeafNodes: true }
      | { selectorType: 'node-ids'; nodeIds: string[] }
      | { selectorType: 'label-selector'; matchLabels: Record<string, string> }
    routeClass: 'standard' | 'cn-resident' | 'forced-tcp-relay'
    operatorOverrideAllowed: boolean
    operatorOverrideActive: boolean
    operatorOverrideActor?: ActorId
    operatorOverrideReason?: string
    policyDecision: {
      decisionId: string
      source: 'm-policy'
      outcome: 'allow' | 'deny' | 'conditional'
      reason: string
    }
    auditEvidence: {
      auditId: string
      eventId: string
      eventSubject: 'mnet.forced_relay.change.v0'
    }
  }
}

export type ReaderContext = {
  actor: ActorId
  bearerToken: string
  correlationId: string
}

/**
 * ApprovalReaderPort 只读 M-Policy 的公开审批 API，Core 不持有审批状态。
 */
export type ApprovalReaderPort = {
  requiredPermission: Permission
  list(context: ReaderContext): Promise<Result<ApprovalListResponse, ServiceError>>
  get(
    id: string,
    context: ReaderContext
  ): Promise<Result<ApprovalDetailResponse | null, ServiceError>>
}

/**
 * NetworkProfileReaderPort 只读 M-Net 的公开 profile API，Core 不读取 M-Net 私有 store。
 */
export type NetworkProfileReaderPort = {
  requiredPermission: Permission
  list(context: ReaderContext): Promise<Result<{ profiles: NetworkProfileDto[] }, ServiceError>>
  get(
    profileVersion: string,
    context: ReaderContext
  ): Promise<Result<NetworkProfileDto | null, ServiceError>>
}
