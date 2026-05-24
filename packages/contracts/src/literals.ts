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

export const permissions = [...basePermissions, ...projectionPermissions] as const

export type Permission = typeof permissions[number]
