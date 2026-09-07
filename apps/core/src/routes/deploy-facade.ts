import { Elysia } from 'elysia'
import {
  deployAgentsResponseSchema,
  deployApiRoutes,
  deployApplyBodySchema,
  deployApplyResponseSchema,
  deployApprovalBodySchema,
  deployApprovalResponseSchema,
  deployDesiredStateResponseSchema,
  deployDriftCheckResponseSchema,
  deployDriftResponseSchema,
  deployEvidenceResponseSchema,
  deployProposalBodySchema,
  deployProposalParamsSchema,
  deployProposalResponseSchema,
  deployRollbackBodySchema,
  deployRollbackResponseSchema
} from '../../../../packages/contracts/src/index.ts'
import { apiErrorSchema, protectedResponse, protectedRouteDetail } from '../schemas.ts'
import type { CoreDeps } from '../types.ts'
import { mDeployFacadePermissions } from '../types/mdeploy-facade.ts'
import {
  facadeFeatureUnavailable,
  missingFacadeResource,
  runFacadeMaybeRead,
  runFacadeRead
} from './facade-support.ts'

const notFoundError = { 404: apiErrorSchema } as const

/** 每个 facade 路由的 401/403/404/503 错误信封与共享 200 响应 schema。 */
function deployResponse(
  success: Parameters<typeof protectedResponse>[0],
  extra: Parameters<typeof protectedResponse>[1] = {}
) {
  return protectedResponse(success, {
    400: apiErrorSchema,
    404: apiErrorSchema,
    503: apiErrorSchema,
    ...extra
  })
}

/**
 * Core 公开 facade：部署操作（M-Deploy 是事实与审计的 owner，Core 只做认证、授权与透传）。
 * 请求体与响应信封复用 contracts 中的共享 TypeBox 定义；适配器层已用 Effect Schema
 * 对 M-Deploy 响应做过跨服务边界解码，这里再以 TypeBox 声明公开契约。
 */
export function deployFacadeRoutes(deps: CoreDeps) {
  const mDeploy = deps.mDeploy

  // 端口未接线时，所有部署公开路由一致返回 503，避免局部可用的半挂状态。
  if (!mDeploy) {
    const unavailable = facadeFeatureUnavailable('deployment control plane not wired')
    const notWired = new Elysia()
      .get(deployApiRoutes.desiredState, ({ set }) => {
        set.status = 503
        return unavailable
      })
      .post(deployApiRoutes.proposals, ({ set }) => {
        set.status = 503
        return unavailable
      })
      .get(deployApiRoutes.proposalDetail, ({ set }) => {
        set.status = 503
        return unavailable
      })
      .post(deployApiRoutes.approve, ({ set }) => {
        set.status = 503
        return unavailable
      })
      .post(deployApiRoutes.apply, ({ set }) => {
        set.status = 503
        return unavailable
      })
      .post(deployApiRoutes.rollback, ({ set }) => {
        set.status = 503
        return unavailable
      })
      .get(deployApiRoutes.drift, ({ set }) => {
        set.status = 503
        return unavailable
      })
      .post(deployApiRoutes.driftCheck, ({ set }) => {
        set.status = 503
        return unavailable
      })
      .get(deployApiRoutes.evidence, ({ set }) => {
        set.status = 503
        return unavailable
      })
      .get(deployApiRoutes.agents, ({ set }) => {
        set.status = 503
        return unavailable
      })
    return notWired
  }

  const runRead = async <T>(
    headers: Record<string, string | undefined>,
    action: (typeof mDeployFacadePermissions)[keyof typeof mDeployFacadePermissions],
    resource: string,
    run: Parameters<typeof runFacadeRead<T>>[1]['run']
  ) =>
    runFacadeRead(deps, {
      headers,
      action,
      resource,
      run
    })

  const runWrite = runRead

  return new Elysia()
    .get(
      deployApiRoutes.desiredState,
      async ({ headers }) =>
        runRead(
          headers,
          mDeployFacadePermissions.desiredStateRead,
          'deploy:desired-state',
          (_auth, ctx) => mDeploy.desiredState(ctx)
        ),
      {
        response: deployResponse(deployDesiredStateResponseSchema),
        detail: protectedRouteDetail('Read deployment desired-state summary through Core facade')
      }
    )
    .post(
      deployApiRoutes.proposals,
      async ({ body, headers }) =>
        runWrite(
          headers,
          mDeployFacadePermissions.desiredStatePropose,
          'deploy:desired-state',
          (_auth, ctx) => mDeploy.propose(body, ctx)
        ),
      {
        body: deployProposalBodySchema,
        response: deployResponse(deployProposalResponseSchema),
        detail: protectedRouteDetail('Propose deployment desired state through Core facade')
      }
    )
    .get(
      deployApiRoutes.proposalDetail,
      async ({ params, headers }) => {
        const result = await runFacadeMaybeRead(deps, {
          headers,
          action: mDeployFacadePermissions.desiredStateRead,
          resource: `deploy:proposal:${params.id}`,
          run: (_auth, ctx) => mDeploy.proposal(params.id, ctx)
        })
        if (result.value === null) {
          missingFacadeResource(
            result.correlationId,
            'deploy.proposal_not_found',
            'proposal not found'
          )
        }
        return result.value
      },
      {
        params: deployProposalParamsSchema,
        response: deployResponse(deployProposalResponseSchema, notFoundError),
        detail: protectedRouteDetail('Read deployment proposal detail through Core facade')
      }
    )
    .post(
      deployApiRoutes.approve,
      async ({ params, body, headers }) =>
        runWrite(
          headers,
          mDeployFacadePermissions.desiredStateApprove,
          `deploy:proposal:${params.id}`,
          (_auth, ctx) => mDeploy.approve(params.id, body, ctx)
        ),
      {
        params: deployProposalParamsSchema,
        body: deployApprovalBodySchema,
        response: deployResponse(deployApprovalResponseSchema, notFoundError),
        detail: protectedRouteDetail('Approve or reject deployment proposal through Core facade')
      }
    )
    .post(
      deployApiRoutes.apply,
      async ({ body, headers }) =>
        runWrite(
          headers,
          mDeployFacadePermissions.desiredStateApply,
          'deploy:desired-state',
          (_auth, ctx) => mDeploy.apply(body, ctx)
        ),
      {
        body: deployApplyBodySchema,
        response: deployResponse(deployApplyResponseSchema),
        detail: protectedRouteDetail('Request agent apply through Core facade')
      }
    )
    .post(
      deployApiRoutes.rollback,
      async ({ body, headers }) =>
        runWrite(
          headers,
          mDeployFacadePermissions.desiredStateRollback,
          'deploy:desired-state',
          (_auth, ctx) => mDeploy.rollback(body, ctx)
        ),
      {
        body: deployRollbackBodySchema,
        response: deployResponse(deployRollbackResponseSchema),
        detail: protectedRouteDetail('Request agent rollback through Core facade')
      }
    )
    .get(
      deployApiRoutes.drift,
      async ({ headers }) =>
        runRead(headers, mDeployFacadePermissions.driftRead, 'deploy:drift', (_auth, ctx) =>
          mDeploy.drift(ctx)
        ),
      {
        response: deployResponse(deployDriftResponseSchema),
        detail: protectedRouteDetail('Read deployment drift reports through Core facade')
      }
    )
    .post(
      deployApiRoutes.driftCheck,
      async ({ headers }) =>
        runWrite(headers, mDeployFacadePermissions.driftRead, 'deploy:drift', (_auth, ctx) =>
          mDeploy.driftCheck(ctx)
        ),
      {
        response: deployResponse(deployDriftCheckResponseSchema),
        detail: protectedRouteDetail('Request a drift check through Core facade')
      }
    )
    .get(
      deployApiRoutes.evidence,
      async ({ headers }) =>
        runRead(headers, mDeployFacadePermissions.evidenceRead, 'deploy:evidence', (_auth, ctx) =>
          mDeploy.evidence(ctx)
        ),
      {
        response: deployResponse(deployEvidenceResponseSchema),
        detail: protectedRouteDetail('Read deployment evidence records through Core facade')
      }
    )
    .get(
      deployApiRoutes.agents,
      async ({ headers }) =>
        runRead(headers, mDeployFacadePermissions.desiredStateRead, 'deploy:agents', (_auth, ctx) =>
          mDeploy.agents(ctx)
        ),
      {
        response: deployResponse(deployAgentsResponseSchema),
        detail: protectedRouteDetail('List deployment agents through Core facade')
      }
    )
}
