import type { ActorId, Permission } from '../literals.ts'
import type { DependencyState } from './node-agent-runtime.ts'

// ReadyResponse 只报告当前 MVP 必需依赖，不把可选后端混进运行门禁。
export type CoreDependencyName = 'postgres' | 'nats' | 'm-policy' | 'm-log' | 'm-eventbus' | 'm-net'

export type CoreDependencies = Record<CoreDependencyName, DependencyState>

export type ApiError = {
  error: {
    code: string
    message: string
    correlationId?: string
  }
}

// 服务摘要用于 service list、reload 和运行态聚合，不等同于完整 service definition。
export type CoreMode = 'normal' | 'degraded' | 'safe'
export type ServiceDomain =
  | 'core'
  | 'm-net'
  | 'm-eventbus'
  | 'm-log'
  | 'm-policy'
  | 'm-task'
  | 'm-ui'
  | 'm-cli'
  | 'm-extension'
export type ServiceKind = 'core' | 'internal' | 'node' | 'task' | 'extension' | 'bff'
export type ServiceRuntimeMode = 'normal' | 'degraded'
export type ServiceLifecycle = {
  reloadable: boolean
  rollbackable: boolean
  degradable: boolean
}
export type ServiceRuntime = {
  liveness: boolean
  readiness: boolean
  mode: ServiceRuntimeMode
  lastError?: string
  lastReloadedAt?: string
}
export type ServiceSummary = {
  id: string
  version: string
  domain: ServiceDomain
  kind: ServiceKind
  lifecycle: ServiceLifecycle
  runtime?: ServiceRuntime
}

export type HealthResponse = {
  ok: true
  service: 'meristem-core'
  version: string
  uptimeMs: number
}

// SessionResponse 让 UI/BFF 在不调用 M-Policy 的前提下获取当前操作者身份和权限列表。
export type SessionResponse = {
  actor: ActorId
  permissions: Permission[]
}

export type IdentityActorStatus = 'active' | 'disabled'
export type IdentityTokenStatus = 'active' | 'revoked' | 'expired'

export interface IdentityActorV02 {
  readonly id: ActorId
  readonly displayName: string
  readonly status: IdentityActorStatus
  readonly createdAt: string
  readonly updatedAt: string
}

export interface ActorTokenV02 {
  readonly jti: string
  readonly actor: ActorId
  readonly issuer: 'meristem-local'
  readonly audience: 'meristem-core' | 'meristem-service'
  readonly issuedAt: string
  readonly expiresAt: string
  readonly issuedBy: ActorId
  readonly purpose: string
  readonly status: IdentityTokenStatus
  readonly revokedAt?: string
  readonly revokedBy?: ActorId
  readonly revokeReason?: string
}

export interface TokenIntrospectionResult {
  readonly active: boolean
  readonly actor?: ActorId
  readonly jti?: string
  readonly status?: IdentityTokenStatus
  readonly expiresAt?: string
}

// Ready 与 Health 明确分离：前者表示依赖可用性，后者只表示进程存活。
export type ReadyResponse = {
  ready: boolean
  dependencies: CoreDependencies
}

export type StatusResponse = {
  core: {
    id: string
    version: string
    mode: CoreMode
  }
  dependencies: ReadyResponse['dependencies']
  counts: {
    services: number
    nodes: number
    tasks: number
  }
}

export type ServiceListResponse = {
  services: ServiceSummary[]
}

export type ServiceReloadRequest = {
  reason?: string
}

export type ServiceReloadResponse = {
  serviceId: string
  accepted: true
  reloadedAt: string
  policyDecisionId: string
  correlationId: string
}
