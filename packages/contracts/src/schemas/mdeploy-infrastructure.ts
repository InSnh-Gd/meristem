import * as Schema from 'effect/Schema'
import { err, ok, type Result } from '../../../common/src/result.ts'
import { MDeployRuntimeDriverSchema } from './mdeploy-common.ts'

export const MDeployInfrastructureWorkloadClassSchema = Schema.Literal(
  'control-state',
  'search',
  'leaf'
)
export type MDeployInfrastructureWorkloadClassFromSchema =
  typeof MDeployInfrastructureWorkloadClassSchema.Type

export const MDeployInfrastructureResourcesV01Schema = Schema.Struct({
  vcpu: Schema.Number,
  memoryMiB: Schema.Number,
  diskGiB: Schema.Number
})
export type MDeployInfrastructureResourcesV01FromSchema =
  typeof MDeployInfrastructureResourcesV01Schema.Type

export const MDeployInfrastructureNodeV01Schema = Schema.Struct({
  nodeId: Schema.String,
  workloadClass: MDeployInfrastructureWorkloadClassSchema,
  failureDomain: Schema.String,
  resources: MDeployInfrastructureResourcesV01Schema,
  runtimeDriver: MDeployRuntimeDriverSchema
})
export type MDeployInfrastructureNodeV01FromSchema = typeof MDeployInfrastructureNodeV01Schema.Type

export const MDeployInfrastructureNetworkV01Schema = Schema.Struct({
  networkId: Schema.String,
  cidr: Schema.String
})
export type MDeployInfrastructureNetworkV01FromSchema =
  typeof MDeployInfrastructureNetworkV01Schema.Type

/** Provider-neutral desired topology. Provider bindings belong outside this contract. */
export const MDeployInfrastructureTopologyV01Schema = Schema.Struct({
  schemaVersion: Schema.Literal('mdeploy.infrastructure-topology@0.1.0'),
  topologyId: Schema.String,
  revision: Schema.String,
  network: MDeployInfrastructureNetworkV01Schema,
  nodes: Schema.Array(MDeployInfrastructureNodeV01Schema)
})
export type MDeployInfrastructureTopologyV01FromSchema =
  typeof MDeployInfrastructureTopologyV01Schema.Type

export type MDeployInfrastructureTopologyValidationFailure = {
  readonly code: 'topology_invalid'
  readonly message: string
}

export function validateMDeployInfrastructureTopologyV01(
  input: unknown
): Result<
  MDeployInfrastructureTopologyV01FromSchema,
  MDeployInfrastructureTopologyValidationFailure
> {
  try {
    return ok(Schema.decodeUnknownSync(MDeployInfrastructureTopologyV01Schema)(input))
  } catch {
    return err({ code: 'topology_invalid', message: 'infrastructure topology is invalid' })
  }
}
