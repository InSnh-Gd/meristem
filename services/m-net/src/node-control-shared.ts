import type { MNetAppDeps } from './deps.ts'
import type { NodeControlStore } from './node-control-store.ts'

type NodeControlPolicyAuthorize = NonNullable<MNetAppDeps['policyAuthorize']>
type NodeControlEvents = NonNullable<MNetAppDeps['events']>
type NodeControlLog = NonNullable<MNetAppDeps['log']>

export type NodeControlFailure = {
  kind: 'failure'
  status: 403 | 404 | 409 | 503
  error: { code: string; message: string }
}

export type NodeControlDeps = {
  store: NodeControlStore
  policyAuthorize: NodeControlPolicyAuthorize
  events?: NodeControlEvents
  log?: NodeControlLog
}

export function isNodeControlFailure(value: unknown): value is NodeControlFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    // 运行时类型守卫：'kind' in value 之后 TS 仍无法收窄属性类型，需要显式断言读取字段。
    (value as { kind?: string }).kind === 'failure'
  )
}

export function nodeControlFailure(
  status: NodeControlFailure['status'],
  code: string,
  message: string
): NodeControlFailure {
  return { kind: 'failure', status, error: { code, message } }
}
