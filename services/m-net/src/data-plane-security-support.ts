import { type ProfileWorkflowFailure, profileWorkflowFailure } from './profile-workflow-types.ts'

export type AcmeDirectoryInput = {
  readonly mode: 'acme' | 'local-dev'
  readonly directoryUrl: string
  readonly directoryReachable: boolean
  readonly localDevFallbackAllowed: boolean
}

export type AcmeDirectoryError = {
  readonly code: 'acme.directory_unavailable'
  readonly message: 'ACME directory is unreachable'
  readonly directoryUrl: string
}

export type AcmeDirectoryResult =
  | {
      readonly kind: 'ready'
      readonly mode: 'acme' | 'local-dev'
    }
  | {
      readonly kind: 'fallback'
      readonly mode: 'local-dev'
      readonly error: AcmeDirectoryError
    }
  | {
      readonly kind: 'fail_closed'
      readonly error: AcmeDirectoryError
    }

export type RelayAvailabilityInput = {
  readonly relayReachable: boolean
  readonly directPathAvailable: boolean
}

export type RelayAvailabilityResult =
  | {
      readonly kind: 'relay_active'
      readonly relayType: 'wstunnel'
    }
  | {
      readonly kind: 'direct_fallback'
      readonly relayType: 'direct'
      readonly reason: {
        readonly code: 'relay.unavailable'
        readonly message: 'wstunnel relay is unavailable'
      }
    }
  | {
      readonly kind: 'fail_closed'
      readonly error: {
        readonly code: 'relay.unavailable'
        readonly message: 'wstunnel relay is unavailable'
      }
    }

export type MigrationSafetyMember = {
  readonly nodeId: string
  readonly nodeKind: 'stem' | 'leaf'
  readonly status: 'joined' | 'offline' | 'degraded' | 'pending'
}

export type OfflineLeafMigrationResult =
  | {
      readonly kind: 'ready'
      readonly pendingNodeIds: readonly []
    }
  | {
      readonly kind: 'pending'
      readonly pendingNodeIds: readonly string[]
      readonly status: 'pending'
      readonly message: 'offline leaf members require follow-up before migration can complete'
    }

export type FailClosedTunnelPlan = {
  readonly nodeId: string
  readonly configHash: string
}

function acmeDirectoryError(directoryUrl: string): AcmeDirectoryError {
  return {
    code: 'acme.directory_unavailable',
    message: 'ACME directory is unreachable',
    directoryUrl
  }
}

/**
 * ACME 目录不可达时，只允许在显式声明下回退到 local-dev；否则必须 fail-closed。
 */
export function evaluateAcmeDirectoryHealth(input: AcmeDirectoryInput): AcmeDirectoryResult {
  if (input.mode === 'local-dev') {
    return { kind: 'ready', mode: 'local-dev' }
  }

  if (input.directoryReachable) {
    return { kind: 'ready', mode: 'acme' }
  }

  if (input.localDevFallbackAllowed) {
    return {
      kind: 'fallback',
      mode: 'local-dev',
      error: acmeDirectoryError(input.directoryUrl)
    }
  }

  return {
    kind: 'fail_closed',
    error: acmeDirectoryError(input.directoryUrl)
  }
}

/**
 * relay 不可达时优先切直连；直连也不可用则必须 fail-closed，避免继续宣称数据面可用。
 */
export function resolveRelayAvailability(input: RelayAvailabilityInput): RelayAvailabilityResult {
  if (input.relayReachable) {
    return { kind: 'relay_active', relayType: 'wstunnel' }
  }

  if (input.directPathAvailable) {
    return {
      kind: 'direct_fallback',
      relayType: 'direct',
      reason: {
        code: 'relay.unavailable',
        message: 'wstunnel relay is unavailable'
      }
    }
  }

  return {
    kind: 'fail_closed',
    error: {
      code: 'relay.unavailable',
      message: 'wstunnel relay is unavailable'
    }
  }
}

/**
 * 迁移期间如果存在离线 leaf，结果必须保持 pending，禁止把部分完成写成成功。
 */
export function assessOfflineLeafMigration(
  members: readonly MigrationSafetyMember[]
): OfflineLeafMigrationResult {
  const pendingNodeIds = members
    .filter(member => member.nodeKind === 'leaf' && member.status !== 'joined')
    .map(member => member.nodeId)

  if (pendingNodeIds.length === 0) {
    return { kind: 'ready', pendingNodeIds: [] }
  }

  return {
    kind: 'pending',
    pendingNodeIds,
    status: 'pending',
    message: 'offline leaf members require follow-up before migration can complete'
  }
}

/**
 * fail-closed 时为每个节点生成确定性的 sidecar 目标态，供运行时执行隧道拆除或阻断。
 */
export function planFailClosedTunnelTeardown(
  networkId: string,
  nodeIds: readonly string[]
): readonly FailClosedTunnelPlan[] {
  return [...nodeIds].sort().map(nodeId => ({
    nodeId,
    configHash: `fail-closed:${networkId}`
  }))
}

/**
 * 统一把事件总线不可用映射成 typed failure，避免上层把 NATS 故障写成模糊错误。
 */
export function eventBusUnavailable(error: unknown): ProfileWorkflowFailure {
  const message = error instanceof Error ? error.message : String(error)
  return profileWorkflowFailure(503, 'event_bus.unavailable', message)
}
