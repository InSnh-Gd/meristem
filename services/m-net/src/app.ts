import { Elysia, t } from 'elysia'
import { swagger } from '@elysiajs/swagger'
import type {
  CreateNetworkRequest,
  MNetwork,
  MNetworkMember,
  NetworkSummary,
  NodeAgentTaskExecuteResponse
} from '../../../packages/contracts/src/index.ts'
import type {
  MNetRegionalProfile,
  NetworkSuspendedOperation
} from '../../../packages/contracts/src/types/mnet-profile.ts'
import type { ActorId } from '../../../packages/contracts/src/literals.ts'
import { extractBearerToken, verifyLocalToken } from '../../../packages/auth/src/index.ts'
import { validateInternalRequest } from '../../../packages/internal-http/src/index.ts'
import { withExtractedSpan } from '../../../packages/telemetry/src/index.ts'
import {
  canRequestEnable,
  canDisable,
  canResume,
  type ProfileState
} from './profile-state-machine.ts'

export type MNetServiceError = {
  code: string
  message: string
}

export type MNetServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: MNetServiceError }

export type MNetAppDeps = {
  readiness(): Promise<{ ready: boolean }>
  createNetwork(input: CreateNetworkRequest): Promise<MNetServiceResult<MNetwork>>
  listNetworks(): Promise<MNetServiceResult<NetworkSummary[]>>
  joinNetwork(input: { networkId: string; nodeId: string }): Promise<MNetServiceResult<MNetworkMember>>
  listMembers(input: { networkId: string }): Promise<MNetServiceResult<MNetworkMember[]>>
  executeNoop(input: { nodeId: string; taskId: string; correlationId: string }): Promise<MNetServiceResult<NodeAgentTaskExecuteResponse>>
  // Phase 13 deps (optional for feature flag)
  profileStore?: {
    getDefinitions(): Promise<MNetRegionalProfile[]>
    getDefinition(profileVersion: string): Promise<MNetRegionalProfile | null>
    getNetworkState(networkId: string): Promise<{ networkId: string; profileVersion: string; status: string; updatedAt: string } | null>
    setNetworkState(networkId: string, state: { profileVersion: string; status: string }): Promise<void>
    recordTransition(record: { networkId: string; fromVersion: string; toVersion: string; fromStatus: string; toStatus: string; actor: string; reason?: string; policyDecisionId?: string; correlationId?: string }): Promise<void>
  }
  networkUpdater?: {
    setProfileVersion(networkId: string, profileVersion: string): Promise<void>
  }
  policyAuthorize?: {
    authorize(actor: string, action: string, resource: string): Promise<{ result: 'allow' | 'deny' | 'require_manual_review' | 'require_multi_approval'; id: string; reasons: string[] }>
  }
  suspendedOps?: {
    create(input: { policyDecisionId: string; action: string; networkId: string; fromProfileVersion: string; toProfileVersion: string; requestedBy: string; reason?: string; correlationId: string; idempotencyKey: string; expiresAt: string }): Promise<NetworkSuspendedOperation>
    get(id: string): Promise<NetworkSuspendedOperation | null>
    transition(id: string, status: string, terminalReason?: string): Promise<NetworkSuspendedOperation | null>
  }
  approvals?: {
    create(input: { policyDecisionId: string; originService: string; operationId: string; requestedBy: string; requiredAction: string; quorumRequired: number; expiresAt: string }): Promise<{ ok: true; value: { approvalId: string } } | { ok: false; error: { code: string; message: string } }>
  }
  events?: {
    publish(subject: string, type: string, payload: unknown, correlationId?: string): Promise<void>
  }
  log?: {
    writeTimeline(summary: string, subject?: string, correlationId?: string): Promise<void>
    writeFull(level: string, message: string, correlationId?: string, payload?: unknown): Promise<void>
    writeAudit(actor: string, action: string, resource: string, result: string, correlationId?: string, payload?: unknown): Promise<void>
  }
}

const internalErrorSchema = t.Object({
  error: t.Object({
    code: t.String(),
    message: t.String()
  })
})

const networkSchema = t.Object({
  id: t.String(),
  name: t.String(),
  profileVersion: t.String(),
  status: t.Literal('active'),
  createdAt: t.String()
})

const networkSummarySchema = t.Object({
  id: t.String(),
  name: t.String(),
  profileVersion: t.String(),
  status: t.Literal('active'),
  createdAt: t.String(),
  memberCount: t.Number()
})

const networkMemberSchema = t.Object({
  networkId: t.String(),
  nodeId: t.String(),
  nodeKind: t.Union([t.Literal('stem'), t.Literal('leaf')]),
  membershipMode: t.Union([t.Literal('full'), t.Literal('restricted')]),
  status: t.Literal('joined'),
  joinedAt: t.String()
})

const taskExecuteResponseSchema = t.Object({
  nodeId: t.String(),
  taskId: t.String(),
  result: t.Literal('completed'),
  completedAt: t.String()
})

/**
 * internal HTTP 所有入口统一复用共享 token 校验，避免 Core -> M-Net 的 loopback 调用分散出多套认证逻辑。
 */
function requireInternal<TStatus extends (code: never, body: never) => unknown>(
  headers: Headers | Record<string, string | undefined>,
  _status: TStatus
): never | null {
  const auth = validateInternalRequest(headers)
  return auth.ok ? null : _status(401 as Parameters<TStatus>[0], { error: auth.error } as Parameters<TStatus>[1]) as never
}

function internalError<TStatus extends (code: never, body: never) => unknown>(
  _status: TStatus,
  code: 404 | 409 | 503,
  errorBody: MNetServiceError
): never {
  return _status(code as Parameters<TStatus>[0], { error: errorBody } as Parameters<TStatus>[1]) as never
}

/**
 * 从 Bearer token 提取并验证 JWT actor，用于外部 /api/v0 路由。
 * 返回 null 表示认证失败，调用方必须返回 401。
 */
async function verifyBearerAuth(headers: Record<string, string | undefined>): Promise<ActorId | null> {
  const token = extractBearerToken(headers.authorization)
  if (!token) return null
  const secret = process.env.MERISTEM_JWT_SECRET
  if (!secret) return null
  const verified = await verifyLocalToken({ token, secret })
  if (!verified.ok) return null
  return verified.actor
}

/**
 * 外部 API 路由统一错误出口，使用 set.status 设置 HTTP 状态码并返回 never 类型，
 * 让 TypeScript 可以正确将错误分支与非错误分支的返回类型统一。
 */
function externalApiError(set: { status?: unknown }, code: 401 | 403 | 404 | 409 | 503, who: string, message: string): never {
  set.status = code
  return { error: { code: who, message } } as never
}

/**
 * M-Net 业务错误在内部 HTTP 面收敛成稳定状态码，方便 Core 继续沿用统一错误映射策略。
 */
function statusCodeForMNetError(code: string): 404 | 409 | 503 {
  switch (code) {
    case 'network.not_found':
    case 'node.not_found':
    case 'task.not_found':
      return 404
    case 'network.conflict':
    case 'network.stem_required':
    case 'node.invalid_kind':
    case 'node.invalid_status':
    case 'node.unreachable':
    case 'node.join_ticket_expired':
    case 'node.join_ticket_redeemed':
    case 'node.join_ticket_revoked':
      return 409
    default:
      return 503
  }
}

export function createMNetApp(deps: MNetAppDeps) {
  const internalResponse = <
    TSuccess extends ReturnType<typeof t.Object>,
    const TExtra extends Record<number, ReturnType<typeof t.Object>> = {}
  >(
    success: TSuccess,
    extra?: TExtra
  ) => ({
    200: success,
    401: internalErrorSchema,
    ...(extra ?? {})
  }) as const

  return new Elysia()
    .use(swagger({ path: '/api/v0/openapi', documentation: { info: { title: 'M-Net API', version: '0.1.0' } } }))
    .get('/health', () => ({ ok: true as const, service: 'm-net' as const }))
    // ready 路由只接受内部调用；它同时验证 PostgreSQL、M-EventBus 和 M-Log 依赖是否可用。
    .get('/ready', async ({ headers, status }) => {
      const unauthorized = requireInternal(headers, status)
      if (unauthorized) return unauthorized
      return withExtractedSpan('m-net', 'm-net.ready', headers, () => deps.readiness())
    })
    // 这一组 internal routes 是 Core -> M-Net 的显式同步业务边界：
    // 网络编排与 agent task execute 都必须经由这里，而不是继续使用 NATS RPC。
    .group('/internal/v0', (app) => app
      .post('/networks', async ({ body, headers, status }) => {
        const unauthorized = requireInternal(headers, status)
        if (unauthorized) return unauthorized
        return withExtractedSpan('m-net', 'm-net.network.create', headers, async () => {
          const result = await deps.createNetwork(body)
          return result.ok
            ? { network: result.value }
            : internalError(status, statusCodeForMNetError(result.error.code), result.error)
        })
      }, {
        body: t.Object({
          name: t.String({ minLength: 1 }),
          profileVersion: t.Optional(t.String({ minLength: 1 }))
        }),
        response: internalResponse(t.Object({ network: networkSchema }), {
          409: internalErrorSchema,
          503: internalErrorSchema
        })
      })
      .get('/networks', async ({ headers, status }) => {
        const unauthorized = requireInternal(headers, status)
        if (unauthorized) return unauthorized
        return withExtractedSpan('m-net', 'm-net.network.list', headers, async () => {
          const result = await deps.listNetworks()
          return result.ok
            ? { networks: result.value }
            : internalError(status, statusCodeForMNetError(result.error.code), result.error)
        })
      }, {
        response: internalResponse(t.Object({ networks: t.Array(networkSummarySchema) }), {
          503: internalErrorSchema
        })
      })
      .post('/networks/:id/members', async ({ params, body, headers, status }) => {
        const unauthorized = requireInternal(headers, status)
        if (unauthorized) return unauthorized
        return withExtractedSpan('m-net', 'm-net.network.join', headers, async () => {
          const result = await deps.joinNetwork({ networkId: params.id, nodeId: body.nodeId })
          return result.ok
            ? { member: result.value }
            : internalError(status, statusCodeForMNetError(result.error.code), result.error)
        })
      }, {
        params: t.Object({
          id: t.String({ minLength: 1 })
        }),
        body: t.Object({
          nodeId: t.String({ minLength: 1 })
        }),
        response: internalResponse(t.Object({ member: networkMemberSchema }), {
          404: internalErrorSchema,
          409: internalErrorSchema,
          503: internalErrorSchema
        })
      })
      .get('/networks/:id/members', async ({ params, headers, status }) => {
        const unauthorized = requireInternal(headers, status)
        if (unauthorized) return unauthorized
        return withExtractedSpan('m-net', 'm-net.network.members.list', headers, async () => {
          const result = await deps.listMembers({ networkId: params.id })
          return result.ok
            ? { members: result.value }
            : internalError(status, statusCodeForMNetError(result.error.code), result.error)
        })
      }, {
        params: t.Object({
          id: t.String({ minLength: 1 })
        }),
        response: internalResponse(t.Object({ members: t.Array(networkMemberSchema) }), {
          404: internalErrorSchema,
          503: internalErrorSchema
        })
      })
      // Core 对 agent noop 的同步调用收敛到 loopback HTTP；M-Net 再通过活动 session 下发 task.execute。
      .post('/tasks/noop', async ({ body, headers, status }) => {
        const unauthorized = requireInternal(headers, status)
        if (unauthorized) return unauthorized
        return withExtractedSpan('m-net', 'm-net.task.execute.noop', headers, async () => {
          const result = await deps.executeNoop(body)
          return result.ok
            ? { result: result.value }
            : internalError(status, statusCodeForMNetError(result.error.code), result.error)
        })
      }, {
        body: t.Object({
          nodeId: t.String({ minLength: 1 }),
          taskId: t.String({ minLength: 1 }),
          correlationId: t.String({ minLength: 1 })
        }),
        response: internalResponse(t.Object({ result: taskExecuteResponseSchema }), {
          404: internalErrorSchema,
          409: internalErrorSchema,
          503: internalErrorSchema
        })
      })
      // Phase 13: M-Policy 内部回调 resume/reject 挂起操作
      .post('/network-profile-operations/:id/resume', async ({ params, headers, status }) => {
        const unauthorized = requireInternal(headers, status)
        if (unauthorized) return unauthorized

        if (!deps.suspendedOps || !deps.profileStore) {
          return internalError(status, 503, { code: 'feature.unavailable', message: 'profile features are not available' })
        }

        const suspendedOp = await deps.suspendedOps.get(params.id)
        if (!suspendedOp) return internalError(status, 404, { code: 'operation.not_found', message: 'suspended operation not found' })
        if (suspendedOp.status !== 'suspended') return internalError(status, 409, { code: 'operation.not_suspended', message: 'operation is not suspended' })

        const now = new Date()
        if (new Date(suspendedOp.expiresAt) < now) {
          await deps.suspendedOps.transition(params.id, 'expired', 'operation expired')
          return internalError(status, 409, { code: 'operation.expired', message: 'suspended operation expired' })
        }

        // 检查陈旧状态：当前 profile 必须匹配 from_profile_version
        const state = await deps.profileStore.getNetworkState(suspendedOp.networkId)
        if (!state || state.profileVersion !== suspendedOp.fromProfileVersion) {
          await deps.suspendedOps.transition(params.id, 'resume_failed', 'stale state: current profile does not match expected')
          await deps.events?.publish(
            'mnet.profile.apply_failed.v0',
            'mnet.profile.apply_failed',
            {
              networkId: suspendedOp.networkId,
              fromProfileVersion: suspendedOp.fromProfileVersion,
              toProfileVersion: suspendedOp.toProfileVersion,
              actor: 'system',
              policyDecisionId: suspendedOp.policyDecisionId,
              operationId: suspendedOp.id,
              correlationId: suspendedOp.correlationId,
              reason: 'stale_state',
              controlPlaneOnly: true
            },
            suspendedOp.correlationId
          )
          await deps.log?.writeTimeline(`profile apply failed for network ${suspendedOp.networkId}`, 'mnet.profile.apply_failed', suspendedOp.correlationId)
          await deps.log?.writeAudit('system', 'mnet.profile.enable.failure', `network:${suspendedOp.networkId}`, 'failure', suspendedOp.correlationId, { reason: 'stale_state' })
          return internalError(status, 409, { code: 'resume.stale_state', message: 'network profile has changed since operation was created' })
        }

        // Enforce state machine: can only resume from enabling state
        if (!canResume(state.status as ProfileState)) {
          await deps.suspendedOps.transition(params.id, 'resume_failed', `invalid state for resume: ${state.status}`)
          await deps.events?.publish(
            'mnet.profile.apply_failed.v0', 'mnet.profile.apply_failed',
            { networkId: suspendedOp.networkId, fromProfileVersion: suspendedOp.fromProfileVersion, toProfileVersion: suspendedOp.toProfileVersion, actor: 'system', policyDecisionId: suspendedOp.policyDecisionId, operationId: suspendedOp.id, correlationId: suspendedOp.correlationId, reason: `state is ${state.status}, not enabling`, controlPlaneOnly: true },
            suspendedOp.correlationId
          )
          await deps.log?.writeAudit('system', 'mnet.profile.enable.failure', `network:${suspendedOp.networkId}`, 'failure', suspendedOp.correlationId, { reason: `state is ${state.status}, not enabling` })
          return internalError(status, 409, { code: 'resume.invalid_state', message: 'network is not in enabling state' })
        }

        // 应用 profile 变更
        await deps.profileStore.setNetworkState(suspendedOp.networkId, { profileVersion: suspendedOp.toProfileVersion, status: 'enabled' })
        await deps.networkUpdater?.setProfileVersion(suspendedOp.networkId, suspendedOp.toProfileVersion)
        await deps.profileStore.recordTransition({
          networkId: suspendedOp.networkId, fromVersion: suspendedOp.fromProfileVersion, toVersion: suspendedOp.toProfileVersion,
          fromStatus: 'enabling', toStatus: 'enabled', actor: 'system', reason: 'approved resume',
          policyDecisionId: suspendedOp.policyDecisionId, correlationId: suspendedOp.correlationId
        })
        await deps.suspendedOps.transition(params.id, 'resumed')

        await deps.events?.publish(
          'mnet.profile.enabled.v0',
          'mnet.profile.enabled',
          {
            networkId: suspendedOp.networkId,
            fromProfileVersion: suspendedOp.fromProfileVersion,
            toProfileVersion: suspendedOp.toProfileVersion,
            actor: 'system',
            policyDecisionId: suspendedOp.policyDecisionId,
            operationId: suspendedOp.id,
            correlationId: suspendedOp.correlationId,
            reason: suspendedOp.reason ?? 'approved resume',
            controlPlaneOnly: true
          },
          suspendedOp.correlationId
        )
        await deps.log?.writeTimeline(`profile enabled for network ${suspendedOp.networkId}`, 'mnet.profile.enabled', suspendedOp.correlationId)
        await deps.log?.writeFull('info', `profile enabled for network ${suspendedOp.networkId}`, suspendedOp.correlationId, { profileVersion: suspendedOp.toProfileVersion, operationId: suspendedOp.id })
        await deps.log?.writeAudit('system', 'mnet.profile.enable.resume.attempt', `network:${suspendedOp.networkId}`, 'success', suspendedOp.correlationId)
        await deps.log?.writeAudit('system', 'mnet.profile.enable.success', `network:${suspendedOp.networkId}`, 'success', suspendedOp.correlationId, { profileVersion: suspendedOp.toProfileVersion })

        return { status: 'resumed', operationId: params.id }
      })
      .post('/network-profile-operations/:id/reject', async ({ params, headers, status }) => {
        const unauthorized = requireInternal(headers, status)
        if (unauthorized) return unauthorized

        if (!deps.suspendedOps || !deps.profileStore) {
          return internalError(status, 503, { code: 'feature.unavailable', message: 'profile features are not available' })
        }

        const suspendedOp = await deps.suspendedOps.get(params.id)
        if (!suspendedOp) return internalError(status, 404, { code: 'operation.not_found', message: 'suspended operation not found' })
        if (suspendedOp.status !== 'suspended') return internalError(status, 409, { code: 'operation.not_suspended', message: 'operation is not suspended' })

        await deps.profileStore.setNetworkState(suspendedOp.networkId, { profileVersion: suspendedOp.fromProfileVersion, status: 'disabled' })
        await deps.profileStore.recordTransition({
          networkId: suspendedOp.networkId, fromVersion: suspendedOp.fromProfileVersion, toVersion: suspendedOp.toProfileVersion,
          fromStatus: 'enabling', toStatus: 'disabled', actor: 'system', reason: 'approval rejected',
          policyDecisionId: suspendedOp.policyDecisionId, correlationId: suspendedOp.correlationId
        })
        await deps.suspendedOps.transition(params.id, 'rejected', 'approval rejected')

        await deps.events?.publish(
          'mnet.profile.enable.canceled.v0',
          'mnet.profile.enable.canceled',
          {
            networkId: suspendedOp.networkId,
            fromProfileVersion: suspendedOp.fromProfileVersion,
            toProfileVersion: suspendedOp.toProfileVersion,
            actor: 'system',
            policyDecisionId: suspendedOp.policyDecisionId,
            operationId: suspendedOp.id,
            correlationId: suspendedOp.correlationId,
            reason: 'approval rejected',
            controlPlaneOnly: true
          },
          suspendedOp.correlationId
        )
        await deps.log?.writeTimeline(`profile enable canceled for network ${suspendedOp.networkId}`, 'mnet.profile.enable.canceled', suspendedOp.correlationId)
        await deps.log?.writeAudit('system', 'mnet.profile.enable.cancel', `network:${suspendedOp.networkId}`, 'canceled', suspendedOp.correlationId)

        return { status: 'rejected', operationId: params.id }
      }))
    // Phase 13 对外 REST API: 网络 Profile 查询与切换（JWT Bearer Auth）
    .group('/api/v0', (app) => app
      .get('/network-profiles', async ({ headers, set }) => {
        const actor = await verifyBearerAuth(headers)
        if (!actor) return externalApiError(set, 401, 'auth.invalid_token', 'invalid or missing bearer token')
        if (!deps.profileStore || !deps.policyAuthorize) return externalApiError(set, 503, 'feature.unavailable', 'profile features are not available')

        const policyResult = await deps.policyAuthorize.authorize(actor, 'network:profile-read', 'network-profiles')
        if (policyResult.result !== 'allow') return externalApiError(set, 403, 'policy.denied', `read denied: ${policyResult.reasons.join(', ')}`)

        const defs = await deps.profileStore.getDefinitions()
        return { profiles: defs }
      })
      .get('/network-profiles/:profileVersion', async ({ params, headers, set }) => {
        const actor = await verifyBearerAuth(headers)
        if (!actor) return externalApiError(set, 401, 'auth.invalid_token', 'invalid or missing bearer token')
        if (!deps.profileStore || !deps.policyAuthorize) return externalApiError(set, 503, 'feature.unavailable', 'profile features are not available')

        const policyResult = await deps.policyAuthorize.authorize(actor, 'network:profile-read', `network-profile:${params.profileVersion}`)
        if (policyResult.result !== 'allow') return externalApiError(set, 403, 'policy.denied', `read denied: ${policyResult.reasons.join(', ')}`)
        const def = await deps.profileStore.getDefinition(params.profileVersion)
        if (!def) return externalApiError(set, 404, 'profile.not_found', 'profile not found')
        return def
      }, {
        params: t.Object({
          profileVersion: t.String({ minLength: 1 })
        })
      })
      .post('/networks/:id/profile', async ({ params, body, headers, set }) => {
        const actor = await verifyBearerAuth(headers)
        if (!actor) return externalApiError(set, 401, 'auth.invalid_token', 'invalid or missing bearer token')
        if (!deps.profileStore || !deps.suspendedOps || !deps.approvals || !deps.policyAuthorize) {
          return externalApiError(set, 503, 'feature.unavailable', 'profile features are not available')
        }

        const { profileVersion, reason } = body

        const state = await deps.profileStore.getNetworkState(params.id)
        if (!state) return externalApiError(set, 404, 'network.not_found', 'network not found')

        if (profileVersion === 'm-net-cn@0.1.0') {
          const validation = canRequestEnable(state.status as ProfileState)
          if (!validation) return externalApiError(set, 409, 'profile.enable.invalid_state', `cannot enable from ${state.status}`)

          // Call M-Policy for authorization (fail-closed)
          if (!deps.policyAuthorize) {
            return externalApiError(set, 503, 'policy.unavailable', 'policy service is not available')
          }
          const policyResult = await deps.policyAuthorize.authorize(actor, 'network:profile-enable', `network:${params.id}`)

          if (policyResult.result === 'deny') {
            return externalApiError(set, 403, 'policy.denied', `profile enable denied: ${policyResult.reasons.join(', ')}`)
          }

          // 创建挂起操作
          const suspendedOp = await deps.suspendedOps.create({
            policyDecisionId: policyResult.id,
            action: 'mnet.profile.enable',
            networkId: params.id,
            fromProfileVersion: state.profileVersion,
            toProfileVersion: profileVersion,
            requestedBy: actor,
            reason,
            correlationId: crypto.randomUUID(),
            idempotencyKey: crypto.randomUUID(),
            expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
          })

          // 创建 M-Policy 审批（operationId 必须是 suspendedOp.id，M-Policy 用它回调 M-Net resume）
          const approval = await deps.approvals.create({
            policyDecisionId: policyResult.id,
            originService: 'm-net',
            operationId: suspendedOp.id,
            requestedBy: actor,
            requiredAction: 'manual_review',
            quorumRequired: 1,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
          })

          // 审批创建失败：回滚并返回错误
          if (!approval.ok) {
            await deps.suspendedOps.transition(suspendedOp.id, 'resume_failed', 'approval creation failed')
            await deps.log?.writeFull('error', `approval creation failed for network ${params.id}`, suspendedOp.correlationId, { error: approval.error })
            return externalApiError(set, 503, 'approval.create_failed', approval.error.message)
          }

          // 转换状态为 enabling
          await deps.profileStore.setNetworkState(params.id, { profileVersion: state.profileVersion, status: 'enabling' })
          await deps.profileStore.recordTransition({
            networkId: params.id, fromVersion: state.profileVersion, toVersion: profileVersion,
            fromStatus: state.status, toStatus: 'enabling', actor, reason,
            policyDecisionId: policyResult.id, correlationId: suspendedOp.correlationId
          })

          await deps.events?.publish(
            'mnet.profile.enable.requested.v0',
            'mnet.profile.enable.requested',
            {
              networkId: params.id,
              fromProfileVersion: state.profileVersion,
              toProfileVersion: profileVersion,
              actor,
              policyDecisionId: policyResult.id,
              approvalId: approval.ok ? approval.value.approvalId : undefined,
              operationId: suspendedOp.id,
              correlationId: suspendedOp.correlationId,
              reason,
              controlPlaneOnly: true
            },
            suspendedOp.correlationId
          )
          await deps.log?.writeTimeline(`profile enable requested for network ${params.id}`, 'mnet.profile.enable.requested', suspendedOp.correlationId)
          await deps.log?.writeFull('info', `profile enable requested for network ${params.id}`, suspendedOp.correlationId, { profileVersion, operationId: suspendedOp.id })
          await deps.log?.writeAudit(actor, 'mnet.profile.enable.request', `network:${params.id}`, 'pending', suspendedOp.correlationId, { profileVersion, operationId: suspendedOp.id })

          return {
            status: 'pending_approval',
            operationId: suspendedOp.id,
            approvalId: approval.ok ? approval.value.approvalId : undefined,
            correlationId: suspendedOp.correlationId
          }
        } else {
          // DISABLE flow: immediate with M-Policy allow + Audit before execution

          // Already in default profile with disabled status → no-op
          if (state.profileVersion === profileVersion && state.status === 'disabled') {
            return externalApiError(set, 409, 'profile.not_enabled', 'network is already using default profile in disabled state')
          }

          const validation = canDisable(state.status as ProfileState)
          if (!validation) return externalApiError(set, 409, 'profile.disable.invalid_state', `cannot disable from ${state.status}`)

          const disableCorrelationId = crypto.randomUUID()

          // M-Policy authorization (fail-closed)
          if (!deps.policyAuthorize) {
            return externalApiError(set, 503, 'policy.unavailable', 'policy service is not available')
          }
          const disablePolicy = await deps.policyAuthorize.authorize(actor, 'network:profile-disable', `network:${params.id}`)
          if (disablePolicy.result !== 'allow') {
            return externalApiError(set, 403, 'policy.denied', `profile disable denied: ${disablePolicy.reasons.join(', ')}`)
          }

          // Audit before mutation per PHASE-13 §9
          await deps.log?.writeAudit(actor, 'mnet.profile.disable.request', `network:${params.id}`, 'allow', disableCorrelationId, { fromVersion: state.profileVersion, toVersion: profileVersion, policyDecisionId: disablePolicy.id })

          await deps.profileStore.setNetworkState(params.id, { profileVersion, status: 'disabled' })
          await deps.profileStore.recordTransition({
            networkId: params.id, fromVersion: state.profileVersion, toVersion: profileVersion,
            fromStatus: state.status, toStatus: 'disabled', actor, reason
          })
          await deps.networkUpdater?.setProfileVersion(params.id, profileVersion)
          await deps.events?.publish(
            'mnet.profile.disable.requested.v0',
            'mnet.profile.disable.requested',
            {
              networkId: params.id,
              fromProfileVersion: state.profileVersion,
              toProfileVersion: profileVersion,
              actor,
              policyDecisionId: disablePolicy.id,
              correlationId: disableCorrelationId,
              reason,
              controlPlaneOnly: true
            },
            disableCorrelationId
          )
          await deps.events?.publish(
            'mnet.profile.disabled.v0',
            'mnet.profile.disabled',
            {
              networkId: params.id,
              fromProfileVersion: state.profileVersion,
              toProfileVersion: profileVersion,
              actor,
              policyDecisionId: disablePolicy.id,
              correlationId: disableCorrelationId,
              reason,
              controlPlaneOnly: true
            },
            disableCorrelationId
          )
          await deps.log?.writeTimeline(`profile disabled for network ${params.id}`, 'mnet.profile.disabled', disableCorrelationId)
          await deps.log?.writeFull('info', `profile disabled for network ${params.id}`, disableCorrelationId, { profileVersion })
          await deps.log?.writeAudit(actor, 'mnet.profile.disable.success', `network:${params.id}`, 'success', disableCorrelationId, { profileVersion })

          return { status: 'disabled', profileVersion, correlationId: disableCorrelationId }
        }
      }, {
        params: t.Object({
          id: t.String({ minLength: 1 })
        }),
        body: t.Object({
          profileVersion: t.Union([t.Literal('m-net-cn@0.1.0'), t.Literal('m-net-default@0.1.0')]),
          reason: t.String({ minLength: 1 })
        })
      }))
}

export type MNetApp = ReturnType<typeof createMNetApp>
