import * as Schema from 'effect/Schema'
import {
  deployApiRoutes,
  MDeployAgentsResponseSchema,
  MDeployApprovalResponseSchema,
  MDeployApplyOperationResponseSchema,
  MDeployDesiredStateSummaryV01Schema,
  MDeployDriftCheckResponseSchema,
  MDeployDriftResponseSchema,
  MDeployEvidenceResponseSchema,
  MDeployProposalResponseSchema,
  MDeployRollbackOperationResponseSchema
} from '../../../../packages/contracts/src/index.ts'
import type { CliClient } from '../commands/types.ts'
import type { CliRuntime } from './runtime.ts'

/**
 * 部署客户端通过 Core 公开部署 facade 访问 M-Deploy 控制面。
 * 响应在消费端边界处用共享的 M-Deploy 公开响应 Effect Schema 解码，
 * 解码失败立即以清晰错误退出，绝不把未验证数据当成可用结果。
 */
/** 控制面命令（propose/approve/apply/... ）的运行前提，用于把底层网络错误转成可操作的提示。 */
const CONTROL_PLANE_HINT =
  'propose/approve/apply/rollback/status/agents/drift/evidence 需要已 bootstrap 并运行的 M-Deploy 控制面（Core → M-Deploy + M-Policy + M-Log），前置步骤见 docs/operations/RUNBOOK.md'

function deployHttpError(error: { code: string; message: string }): Error {
  if (error.code === 'expired_token') {
    return new Error(
      '认证令牌已过期。请通过已配置的身份提供方续期后重试；仅在明确使用 local-dev 身份提供方的本地开发环境中，可执行 bun run token:mint --actor <actor> 重新获取本地开发令牌。CLI 不会自动刷新、重试或执行部署操作。'
    )
  }
  if (error.code === 'policy.denied') {
    return new Error(
      '部署操作被 M-Policy 拒绝。生产环境请使用具备对应部署权限的身份；仅在明确使用 local-dev 身份提供方的本地开发环境中，admin 可读取和提交提案，security-admin 可审批、apply 与 rollback。可显式运行 bun run token:mint --actor admin 或 bun run token:mint --actor security-admin。CLI 不会自动提升权限、签发令牌、重试或重新执行部署操作。'
    )
  }
  if (error.code === 'http.unavailable' || error.code === 'http.invalid_json') {
    return new Error(
      `无法连接 Core（${error.message}）——请确认控制面已启动且 MERISTEM_CORE_URL 正确。${CONTROL_PLANE_HINT}`
    )
  }
  if (error.code === 'm-deploy.unavailable') {
    return new Error(`M-Deploy 控制面不可达（${error.message}）。${CONTROL_PLANE_HINT}`)
  }
  if (error.code === 'feature.unavailable') {
    return new Error(`部署控制面未接线（${error.message}）——Core 未接入 M-Deploy 端口。`)
  }
  return new Error(error.message)
}

export function createDeployClient(runtime: CliRuntime): NonNullable<CliClient['deploy']> {
  const { coreRoutes } = runtime

  async function getDecoded<TSchema extends Schema.Codec<unknown>>(
    path: string,
    schema: TSchema
  ): Promise<TSchema['Type']> {
    const result = await coreRoutes.getJson(path)
    if (!result.ok) throw deployHttpError(result.error)
    return Schema.decodeUnknownSync(schema)(result.value)
  }

  async function postDecoded<TSchema extends Schema.Codec<unknown>>(
    path: string,
    schema: TSchema,
    body?: unknown
  ): Promise<TSchema['Type']> {
    const result = await coreRoutes.postJson(path, body === undefined ? {} : { body })
    if (!result.ok) throw deployHttpError(result.error)
    return Schema.decodeUnknownSync(schema)(result.value)
  }

  return {
    async desiredState() {
      return getDecoded(deployApiRoutes.desiredState, MDeployDesiredStateSummaryV01Schema)
    },
    async propose(input) {
      return postDecoded(deployApiRoutes.proposals, MDeployProposalResponseSchema, input)
    },
    async getProposal(proposalId) {
      return getDecoded(
        deployApiRoutes.proposalDetail.replace(':id', encodeURIComponent(proposalId)),
        MDeployProposalResponseSchema
      )
    },
    async approve(proposalId, result) {
      return postDecoded(
        deployApiRoutes.approve.replace(':id', encodeURIComponent(proposalId)),
        MDeployApprovalResponseSchema,
        { result }
      )
    },
    async apply(input) {
      return postDecoded(deployApiRoutes.apply, MDeployApplyOperationResponseSchema, input)
    },
    async rollback(input) {
      return postDecoded(deployApiRoutes.rollback, MDeployRollbackOperationResponseSchema, input)
    },
    async drift() {
      return getDecoded(deployApiRoutes.drift, MDeployDriftResponseSchema)
    },
    async driftCheck() {
      return postDecoded(deployApiRoutes.driftCheck, MDeployDriftCheckResponseSchema, {})
    },
    async evidence() {
      return getDecoded(deployApiRoutes.evidence, MDeployEvidenceResponseSchema)
    },
    async agents() {
      return getDecoded(deployApiRoutes.agents, MDeployAgentsResponseSchema)
    }
  }
}
