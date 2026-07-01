import { createHash } from 'node:crypto'
import type { Result } from '../../../packages/common/src/result.ts'
import { err, ok } from '../../../packages/common/src/result.ts'
import type { NodeAgentRuntimeDesiredSidecar } from '../../../packages/contracts/src/index.ts'
import type { MNetProfileV03VersionFromSchema } from '../../../packages/contracts/src/schemas/mnet-profile-v03.ts'

export type NetBirdResolvedControlPlaneConfig = {
  readonly managementUrl: string
  readonly setupKey: string
  readonly signalConfigRef: { readonly configRef: string }
  readonly relayConfigRef: { readonly configRef: string }
  readonly stunConfigRef: { readonly configRef: string }
  readonly sidecarCredentialRef: NodeAgentRuntimeDesiredSidecar['sidecarCredentialRef']
  readonly sidecarCredentialStatus?: NodeAgentRuntimeDesiredSidecar['credentialStatus']
  readonly sidecarHealthStatus?: NodeAgentRuntimeDesiredSidecar['healthStatus']
  readonly prerequisites?: {
    readonly signalReady: boolean
    readonly relayReady: boolean
    readonly stunReady: boolean
  }
  readonly management?: unknown
  readonly dashboard?: unknown
  readonly acl?: unknown
  readonly acls?: unknown
}

export type NetBirdDesiredClientConfig = {
  readonly managementUrl: string
  readonly setupKey: string
  readonly profileVersion: MNetProfileV03VersionFromSchema
  readonly configHash: string
}

export type NetBirdAdapterEnabledResult = {
  readonly enabled: true
  readonly status: 'enabled'
  readonly transport: 'netbird-sidecar'
  readonly profileVersion: MNetProfileV03VersionFromSchema
  readonly desiredState: NodeAgentRuntimeDesiredSidecar
  readonly clientConfig: NetBirdDesiredClientConfig
}

export type NetBirdAdapterRejectedResult = {
  readonly enabled: false
  readonly status: 'rejected'
  readonly error: NetBirdAdapterRejection
}

export type NetBirdAdapterResult = NetBirdAdapterEnabledResult | NetBirdAdapterRejectedResult

export type NetBirdAdapterRejectionCode =
  | 'netbird.config.forbidden_management_plane'
  | 'netbird.config.missing_control_plane'
  | 'netbird.config.invalid_control_plane'

export type NetBirdAdapterRejection = {
  readonly code: NetBirdAdapterRejectionCode
  readonly message: string
  readonly fields: readonly string[]
}

type ValidatedNetBirdConfig = Omit<
  NetBirdResolvedControlPlaneConfig,
  'management' | 'dashboard' | 'acl' | 'acls'
> & {
  readonly managementUrl: string
  readonly setupKey: string
}

const forbiddenControlPlaneFields = ['management', 'dashboard', 'acl', 'acls'] as const

function hasForbiddenField(
  config: NetBirdResolvedControlPlaneConfig,
  field: (typeof forbiddenControlPlaneFields)[number]
): boolean {
  return Object.hasOwn(config, field) && config[field] !== undefined
}

function rejectConfig(
  code: NetBirdAdapterRejectionCode,
  message: string,
  fields: readonly string[]
): NetBirdAdapterRejectedResult {
  return { enabled: false, status: 'rejected', error: { code, message, fields } }
}

function validateResolvedConfig(
  config: NetBirdResolvedControlPlaneConfig
): Result<ValidatedNetBirdConfig, NetBirdAdapterRejection> {
  const forbiddenFields = forbiddenControlPlaneFields.filter(field => hasForbiddenField(config, field))
  if (forbiddenFields.length > 0) {
    return err({
      code: 'netbird.config.forbidden_management_plane',
      message: 'NetBird Management, Dashboard, and ACL configuration is externally provisioned',
      fields: forbiddenFields
    })
  }

  const requiredFields: ReadonlyArray<readonly [string, string]> = [
    ['managementUrl', config.managementUrl],
    ['setupKey', config.setupKey],
    ['signalConfigRef.configRef', config.signalConfigRef.configRef],
    ['relayConfigRef.configRef', config.relayConfigRef.configRef],
    ['stunConfigRef.configRef', config.stunConfigRef.configRef],
    ['sidecarCredentialRef.provider', config.sidecarCredentialRef.provider],
    ['sidecarCredentialRef.keyPath', config.sidecarCredentialRef.keyPath]
  ]
  const missingFields = requiredFields.flatMap(([field, value]) =>
    value.trim().length > 0 ? [] : [field]
  )

  if (missingFields.length > 0) {
    return err({
      code: 'netbird.config.missing_control_plane',
      message: 'NetBird adapter requires SecretProvider-resolved control-plane inputs',
      fields: missingFields
    })
  }

  try {
    const parsed = new URL(config.managementUrl)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return err({
        code: 'netbird.config.invalid_control_plane',
        message: 'NetBird management URL must be an HTTP(S) URL',
        fields: ['managementUrl']
      })
    }
  } catch {
    return err({
      code: 'netbird.config.invalid_control_plane',
      message: 'NetBird management URL must be an HTTP(S) URL',
      fields: ['managementUrl']
    })
  }

  return ok(config)
}

function deriveConfigHash(input: {
  readonly profileVersion: MNetProfileV03VersionFromSchema
  readonly managementUrl: string
  readonly setupKey: string
  readonly signalConfigRef: { readonly configRef: string }
  readonly relayConfigRef: { readonly configRef: string }
  readonly stunConfigRef: { readonly configRef: string }
  readonly sidecarCredentialRef: NodeAgentRuntimeDesiredSidecar['sidecarCredentialRef']
}): string {
  const payload = JSON.stringify({
    profileVersion: input.profileVersion,
    managementUrl: input.managementUrl,
    setupKey: input.setupKey,
    signalConfigRef: input.signalConfigRef,
    relayConfigRef: input.relayConfigRef,
    stunConfigRef: input.stunConfigRef,
    sidecarCredentialRef: input.sidecarCredentialRef
  })
  return createHash('sha256').update(payload).digest('hex')
}

function resolveDesiredState(
  config: ValidatedNetBirdConfig
): Pick<NodeAgentRuntimeDesiredSidecar, 'desiredState' | 'healthStatus'> {
  const prerequisites = config.prerequisites
  if (
    prerequisites &&
    (!prerequisites.signalReady || !prerequisites.relayReady || !prerequisites.stunReady)
  ) {
    return { desiredState: 'configure', healthStatus: 'degraded' }
  }

  return { desiredState: 'start', healthStatus: config.sidecarHealthStatus ?? 'healthy' }
}

/**
 * 将 SecretProvider 已解析的 NetBird 控制面输入翻译为 node-agent sidecar 期望态。
 */
export function createNetBirdAdapter(config: {
  readonly profileVersion: MNetProfileV03VersionFromSchema
  readonly controlPlane: NetBirdResolvedControlPlaneConfig
}): NetBirdAdapterResult {
  const validated = validateResolvedConfig(config.controlPlane)
  if (!validated.ok) {
    return rejectConfig(validated.error.code, validated.error.message, validated.error.fields)
  }

  const resolved = validated.value
  const state = resolveDesiredState(resolved)
  const configHash = deriveConfigHash({
    profileVersion: config.profileVersion,
    managementUrl: resolved.managementUrl,
    setupKey: resolved.setupKey,
    signalConfigRef: resolved.signalConfigRef,
    relayConfigRef: resolved.relayConfigRef,
    stunConfigRef: resolved.stunConfigRef,
    sidecarCredentialRef: resolved.sidecarCredentialRef
  })
  const desiredState: NodeAgentRuntimeDesiredSidecar = {
    signalConfigRef: resolved.signalConfigRef,
    relayConfigRef: resolved.relayConfigRef,
    stunConfigRef: resolved.stunConfigRef,
    sidecarCredentialRef: resolved.sidecarCredentialRef,
    desiredState: state.desiredState,
    credentialStatus: resolved.sidecarCredentialStatus ?? 'ready',
    healthStatus: state.healthStatus,
    configHash
  }

  return {
    enabled: true,
    status: 'enabled',
    transport: 'netbird-sidecar',
    profileVersion: config.profileVersion,
    desiredState,
    clientConfig: {
      managementUrl: resolved.managementUrl,
      setupKey: resolved.setupKey,
      profileVersion: config.profileVersion,
      configHash
    }
  }
}
