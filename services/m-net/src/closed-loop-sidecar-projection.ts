import type {
  MNetSidecarDegradedReasonFromSchema,
  MNetSidecarStatusFromSchema,
  NodeAgentRuntimeStatus
} from '../../../packages/contracts/src/index.ts'

function normalizeSidecarReason(
  reason: NodeAgentRuntimeStatus['degradedReasons'][number]['code'] | undefined,
  fallback: MNetSidecarDegradedReasonFromSchema
): MNetSidecarDegradedReasonFromSchema {
  switch (reason) {
    case 'expired_credentials':
    case 'missing_signal':
    case 'missing_relay':
    case 'missing_stun':
    case 'secret.missing':
    case 'secret.denied':
    case 'secret.provider_unavailable':
    case 'secret.unsupported_backend':
    case 'secret.stale':
    case 'sidecar_crash':
    case 'config_drift':
    case 'break_glass_stop':
    case 'profile_disabled':
    case 'netbird.binary.invalid':
    case 'netbird.setup_key.missing':
    case 'netbird.start_failed':
    case 'netbird.process.not_running':
    case 'netbird.config_drift_repaired':
    case 'netbird.process_restarted':
    case 'netbird.probe.timeout':
    case 'netbird.probe.failed':
    case 'netbird.endpoint.unreachable':
      return reason
    case 'secret_resolution_failed':
      return 'secret.provider_unavailable'
    default:
      return fallback
  }
}

/** 将 node-agent 的真实运行态投影为 UI-facing sidecar fact。 */
export function projectNodeAgentSidecarStatus(
  nodeId: string,
  runtime: NodeAgentRuntimeStatus,
  input: {
    proofPath: MNetSidecarStatusFromSchema['proofPath']
    fallbackTransport?: MNetSidecarStatusFromSchema['fallbackTransport']
  }
): MNetSidecarStatusFromSchema {
  const fallback = input.fallbackTransport === 'wireguard-rendered'
  const nonHealthy =
    fallback ||
    runtime.kind === 'degraded' ||
    runtime.kind === 'stopped' ||
    runtime.healthStatus !== 'healthy'
  const healthStatus: MNetSidecarStatusFromSchema['healthStatus'] = nonHealthy
    ? runtime.healthStatus === 'unhealthy'
      ? 'unhealthy'
      : 'degraded'
    : 'healthy'
  const firstReason = runtime.degradedReasons[0]?.code ?? runtime.degradedReason?.code
  const degradedReason = fallback
    ? 'wireguard_rendered_fallback'
    : normalizeSidecarReason(firstReason, 'missing_signal')

  return {
    nodeId,
    desiredState: runtime.desiredState,
    healthStatus,
    ...(nonHealthy ? { degradedReason } : {}),
    proofPath: input.proofPath,
    ...(input.fallbackTransport ? { fallbackTransport: input.fallbackTransport } : {}),
    uiFacingFact: true,
    healthy: !nonHealthy,
    checkedAt: runtime.observedAt
  }
}
