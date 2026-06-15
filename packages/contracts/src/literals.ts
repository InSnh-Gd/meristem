// 安全敏感字面量由契约包统一导出，避免权限、角色和状态字符串在服务间漂移。
export const actorIds = ['viewer', 'operator', 'admin', 'security-admin'] as const

export type ActorId = (typeof actorIds)[number]

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

// 审批流程权限，M-Policy 外部审批 API 专用。
export const approvalPermissions = [
  'policy:approval-read',
  'policy:approval-approve',
  'policy:approval-reject',
  'policy:approval-manage'
] as const

export const networkProfilePermissions = [
  'network:profile-read',
  'network:profile-enable',
  'network:profile-disable'
] as const

export const extensionPermissions = [
  'extension:read',
  'extension:register',
  'extension:enable',
  'extension:disable'
] as const

export const extensionPermission = {
  read: extensionPermissions[0],
  register: extensionPermissions[1],
  enable: extensionPermissions[2],
  disable: extensionPermissions[3]
} as const

export const identityPermissions = [
  'identity:read',
  'identity:token-issue',
  'identity:token-revoke',
  'identity:token-inspect'
] as const

export const secretPermissions = [
  'secret:read-metadata',
  'secret:create',
  'secret:rotate',
  'secret:disable',
  'secret:reference'
] as const

export const configPermissions = [
  'config:read',
  'config:draft',
  'config:validate',
  'config:publish',
  'config:rollback'
] as const

export const permissions = [
  ...basePermissions,
  ...projectionPermissions,
  ...approvalPermissions,
  ...networkProfilePermissions,
  ...extensionPermissions,
  ...identityPermissions,
  ...secretPermissions,
  ...configPermissions
] as const

export type Permission = (typeof permissions)[number]
