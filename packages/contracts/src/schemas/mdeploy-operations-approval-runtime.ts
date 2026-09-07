import * as Schema from 'effect/Schema'
import { err, ok, type Result } from '../../../common/src/result.ts'
import { MDeployGitSourceRefV01Schema, MDeployIacDriverSchema } from './mdeploy-common.ts'

export const MDeployApprovalStatusSchema = Schema.Literals([
  'pending',
  'approved',
  'rejected',
  'expired'
])
export type MDeployApprovalStatusFromSchema = typeof MDeployApprovalStatusSchema.Type

export const MDeployApprovalResultSchema = Schema.Literals(['approve', 'reject'])
export type MDeployApprovalResultFromSchema = typeof MDeployApprovalResultSchema.Type

export const MDeployDiffSummaryV01Schema = Schema.Struct({
  added: Schema.Number,
  changed: Schema.Number,
  removed: Schema.Number,
  summary: Schema.String
})
export type MDeployDiffSummaryV01FromSchema = typeof MDeployDiffSummaryV01Schema.Type

export const MDeployProposalV01Schema = Schema.Struct({
  schemaVersion: Schema.Literal('mdeploy.proposal@0.1.0'),
  proposalId: Schema.String,
  sourceRef: MDeployGitSourceRefV01Schema,
  diffSummary: MDeployDiffSummaryV01Schema,
  actor: Schema.String,
  policyDecisionId: Schema.String,
  approvalStatus: MDeployApprovalStatusSchema,
  createdAt: Schema.String,
  correlationId: Schema.String
})
export type MDeployProposalV01FromSchema = typeof MDeployProposalV01Schema.Type

export const MDeployApprovalV01Schema = Schema.Struct({
  schemaVersion: Schema.Literal('mdeploy.approval@0.1.0'),
  approvalId: Schema.String,
  proposalId: Schema.String,
  approver: Schema.String,
  timestamp: Schema.String,
  result: MDeployApprovalResultSchema,
  policyDecisionId: Schema.String,
  correlationId: Schema.String
})
export type MDeployApprovalV01FromSchema = typeof MDeployApprovalV01Schema.Type

export const MDeployRuntimeClassSchema = Schema.Literals(['production', 'compatibility'])
export type MDeployRuntimeClassFromSchema = typeof MDeployRuntimeClassSchema.Type

export const MDeployRuntimeUnitManagerSchema = Schema.Literals([
  'quadlet-systemd',
  'docker-compose'
])
export type MDeployRuntimeUnitManagerFromSchema = typeof MDeployRuntimeUnitManagerSchema.Type

export const MDeployPodmanRuntimeDriverSelectionV01Schema = Schema.Struct({
  schemaVersion: Schema.Literal('mdeploy.runtime-driver-selection@0.1.0'),
  runtimeClass: Schema.Literal('production'),
  runtimeDriver: Schema.Literal('podman'),
  unitManager: Schema.Literal('quadlet-systemd'),
  iacDriver: MDeployIacDriverSchema,
  selectedAt: Schema.String,
  selectedBy: Schema.String
})
export type MDeployPodmanRuntimeDriverSelectionV01FromSchema =
  typeof MDeployPodmanRuntimeDriverSelectionV01Schema.Type

export const MDeployDockerRuntimeDriverSelectionV01Schema = Schema.Struct({
  schemaVersion: Schema.Literal('mdeploy.runtime-driver-selection@0.1.0'),
  runtimeClass: Schema.Literal('compatibility'),
  runtimeDriver: Schema.Literal('docker'),
  unitManager: Schema.Literal('docker-compose'),
  iacDriver: MDeployIacDriverSchema,
  selectedAt: Schema.String,
  selectedBy: Schema.String
})
export type MDeployDockerRuntimeDriverSelectionV01FromSchema =
  typeof MDeployDockerRuntimeDriverSelectionV01Schema.Type

export const MDeployRuntimeDriverSelectionV01Schema = Schema.Union([
  MDeployPodmanRuntimeDriverSelectionV01Schema,
  MDeployDockerRuntimeDriverSelectionV01Schema
])
export type MDeployRuntimeDriverSelectionV01FromSchema =
  typeof MDeployRuntimeDriverSelectionV01Schema.Type

export const MDeployRuntimeConfigurationValidationFailureSchema = Schema.Struct({
  code: Schema.Literal('runtime_configuration_invalid'),
  message: Schema.String
})
export type MDeployRuntimeConfigurationValidationFailureFromSchema =
  typeof MDeployRuntimeConfigurationValidationFailureSchema.Type

/**
 * 运行时选择只接受生产 Podman Quadlet/systemd 或 Docker Compose 兼容模式，禁止混合声明。
 */
export function validateMDeployRuntimeDriverSelectionV01(
  input: unknown
): Result<
  MDeployRuntimeDriverSelectionV01FromSchema,
  MDeployRuntimeConfigurationValidationFailureFromSchema
> {
  try {
    return ok(Schema.decodeUnknownSync(MDeployRuntimeDriverSelectionV01Schema)(input))
  } catch (error) {
    return err({ code: 'runtime_configuration_invalid', message: errorMessage(error) })
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
