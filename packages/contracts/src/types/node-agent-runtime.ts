import type {
  RedactedSecretRefFromSchema,
  SecretRefFromSchema
} from '../schemas/secret-provider.ts'

export type DependencyState = 'ready' | 'unavailable'

export type NodeAgentRuntimeStatusKind = 'starting' | 'healthy' | 'degraded' | 'stopped' | 'failed'

export type NodeAgentDegradedReasonCode =
  | 'expired_credentials'
  | 'missing_signal'
  | 'missing_relay'
  | 'missing_stun'
  | 'secret.missing'
  | 'secret.denied'
  | 'secret.provider_unavailable'
  | 'secret.unsupported_backend'
  | 'secret.stale'
  | 'sidecar_crash'
  | 'config_drift'
  | 'secret_resolution_failed'
  | 'break_glass_stop'
  | 'profile_disabled'
  | 'netbird.binary.invalid'
  | 'netbird.setup_key.missing'
  | 'netbird.start_failed'
  | 'netbird.process.not_running'
  | 'netbird.config_drift_repaired'
  | 'netbird.process_restarted'
  | 'netbird.probe.timeout'
  | 'netbird.probe.failed'
  | 'netbird.endpoint.unreachable'

export type NodeAgentRedactedSecretRef = RedactedSecretRefFromSchema

export type NodeAgentRuntimeDesiredSidecar = {
  signalConfigRef: { configRef: string }
  relayConfigRef: { configRef: string }
  stunConfigRef: { configRef: string }
  sidecarCredentialRef: SecretRefFromSchema
  desiredState: 'install' | 'configure' | 'start' | 'drain' | 'stop'
  credentialStatus: 'missing' | 'pending' | 'ready' | 'expired' | 'rotation_required'
  healthStatus: 'unknown' | 'healthy' | 'degraded' | 'unhealthy'
  managementUrl?: string
  setupKey?: string
  configHash?: string
}

export type NodeAgentRuntimeDependencyStatus = {
  signal: DependencyState
  relay: DependencyState
  stun: DependencyState
}

export type NodeAgentRuntimeDegradedReason = {
  code: NodeAgentDegradedReasonCode
  message: string
  detail?: string
}

export type NodeAgentRuntimeStatus = {
  kind: NodeAgentRuntimeStatusKind
  desiredState: 'install' | 'configure' | 'start' | 'drain' | 'stop'
  credentialStatus: 'missing' | 'pending' | 'ready' | 'expired' | 'rotation_required'
  healthStatus: 'unknown' | 'healthy' | 'degraded' | 'unhealthy'
  configHash?: string
  sidecarConfigPath?: string
  processRef?: string
  processPid?: number
  processStartedAt?: string
  lastProbeAt?: string
  observedHealth?: 'healthy' | 'degraded' | 'unknown'
  degradedReason?: NodeAgentRuntimeDegradedReason
  correlationId: string
  observedAt: string
  dependencies: NodeAgentRuntimeDependencyStatus
  degradedReasons: NodeAgentRuntimeDegradedReason[]
  credentialRef?: NodeAgentRedactedSecretRef
}
