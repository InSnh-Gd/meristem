// Shared security-sensitive literals come from the Effect projection hardening plan.
// Source: docs/plans/2026-05-23-effect-projection-hardening.md §2.2-2.3
export const actorIds = ['viewer', 'operator', 'admin', 'security-admin'] as const

export type ActorId = typeof actorIds[number]

export const basePermissions = [
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
  'network:join'
] as const

export const projectionPermissions = [
  'projection:read',
  'projection:backfill',
  'projection:dlq-manage'
] as const

// Phase 12: 审批流程权限，M-Policy 外部审批 API 专用。
export const approvalPermissions = [
  'policy:approval-read',
  'policy:approval-approve',
  'policy:approval-reject',
  'policy:approval-manage'
] as const

export const permissions = [...basePermissions, ...projectionPermissions, ...approvalPermissions] as const

export type Permission = typeof permissions[number]
