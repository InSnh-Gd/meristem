import type {
  MDeployDigestFromSchema,
  MDeployInfrastructureTopologyV01FromSchema,
  MDeployIacDriverFromSchema,
  MDeployOpenTofuPlanApplyStatusV01FromSchema,
  MDeployRuntimeHealthV01FromSchema,
  MDeployDriftReportV01FromSchema
} from '../../../packages/contracts/src/index.ts'
import type { Result } from '../../../packages/common/src/result.ts'

export type MDeployRenderedFile = {
  readonly path: string
  readonly content: string
}

export type MDeployDriverError = {
  readonly code:
    | 'agent_runtime_unsupported'
    | 'command_failed'
    | 'configuration_invalid'
    | 'desired_state_invalid'
    | 'external_tool_unavailable'
    | 'literal_secret_rejected'
    | 'mutable_image_reference'
    | 'output_write_failed'
    | 'runtime_driver_mismatch'
    | 'topology_invalid'
  readonly message: string
  readonly detail?: string
}

export type MDeployOpenTofuModuleInput = {
  readonly schemaVersion: 'mdeploy.opentofu-module-input@0.1.0'
  readonly topology: MDeployInfrastructureTopologyV01FromSchema
}

export type MDeployQuadletRender = {
  readonly runtimeClass: 'production'
  readonly runtimeDriver: 'podman'
  readonly unitManager: 'quadlet-systemd'
  readonly rootlessUnitDirectory: '%h/.config/containers/systemd'
  readonly files: readonly MDeployRenderedFile[]
}

export type MDeployDriverFilePort = {
  writeFiles(
    root: string,
    files: readonly MDeployRenderedFile[]
  ): Promise<Result<void, MDeployDriverError>>
}

export type MDeployDriverCommandPort = {
  run(
    command: string,
    args: readonly string[],
    options?: { readonly cwd?: string }
  ): Promise<Result<{ readonly stdout: string; readonly stderr: string }, MDeployDriverError>>
}

export type MDeployDriverEffects = MDeployDriverFilePort & MDeployDriverCommandPort

export type MDeployIacTool = Extract<MDeployIacDriverFromSchema, 'opentofu' | 'terraform'>

export type MDeployOpenTofuOperationInput = {
  readonly operationId: string
  readonly topology: unknown
  readonly workDir: string
  readonly checkedAt: string
}

export type MDeployPodmanHealthProbeInput = {
  readonly agentId: string
  readonly hostId: string
  readonly immutableImageVerified: boolean
  readonly appliedImageDigest?: MDeployDigestFromSchema
  readonly checkedAt: string
}

export type MDeployInfrastructureInspection = {
  readonly health: MDeployRuntimeHealthV01FromSchema
  readonly drift: MDeployDriftReportV01FromSchema
  readonly iac?: MDeployOpenTofuPlanApplyStatusV01FromSchema
}

export type MDeployInfrastructureAgentAdapterOptions = {
  readonly effects: MDeployDriverEffects
  readonly topology: MDeployInfrastructureTopologyV01FromSchema
  readonly workDir: string
  readAppliedImageDigest(input: {
    readonly agentId: string
    readonly hostId: string
    readonly correlationId: string
  }): Promise<Result<MDeployDigestFromSchema, MDeployDriverError>>
}
