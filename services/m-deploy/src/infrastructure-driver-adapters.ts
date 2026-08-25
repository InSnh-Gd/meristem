import { err, ok, type Result } from '../../../packages/common/src/result.ts'
import type {
  MDeployDigestFromSchema,
  MDeployOpenTofuPlanApplyStatusV01FromSchema,
  MDeployRuntimeHealthV01FromSchema,
  MDeploySignedEnvelopeV01FromSchema
} from '../../../packages/contracts/src/index.ts'
import type { MDeployAgentRecord, MDeployDeps } from './deps.ts'
import {
  deriveMDeployRuntimeHealth,
  reportMDeployRuntimeDrift,
  renderOpenTofuModuleInput,
  renderPodmanQuadlets
} from './infrastructure-driver-renderers.ts'
import type {
  MDeployDriverEffects,
  MDeployDriverError,
  MDeployIacTool,
  MDeployInfrastructureAgentAdapterOptions,
  MDeployInfrastructureInspection,
  MDeployOpenTofuOperationInput,
  MDeployPodmanHealthProbeInput
} from './infrastructure-driver-types.ts'

type RuntimeOperationInput = {
  readonly agent: MDeployAgentRecord
  readonly envelope: MDeploySignedEnvelopeV01FromSchema
  readonly correlationId: string
}

/** 通过显式本地文件与命令端口运行选定 IaC 工具；控制器不会建立 SSH 或远程 shell。 */
export function createIacDriver(effects: MDeployDriverEffects, iacDriver: MDeployIacTool) {
  const commandName = iacDriver === 'opentofu' ? 'tofu' : 'terraform'
  async function prepare(
    input: MDeployOpenTofuOperationInput
  ): Promise<Result<void, MDeployDriverError>> {
    const rendered = renderOpenTofuModuleInput(input.topology)
    if (!rendered.ok) return rendered
    const write = await effects.writeFiles(input.workDir, [
      {
        path: 'topology.auto.tfvars.json',
        content: `${JSON.stringify(rendered.value, null, 2)}\n`
      }
    ])
    return write.ok ? write : normalizeEffectError(write, 'output_write_failed')
  }

  async function plan(
    input: MDeployOpenTofuOperationInput
  ): Promise<Result<MDeployOpenTofuPlanApplyStatusV01FromSchema, MDeployDriverError>> {
    const prepared = await prepare(input)
    if (!prepared.ok) return prepared
    const command = await effects.run(
      commandName,
      ['plan', '-input=false', '-lock=false', '-out=mdeploy.tfplan'],
      { cwd: input.workDir }
    )
    if (!command.ok) return normalizeEffectError(command, 'command_failed')
    return ok({
      schemaVersion: 'mdeploy.opentofu-status@0.1.0',
      operationId: input.operationId,
      planStatus: 'planned',
      applyStatus: 'not_started',
      checkedAt: input.checkedAt
    })
  }

  async function apply(
    input: MDeployOpenTofuOperationInput
  ): Promise<Result<MDeployOpenTofuPlanApplyStatusV01FromSchema, MDeployDriverError>> {
    const planned = await plan(input)
    if (!planned.ok) return planned
    const command = await effects.run(
      commandName,
      ['apply', '-input=false', '-auto-approve', 'mdeploy.tfplan'],
      { cwd: input.workDir }
    )
    if (!command.ok) return normalizeEffectError(command, 'command_failed')
    return ok({ ...planned.value, applyStatus: 'succeeded', checkedAt: input.checkedAt })
  }

  return { plan, apply }
}

/** 兼容现有 OpenTofu 调用方的具名工厂。 */
export function createOpenTofuDriver(effects: MDeployDriverEffects) {
  return createIacDriver(effects, 'opentofu')
}

/** Terraform 使用与 OpenTofu 相同的显式本地效果边界，但选择自己的二进制。 */
export function createTerraformDriver(effects: MDeployDriverEffects) {
  return createIacDriver(effects, 'terraform')
}

/** 将本机 Podman 与 user-systemd 命令限制在 agent pull-reconcile 的本地执行边界。 */
export function createPodmanRuntimeDriver(effects: MDeployDriverEffects): MDeployDeps['runtime'] {
  async function reconcile(
    input: RuntimeOperationInput
  ): Promise<Result<void, MDeployDriverError>> {
    if (
      !input.agent.enrollment.capabilities.some(capability => capability.runtimeDriver === 'podman')
    ) {
      return err({
        code: 'agent_runtime_unsupported',
        message: 'agent does not advertise the Podman runtime driver'
      })
    }
    const rendered = renderPodmanQuadlets(input.envelope.payload)
    if (!rendered.ok) return rendered
    const write = await effects.writeFiles(
      rendered.value.rootlessUnitDirectory,
      rendered.value.files
    )
    if (!write.ok) return normalizeEffectError(write, 'output_write_failed')
    const reload = await effects.run('systemctl', ['--user', 'daemon-reload'])
    if (!reload.ok) return normalizeEffectError(reload, 'command_failed')
    const restart = await effects.run('systemctl', ['--user', 'restart', 'meristem.target'])
    if (!restart.ok) return normalizeEffectError(restart, 'command_failed')
    return ok(undefined)
  }

  return { apply: reconcile, rollback: reconcile }
}

/** 检查实际 Podman 与 user-systemd 可用性，并保留不可用工具的 typed failure。 */
export async function probePodmanRuntimeHealth(
  effects: MDeployDriverEffects,
  input: MDeployPodmanHealthProbeInput
): Promise<Result<MDeployRuntimeHealthV01FromSchema, MDeployDriverError>> {
  const podman = await effects.run('podman', ['info', '--format', '{{.Host.Security.Rootless}}'])
  if (!podman.ok && podman.error.code === 'external_tool_unavailable') return podman
  const unitManager = await effects.run('systemctl', ['--user', 'is-system-running'])
  if (!unitManager.ok && unitManager.error.code === 'external_tool_unavailable') return unitManager
  return ok(
    deriveMDeployRuntimeHealth({
      ...input,
      runtimeAvailable: podman.ok,
      unitManagerAvailable: unitManager.ok,
      immutableImageVerified: input.immutableImageVerified
    })
  )
}

/**
 * 在 agent 本机运行 IaC 规划、Podman health probe 与 digest drift 比较；实际 digest 由部署包显式提供。
 */
export function createMDeployInfrastructureAgentAdapter(
  options: MDeployInfrastructureAgentAdapterOptions
) {
  async function inspect(
    input: RuntimeOperationInput & { readonly operationId: string }
  ): Promise<Result<MDeployInfrastructureInspection, MDeployDriverError>> {
    const iacDriver = input.envelope.payload.runtime.iacDriver
    const iac =
      iacDriver === 'disabled'
        ? undefined
        : await createIacDriver(options.effects, iacDriver).plan({
            operationId: input.operationId,
            topology: options.topology,
            workDir: options.workDir,
            checkedAt: input.envelope.payload.generatedAt
          })
    if (iac && !iac.ok) return iac

    const actual = await options.readAppliedImageDigest({
      agentId: input.agent.enrollment.agentId,
      hostId: input.agent.enrollment.hostId,
      correlationId: input.correlationId
    })
    if (!actual.ok) return actual
    const expectedDigest = input.envelope.payload.source.digest
    const immutableImageVerified = digestKey(actual.value) === digestKey(expectedDigest)
    const health = await probePodmanRuntimeHealth(options.effects, {
      agentId: input.agent.enrollment.agentId,
      hostId: input.agent.enrollment.hostId,
      immutableImageVerified,
      appliedImageDigest: actual.value,
      checkedAt: input.envelope.payload.generatedAt
    })
    if (!health.ok) return health
    return ok({
      health: health.value,
      drift: reportMDeployRuntimeDrift({
        reportId: `drift-${input.operationId}`,
        agentId: input.agent.enrollment.agentId,
        expectedDigest,
        actualDigest: actual.value,
        timestamp: input.envelope.payload.generatedAt
      }),
      ...(iac ? { iac: iac.value } : {})
    })
  }

  return { inspect }
}

function digestKey(digest: MDeployDigestFromSchema): string {
  return `${digest.algorithm}:${digest.value}`
}

function normalizeEffectError<T>(
  result: Result<T, MDeployDriverError>,
  fallbackCode: 'command_failed' | 'output_write_failed'
): Result<never, MDeployDriverError> {
  if (result.ok) throw new Error('normalizeEffectError requires a failed result')
  return err({
    code:
      result.error.code === 'external_tool_unavailable'
        ? 'external_tool_unavailable'
        : fallbackCode,
    message: result.error.message,
    ...(result.error.detail ? { detail: result.error.detail } : {})
  })
}
