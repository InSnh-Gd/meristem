import { Elysia, t } from 'elysia'
import {
  apiErrorSchema,
  approvalDetailResponseSchema,
  approvalListResponseSchema,
  mNetRegionalProfileSchema,
  networkProfileListResponseSchema,
  policyApprovalSchema,
  policyApprovalVoteSchema,
  protectedResponse,
  protectedRouteDetail
} from '../schemas.ts'
import type { CoreDeps } from '../types.ts'
import { runFacadeRead, runFacadeRequiredRead, runFacadeWrite } from './facade-support.ts'

/** 可选审批理由统一由 schema 收窄，避免路由层手动解构 unknown body。 */
const approvalReasonBodySchema = t.Optional(
  t.Object({
    reason: t.String({ minLength: 1 })
  })
)

function profileWritePermission(
  profileVersion: string
): 'network:profile-enable' | 'network:profile-disable' {
  return profileVersion === CHINA_PROFILE_VERSION
    ? 'network:profile-enable'
    : 'network:profile-disable'
}

async function runApprovalAction<T>(
  deps: CoreDeps,
  input: {
    approvalId: string
    action: 'policy:approval-approve' | 'policy:approval-reject'
    body: { reason?: string } | null
    headers: Record<string, string | undefined>
    run: (
      ctx: import('./facade-support.ts').FacadeWriterContext,
      body: { reason: string } | undefined
    ) => Promise<import('./facade-support.ts').FacadeServiceResult<T>>
  }
): Promise<T> {
  const reasonBody = input.body?.reason ? { reason: input.body.reason } : undefined
  return runFacadeWrite(deps, {
    headers: input.headers,
    action: input.action,
    resource: `approval:${input.approvalId}`,
    run: (_auth, ctx) => input.run(ctx, reasonBody)
  })
}

/** Profile 写请求体 schema，profileVersion 与 reason 均为必填 */
const profileWriteBodySchema = t.Object({
  profileVersion: t.String({ minLength: 1 }),
  reason: t.String({ minLength: 1 })
})

/** 审批操作响应 schema */
const approvalActionResponseSchema = t.Object({
  approval: policyApprovalSchema,
  votes: t.Array(policyApprovalVoteSchema)
})

/** China 区域 profile 版本常量，用于判断 enable/disable 权限方向 */
const CHINA_PROFILE_VERSION = 'm-net-cn@0.3.0'

/**
 * Core 公开读/写 facade 只做认证、授权与错误收敛；真实数据与状态仍由 M-Policy/M-Net 公共 HTTP API 拥有。
 */
export function approvalProfileFacadeRoutes(deps: CoreDeps) {
  return (
    new Elysia()
      .get(
        '/api/v0/policy/approvals',
        async ({ headers }) => {
          return runFacadeRead(deps, {
            headers,
            action: deps.approvalReader.requiredPermission,
            resource: 'policy:approvals',
            run: (auth, ctx) =>
              deps.approvalReader.list({
                ...ctx,
                correlationId: auth.correlationId
              })
          })
        },
        {
          response: protectedResponse(approvalListResponseSchema, { 503: apiErrorSchema }),
          detail: protectedRouteDetail('List policy approvals through Core facade')
        }
      )
      .get(
        '/api/v0/policy/approvals/:id',
        async ({ params, headers }) => {
          return runFacadeRequiredRead(deps, {
            headers,
            action: deps.approvalReader.requiredPermission,
            resource: `approval:${params.id}`,
            notFound: { code: 'approval.not_found', message: 'approval not found' },
            run: (auth, ctx) =>
              deps.approvalReader.get(params.id, {
                ...ctx,
                correlationId: auth.correlationId
              })
          })
        },
        {
          params: t.Object({ id: t.String({ minLength: 1 }) }),
          response: protectedResponse(approvalDetailResponseSchema, {
            404: apiErrorSchema,
            503: apiErrorSchema
          }),
          detail: protectedRouteDetail('Read one policy approval through Core facade')
        }
      )
      .get(
        '/api/v0/network-profiles',
        async ({ headers }) => {
          const response = await runFacadeRead(deps, {
            headers,
            action: deps.networkProfileReader.requiredPermission,
            resource: 'network-profiles',
            run: (auth, ctx) =>
              deps.networkProfileReader.list({
                ...ctx,
                correlationId: auth.correlationId
              })
          })
          return response
        },
        {
          response: protectedResponse(networkProfileListResponseSchema, { 503: apiErrorSchema }),
          detail: protectedRouteDetail('List network profiles through Core facade')
        }
      )
      .get(
        '/api/v0/network-profiles/:profileVersion',
        async ({ params, headers }) => {
          const response = await runFacadeRequiredRead(deps, {
            headers,
            action: deps.networkProfileReader.requiredPermission,
            resource: `network-profile:${params.profileVersion}`,
            notFound: { code: 'profile.not_found', message: 'profile not found' },
            run: (auth, ctx) =>
              deps.networkProfileReader.get(params.profileVersion, {
                ...ctx,
                correlationId: auth.correlationId
              })
          })
          return response
        },
        {
          params: t.Object({ profileVersion: t.String({ minLength: 1 }) }),
          response: protectedResponse(mNetRegionalProfileSchema, {
            404: apiErrorSchema,
            503: apiErrorSchema
          }),
          detail: protectedRouteDetail('Read one network profile through Core facade')
        }
      )
      // ── Write routes ─────────────────────────────────────────────────────
      /** POST /api/v0/policy/approvals/:id/approve — 审批通过（Core 认证+授权后转发到 M-Policy） */
      .post(
        '/api/v0/policy/approvals/:id/approve',
        async ({ params, body, headers }) => {
          return runApprovalAction(deps, {
            approvalId: params.id,
            action: 'policy:approval-approve',
            body,
            headers,
            run: (ctx, reasonBody) => deps.approvalWriter.approve(params.id, reasonBody ?? {}, ctx)
          })
        },
        {
          params: t.Object({ id: t.String({ minLength: 1 }) }),
          body: approvalReasonBodySchema,
          response: protectedResponse(approvalActionResponseSchema, {
            403: apiErrorSchema,
            404: apiErrorSchema,
            409: apiErrorSchema,
            503: apiErrorSchema
          }),
          detail: protectedRouteDetail('Approve a policy approval through Core facade')
        }
      )
      /** POST /api/v0/policy/approvals/:id/reject — 审批拒绝（Core 认证+授权后转发到 M-Policy） */
      .post(
        '/api/v0/policy/approvals/:id/reject',
        async ({ params, body, headers }) => {
          return runApprovalAction(deps, {
            approvalId: params.id,
            action: 'policy:approval-reject',
            body,
            headers,
            run: (ctx, reasonBody) => deps.approvalWriter.reject(params.id, reasonBody ?? {}, ctx)
          })
        },
        {
          params: t.Object({ id: t.String({ minLength: 1 }) }),
          body: approvalReasonBodySchema,
          response: protectedResponse(approvalActionResponseSchema, {
            403: apiErrorSchema,
            404: apiErrorSchema,
            409: apiErrorSchema,
            503: apiErrorSchema
          }),
          detail: protectedRouteDetail('Reject a policy approval through Core facade')
        }
      )
      /** POST /api/v0/networks/:id/profile — 网络 profile 变更（Core 认证+授权后转发到 M-Net） */
      .post(
        '/api/v0/networks/:id/profile',
        async ({ params, body, headers }) => {
          return runFacadeWrite(deps, {
            headers,
            action: profileWritePermission(body.profileVersion),
            resource: `network:${params.id}`,
            run: (_auth, ctx) =>
              deps.networkProfileWriter.setProfile(
                params.id,
                { profileVersion: body.profileVersion, reason: body.reason },
                ctx
              )
          })
        },
        {
          params: t.Object({ id: t.String({ minLength: 1 }) }),
          body: profileWriteBodySchema,
          response: {
            200: t.Union([
              t.Object({
                status: t.Literal('pending_approval'),
                operationId: t.String(),
                approvalId: t.Optional(t.String()),
                correlationId: t.String()
              }),
              t.Object({
                status: t.Literal('disabled'),
                profileVersion: t.String(),
                correlationId: t.String()
              })
            ]),
            401: apiErrorSchema,
            403: apiErrorSchema,
            404: apiErrorSchema,
            409: apiErrorSchema,
            503: apiErrorSchema
          },
          detail: protectedRouteDetail('Set network profile through Core facade')
        }
      )
  )
}
