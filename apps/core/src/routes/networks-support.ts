import type { ActorId, PolicyDecision } from '../../../../packages/contracts/src/index.ts'
import { CoreError } from '../core-error.ts'
import { authorize, requireActor } from '../middleware/auth.ts'
import { statusCodeForServiceError, tracedEvent } from '../middleware/route-support.ts'
import type { CoreDeps } from '../types.ts'

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
 * 删除路径专用的幂等解包：mnet.network.deleted.v0 是 at-least-once 语义，
 * 「删除已提交但事件发布失败」后的重试必须仍能补发事件，因此 M-Net 的
 * network.not_found（行从未存在或已被并发/重试删除）在 DELETE 上收敛为
 * 幂等成功，由调用方照常发布删除事件与 Timeline。
 */
export function unwrapNetworkDeleteResult(
  result:
    | { ok: true; value: { networkId: string } }
    | { ok: false; error: { code: string; message: string } },
  networkId: string,
  correlationId: string
): { networkId: string; absent: boolean } {
  if (result.ok) return { networkId: result.value.networkId, absent: false }
  if (result.error.code !== 'network.not_found') {
    throw new CoreError(
      statusCodeForServiceError(result.error.code),
      result.error.code,
      result.error.message,
      correlationId
    )
  }
  return { networkId, absent: true }
}

/**
 * 网络写路径的事件发布核验出口：SECURITY-MODEL「Event-bus publish failure must surface a
 * typed unavailable outcome and must not create false success」——发布失败必须显式 503，
 * 让客户端重试（幂等 DELETE 补发）路径可达。发布调用点保持内联字面量 subject，
 * 以满足 schema-coverage 漂移守卫对发布者归属的静态识别。
 * Timeline 是投影辅助事实，写失败降级为告警，不把已提交变更翻成错误。
 */
async function ensureNetworkEventPublished(
  deps: CoreDeps,
  published: Awaited<ReturnType<CoreDeps['events']['publish']>>,
  timeline: Parameters<CoreDeps['log']['writeTimeline']>[0],
  correlationId: string
) {
  if (!published.ok) {
    throw new CoreError(503, published.error.code, published.error.message, correlationId)
  }
  const written = await deps.log.writeTimeline(timeline)
  if (!written.ok) {
    process.stderr.write(`core timeline write failed: ${written.error.message} ${correlationId}\n`)
  }
}

export async function publishNetworkCreatedArtifacts(
  deps: CoreDeps,
  created: { id: string; name: string; profileVersion: string },
  correlationId: string
) {
  const published = await deps.events.publish(
    'mnet.network.created.v0',
    tracedEvent({
      type: 'mnet.network.created',
      source: 'meristem-core',
      payload: {
        networkId: created.id,
        name: created.name,
        profileVersion: created.profileVersion
      },
      correlationId
    })
  )
  await ensureNetworkEventPublished(
    deps,
    published,
    {
      summary: `created network ${created.name}`,
      subject: created.id,
      correlationId
    },
    correlationId
  )
}

export async function publishNetworkJoinedArtifacts(
  deps: CoreDeps,
  member: {
    networkId: string
    nodeId: string
    nodeKind: string
    membershipMode: string
  },
  correlationId: string
) {
  const published = await deps.events.publish(
    'mnet.membership.joined.v0',
    tracedEvent({
      type: 'mnet.membership.joined',
      source: 'meristem-core',
      payload: {
        networkId: member.networkId,
        nodeId: member.nodeId,
        nodeKind: member.nodeKind,
        membershipMode: member.membershipMode
      },
      correlationId
    })
  )
  await ensureNetworkEventPublished(
    deps,
    published,
    {
      summary: `joined node ${member.nodeId} to network ${member.networkId}`,
      subject: member.networkId,
      correlationId
    },
    correlationId
  )
}

/**
 * 网络删除/成员移除后发布对应事件并写 Timeline，保持与创建路径对称的审计链路。
 * absent=true 表示幂等重放（网络已不存在，本次为补发）：事件带 replayed 标记，
 * Timeline 文案显式区分，让操作者的重试有可审计的痕迹。
 */
export async function publishNetworkDeletedArtifacts(
  deps: CoreDeps,
  deleted: { networkId: string },
  correlationId: string,
  absent = false
) {
  const published = await deps.events.publish(
    'mnet.network.deleted.v0',
    tracedEvent({
      type: 'mnet.network.deleted',
      source: 'meristem-core',
      payload: { networkId: deleted.networkId, ...(absent ? { replayed: true } : {}) },
      correlationId
    })
  )
  await ensureNetworkEventPublished(
    deps,
    published,
    {
      summary: absent
        ? `deleted network ${deleted.networkId} (already absent, deletion event replayed)`
        : `deleted network ${deleted.networkId}`,
      subject: deleted.networkId,
      correlationId
    },
    correlationId
  )
}

export async function publishNetworkMemberRemovedArtifacts(
  deps: CoreDeps,
  removed: { networkId: string; nodeId: string },
  correlationId: string
) {
  const published = await deps.events.publish(
    'mnet.membership.removed.v0',
    tracedEvent({
      type: 'mnet.membership.removed',
      source: 'meristem-core',
      payload: { networkId: removed.networkId, nodeId: removed.nodeId },
      correlationId
    })
  )
  await ensureNetworkEventPublished(
    deps,
    published,
    {
      summary: `removed node ${removed.nodeId} from network ${removed.networkId}`,
      subject: removed.networkId,
      correlationId
    },
    correlationId
  )
}
