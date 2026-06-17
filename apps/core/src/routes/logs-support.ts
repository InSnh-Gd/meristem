import type {
  AuditSearchQuery,
  FullLogSearchQuery,
  Permission,
  TimelineSearchQuery
} from '../../../../packages/contracts/src/index.ts'
import { CoreError } from '../core-error.ts'
import { authorize, requireActor } from '../middleware/auth.ts'
import type { CoreDeps, ServiceError } from '../types.ts'

/**
 * 日志读取统一走显式鉴权，避免控制面路由各自重复拼装 actor / correlationId。
 */
export async function requireLogAccess(
  deps: CoreDeps,
  input: {
    headers: Record<string, string | undefined>
    action: Permission
    resource: string
  }
) {
  const auth = await requireActor(deps, input.headers)
  await authorize(deps, {
    actor: auth.actor,
    action: input.action,
    resource: input.resource,
    correlationId: auth.correlationId
  })
  return auth
}

/**
 * Timeline / Full / Audit 读操作统一把后端失败映射为 503，保持只读排障入口的错误语义一致。
 */
export function unwrapLogResult<T>(
  result: { ok: true; value: T } | { ok: false; error: ServiceError },
  correlationId: string
): T {
  if (!result.ok) {
    throw new CoreError(503, result.error.code, result.error.message, correlationId)
  }
  return result.value
}

/**
 * Timeline 搜索入参在路由层已经过 schema 校验，这里只负责剔除空字段并收敛为端口查询对象。
 */
export function toTimelineSearchQuery(query: {
  q?: string
  from?: string
  to?: string
  limit?: number
  subject?: string
  correlationId?: string
}): TimelineSearchQuery {
  return {
    ...(query.q ? { q: query.q } : {}),
    ...(query.from ? { from: query.from } : {}),
    ...(query.to ? { to: query.to } : {}),
    ...(query.limit !== undefined ? { limit: Number(query.limit) } : {}),
    ...(query.subject ? { subject: query.subject } : {}),
    ...(query.correlationId ? { correlationId: query.correlationId } : {})
  }
}

/**
 * Full log 搜索允许 level/source/traceId 组合过滤，helper 保持路由主体只做编排。
 */
export function toFullLogSearchQuery(query: {
  q?: string
  from?: string
  to?: string
  limit?: number
  level?: 'debug' | 'info' | 'warn' | 'error'
  source?: string
  correlationId?: string
  traceId?: string
}): FullLogSearchQuery {
  return {
    ...(query.q ? { q: query.q } : {}),
    ...(query.from ? { from: query.from } : {}),
    ...(query.to ? { to: query.to } : {}),
    ...(query.limit !== undefined ? { limit: Number(query.limit) } : {}),
    ...(query.level ? { level: query.level } : {}),
    ...(query.source ? { source: query.source } : {}),
    ...(query.correlationId ? { correlationId: query.correlationId } : {}),
    ...(query.traceId ? { traceId: query.traceId } : {})
  }
}

/**
 * Audit 搜索支持 actor/action/resource/decisionId 组合过滤，保持查询拼装与 handler 分离。
 */
export function toAuditSearchQuery(query: {
  q?: string
  from?: string
  to?: string
  limit?: number
  actor?: string
  action?: string
  resource?: string
  decisionId?: string
  correlationId?: string
}): AuditSearchQuery {
  return {
    ...(query.q ? { q: query.q } : {}),
    ...(query.from ? { from: query.from } : {}),
    ...(query.to ? { to: query.to } : {}),
    ...(query.limit !== undefined ? { limit: Number(query.limit) } : {}),
    ...(query.actor ? { actor: query.actor } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(query.resource ? { resource: query.resource } : {}),
    ...(query.decisionId ? { decisionId: query.decisionId } : {}),
    ...(query.correlationId ? { correlationId: query.correlationId } : {})
  }
}
