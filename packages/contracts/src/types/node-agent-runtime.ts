/**
 * Node agent runtime types — sidecar lifecycle status tracking for internal node-agent
 * consumption. These are NOT deserialized from any external boundary; they are defined
 * as plain type aliases rather than Effect Schema types.
 */
import type { RedactedSecretRefFromSchema } from '../schemas/secret-provider.ts'

/** Sidecar desired state literal. */
export type NodeAgentRuntimeDesiredSidecar = {
  desiredState: string
  credentialStatus: string
  healthStatus: string
  signalConfigRef: { configRef: string }
  relayConfigRef: { configRef: string }
  stunConfigRef: { configRef: string }
  sidecarCredentialRef: { provider: string; keyPath: string; version?: number }
  configHash?: string
}

/** Runtime status kind discriminated by health and workflow phase. */
export type NodeAgentRuntimeStatusKind =
  | 'healthy'
  | 'degraded'
  | 'starting'
  | 'stopped'

/** Agent runtime status — emitted as node-agent lifecycle state, not persisted. */
export type NodeAgentRuntimeStatus = {
  kind: NodeAgentRuntimeStatusKind
  desiredState: string
  credentialStatus: string
  healthStatus: string
  configHash?: string
  sidecarConfigPath?: string
  processRef?: string
  correlationId: string
  observedAt: string
  dependencies: {
    signal: 'ready' | 'unavailable'
    relay: 'ready' | 'unavailable'
    stun: 'ready' | 'unavailable'
  }
  degradedReasons: Array<{ code: string; message: string; detail?: string }>
  credentialRef?: RedactedSecretRefFromSchema
}
