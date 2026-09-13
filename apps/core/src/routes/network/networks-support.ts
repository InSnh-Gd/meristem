import type { ActorId, PolicyDecision } from '../../../../../packages/contracts/src/index.ts'
import { CoreError } from '../../core-error.ts'
import { authorize, requireActor } from '../../middleware/auth.ts'
import { statusCodeForServiceError } from '../../middleware/route-support.ts'
import type { CoreDeps } from '../../types.ts'

/**
 * Core 网络路由的授权、审计与 Timeline 编排。
 *
 * ADR-N05 之后网络生命周期事件由 M-Net 在变更事务内以 outbox 发布，Core 不再内联
 * `events.publish`：审计仍是授权边界（变更前 fail-closed），Timeline 是操作者视角的投影辅助
 * 事实（变更后写，失败降级为告警）。
 */

type NetworkMutationAuth = Awaited<ReturnType<typeof requireActor>> & { permission: PolicyDecision }

export async function requireNetworkReadAccess(
  deps: CoreDeps,
  headers: Record<string, string | undefined>,
  resource: string
) {
  const auth = await requireActor(deps, headers)
  await authorize(deps, {
    actor: auth.actor,
    action: 'network:read',
    resource,
    correlationId: auth.correlationId
  })
  return auth
}

export async function requireNetworkMutationAccess(
  deps: CoreDeps,
  input: {
    headers: Record<string, string | undefined>
    action: 'network:create' | 'network:join' | 'network:delete'
    resource: string
  }
): Promise<NetworkMutationAuth> {
  const auth = await requireActor(deps, input.headers)
  const permission = await authorize(deps, {
    actor: auth.actor,
    action: input.action,
    resource: input.resource,
    correlationId: auth.correlationId
  })
  return { ...auth, permission }
}

export async function writeNetworkAuditOrThrow(
  deps: CoreDeps,
  input: {
    actor: ActorId
    action: 'network:create' | 'network:join' | 'network:delete'
    resource: string
    permission: PolicyDecision
    correlationId: string
  }
) {
  const audit = await deps.log.writeAudit({
    actor: input.actor,
    action: input.action,
    resource: input.resource,
    decisionId: input.permission.id,
    result: input.permission.result,
    correlationId: input.correlationId
  })
  if (!audit.ok) {
    throw new CoreError(503, audit.error.code, audit.error.message, input.correlationId)
  }
}

export function unwrapNetworkResult<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } },
  correlationId: string
): T {
  if (!result.ok) {
    throw new CoreError(
      statusCodeForServiceError(result.error.code),
      result.error.code,
      result.error.message,
      correlationId
    )
  }
  return result.value
}

/**
 * 写网络变更的操作者 Timeline。事件发布已移交 M-Net（ADR-N05），Timeline 写失败只降级为
 * 告警：权威变更已提交，不能把投影辅助事实的失败翻成错误响应。
 */
export async function writeNetworkTimeline(
  deps: CoreDeps,
  timeline: Parameters<CoreDeps['log']['writeTimeline']>[0],
  correlationId: string
) {
  const written = await deps.log.writeTimeline(timeline)
  if (!written.ok) {
    process.stderr.write(`core timeline write failed: ${written.error.message} ${correlationId}\n`)
  }
}

export async function writeNetworkCreatedTimeline(
  deps: CoreDeps,
  created: { id: string; name: string },
  correlationId: string
) {
  await writeNetworkTimeline(
    deps,
    {
      summary: `created network ${created.name}`,
      subject: created.id,
      correlationId
    },
    correlationId
  )
}

export async function writeNetworkJoinedTimeline(
  deps: CoreDeps,
  member: { networkId: string; nodeId: string },
  correlationId: string
) {
  await writeNetworkTimeline(
    deps,
    {
      summary: `joined node ${member.nodeId} to network ${member.networkId}`,
      subject: member.networkId,
      correlationId
    },
    correlationId
  )
}

export async function writeNetworkDeletedTimeline(
  deps: CoreDeps,
  deleted: { networkId: string },
  correlationId: string
) {
  await writeNetworkTimeline(
    deps,
    {
      summary: `deleted network ${deleted.networkId}`,
      subject: deleted.networkId,
      correlationId
    },
    correlationId
  )
}

export async function writeNetworkMemberRemovedTimeline(
  deps: CoreDeps,
  removed: { networkId: string; nodeId: string },
  correlationId: string
) {
  await writeNetworkTimeline(
    deps,
    {
      summary: `removed node ${removed.nodeId} from network ${removed.networkId}`,
      subject: removed.networkId,
      correlationId
    },
    correlationId
  )
}
