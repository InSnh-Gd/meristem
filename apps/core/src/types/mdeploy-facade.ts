import type { ActorId } from '../../../../packages/contracts/src/index.ts'
import type {
  MDeployAgentsResponseFromSchema,
  MDeployApplyOperationResponseFromSchema,
  MDeployApprovalResponseFromSchema,
  MDeployDesiredStateSummaryV01FromSchema,
  MDeployDriftCheckResponseFromSchema,
  MDeployDriftResponseFromSchema,
  MDeployEvidenceResponseFromSchema,
  MDeployProposalResponseFromSchema,
  MDeployRollbackOperationResponseFromSchema
} from '../../../../packages/contracts/src/index.ts'
import type { Permission } from '../../../../packages/contracts/src/index.ts'
import type { FacadeServiceResult } from './facade-result.ts'

/** M-Deploy facade 上下文只透传 actor、Bearer token 与关联 ID，与 facade-support 结构一致。 */
export type MDeployFacadeContext = {
  actor: ActorId
  bearerToken: string
  correlationId: string
}

/**
 * Core 的 M-Deploy 公开 facade 是纯传输层：
 * Core 只做认证、授权与错误收敛，把请求透传给 M-Deploy 公开 HTTP API；
 * 不复制 M-Deploy 的准入、审计、证据与 drift 逻辑。
 * 响应在适配器层以 Effect Schema 解码为 contracts 中的类型化信封后返回，
 * 公开契约再由路由层 TypeBox response schema 声明。
 */
export type MDeployFacadePort = {
  desiredState(
    ctx: MDeployFacadeContext
  ): Promise<FacadeServiceResult<MDeployDesiredStateSummaryV01FromSchema>>
  propose(
    body: unknown,
    ctx: MDeployFacadeContext
  ): Promise<FacadeServiceResult<MDeployProposalResponseFromSchema>>
  proposal(
    proposalId: string,
    ctx: MDeployFacadeContext
  ): Promise<FacadeServiceResult<MDeployProposalResponseFromSchema | null>>
  approve(
    proposalId: string,
    body: unknown,
    ctx: MDeployFacadeContext
  ): Promise<FacadeServiceResult<MDeployApprovalResponseFromSchema>>
  apply(
    body: unknown,
    ctx: MDeployFacadeContext
  ): Promise<FacadeServiceResult<MDeployApplyOperationResponseFromSchema>>
  rollback(
    body: unknown,
    ctx: MDeployFacadeContext
  ): Promise<FacadeServiceResult<MDeployRollbackOperationResponseFromSchema>>
  drift(ctx: MDeployFacadeContext): Promise<FacadeServiceResult<MDeployDriftResponseFromSchema>>
  driftCheck(
    ctx: MDeployFacadeContext
  ): Promise<FacadeServiceResult<MDeployDriftCheckResponseFromSchema>>
  evidence(
    ctx: MDeployFacadeContext
  ): Promise<FacadeServiceResult<MDeployEvidenceResponseFromSchema>>
  agents(ctx: MDeployFacadeContext): Promise<FacadeServiceResult<MDeployAgentsResponseFromSchema>>
}

/** facade 路由使用的权限常量与 contracts 中的 deploymentPermission 保持一致。 */
export const mDeployFacadePermissions = {
  desiredStateRead: 'deploy:desired-state-read',
  desiredStatePropose: 'deploy:desired-state-propose',
  desiredStateApprove: 'deploy:desired-state-approve',
  desiredStateApply: 'deploy:desired-state-apply',
  desiredStateRollback: 'deploy:desired-state-rollback',
  driftRead: 'deploy:drift-read',
  evidenceRead: 'deploy:evidence-read'
} as const satisfies Record<string, Permission>
