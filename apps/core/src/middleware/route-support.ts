import {
  type CreateEventInput,
  createEventEnvelope
} from '../../../../packages/events/src/index.ts'
import { currentTraceId } from '../../../../packages/telemetry/src/index.ts'

/**
 * 内部服务错误码在 Core 侧收敛为稳定的 HTTP 状态码，避免不同入口出现分裂语义。
 */
export function statusCodeForServiceError(code: string): 403 | 404 | 409 | 503 {
  switch (code) {
    case 'policy.denied':
      return 403
    case 'approval.not_found':
    case 'profile.not_found':
    case 'network.not_found':
    case 'node.not_found':
    case 'task.not_found':
      return 404
    case 'approval.conflict':
    case 'approval.duplicate_vote':
    case 'approval.expired':
    case 'approval.not_pending':
    case 'approval.self_vote_denied':
    case 'profile.enable.invalid_state':
    case 'profile.disable.invalid_state':
    case 'profile.not_enabled':
    case 'network.conflict':
    case 'network.stem_required':
    case 'node.invalid_kind':
    case 'node.invalid_status':
    case 'node.unreachable':
    case 'node.credential_missing':
    case 'service.not_reloadable':
      return 409
    case 'service.not_found':
      return 404
    case 'mnet.unavailable':
    case 'm-policy.unavailable':
    case 'm-policy.invalid_response':
    case 'mnet.invalid_response':
    case 'nodeagent.unavailable':
    case 'nodeagent.invalid_token':
      return 503
    default:
      return 503
  }
}

/**
 * Core 发布事件时优先继承当前 traceId，保证 HTTP 请求、内部服务调用
 * 与异步事件在 OTel 和日志中可串联。
 */
export function tracedEvent(input: CreateEventInput) {
  const traceId = currentTraceId()
  return createEventEnvelope({
    ...input,
    ...(traceId ? { traceId } : {})
  })
}

/**
 * Join ingress 对外只暴露固定 session 路径；Core 在签发 ticket 时统一生成该公网 URL，
 * 避免 CLI、UI 或文档各自拼接出不同的入口地址。
 */
export function joinSessionUrl(publicUrl: string): string {
  const base = new URL(publicUrl)
  base.protocol = base.protocol === 'http:' ? 'ws:' : 'wss:'
  base.pathname = `${base.pathname.replace(/\/$/, '')}/join/v0/session`
  base.search = ''
  base.hash = ''
  return base.toString()
}
