import { projectionPermissions } from '../../contracts/src/index.ts'
import type { ActorId, Permission, PolicyDecision, PolicyResult } from '../../contracts/src/index.ts'

// PolicyInput 保持纯数据形状，让 RBAC 决策函数可以脱离数据库和 HTTP 边界独立复用。
export type PolicyInput = {
  actor: ActorId
  action: Permission
  permissions: readonly Permission[]
  resource?: string
}

export type PolicyDecisionDraft = Omit<PolicyDecision, 'id' | 'createdAt'>

// 角色权限矩阵作为最小 RBAC 默认值存在，真实权威表仍在 PostgreSQL seed 中。
export const rolePermissions: Record<ActorId, readonly Permission[]> = {
  viewer: ['core:read', 'timeline:read', 'network:read'],
  operator: ['core:read', 'node:register', 'node:issue-token', 'task:read', 'task:submit', 'task:cancel', 'task:retry', 'timeline:read', 'log:read-full', 'service:reload', 'network:read', 'network:create', 'network:join', 'projection:read'],
  admin: ['core:read', 'node:register', 'node:issue-token', 'task:read', 'task:submit', 'task:cancel', 'task:retry', 'task:manage', 'timeline:read', 'log:read-full', 'service:register', 'service:reload', 'network:read', 'network:create', 'network:join', ...projectionPermissions],
  'security-admin': [
    'core:read',
    'node:register',
    'node:issue-token',
    'task:read',
    'task:submit',
    'task:cancel',
    'task:retry',
    'task:manage',
    'timeline:read',
    'log:read-full',
    'audit:read',
    'service:register',
    'service:reload',
    'network:read',
    'network:create',
    'network:join',
    ...projectionPermissions
  ]
}

/**
 * decidePermission 只根据传入权限集合做纯函数决策，不读环境变量、不碰数据库、也不写日志。
 */
export function decidePermission(input: PolicyInput): PolicyDecisionDraft {
  const hasPermission = input.permissions.includes(input.action)
  const result: PolicyResult = hasPermission ? 'allow' : 'deny'
  return {
    actor: input.actor,
    action: input.action,
    resource: input.resource ?? input.action,
    result,
    reasons: hasPermission ? ['permission_present'] : [`missing_permission:${input.action}`]
  }
}
