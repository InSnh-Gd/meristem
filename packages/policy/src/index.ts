import type { ActorId, Permission, PolicyDecision, PolicyResult } from '../../contracts/src/index.ts'

export type PolicyInput = {
  actor: ActorId
  action: Permission
  permissions: readonly Permission[]
  resource?: string
}

export type PolicyDecisionDraft = Omit<PolicyDecision, 'id' | 'createdAt'>

export const rolePermissions: Record<ActorId, readonly Permission[]> = {
  viewer: ['core:read', 'timeline:read', 'network:read'],
  operator: ['core:read', 'node:register', 'task:assign', 'timeline:read', 'log:read-full', 'network:read', 'network:create', 'network:join'],
  admin: ['core:read', 'node:register', 'task:assign', 'timeline:read', 'log:read-full', 'service:register', 'network:read', 'network:create', 'network:join'],
  'security-admin': [
    'core:read',
    'node:register',
    'task:assign',
    'timeline:read',
    'log:read-full',
    'audit:read',
    'service:register',
    'network:read',
    'network:create',
    'network:join'
  ]
}

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
