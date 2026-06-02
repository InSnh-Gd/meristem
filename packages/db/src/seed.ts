import { createSqlClient } from './client.ts'
import { approvalPermissions, extensionPermissions, projectionPermissions } from '../../contracts/src/index.ts'

// 种子数据固定 MVP 的最小用户、角色和权限矩阵，避免本地演示链路再做手工初始化。
const sql = createSqlClient()
const now = new Date()

const users = [
  ['viewer', 'Viewer'],
  ['operator', 'Operator'],
  ['admin', 'Admin'],
  ['security-admin', 'Security Admin']
] as const

const roles = [
  ['viewer', 'read-only operational visibility'],
  ['operator', 'routine operations'],
  ['admin', 'privileged administration'],
  ['security-admin', 'audit and secret governance']
] as const

const permissions = [
  ['core:read', 'read core status'],
  ['node:register', 'register stem and leaf nodes'],
  ['node:issue-token', 'issue node agent tokens'],
  ['task:read', 'read task state'],
  ['task:submit', 'submit noop tasks'],
  ['task:cancel', 'cancel tasks'],
  ['task:retry', 'retry tasks'],
  ['task:manage', 'manage task definitions'],
  ['timeline:read', 'read timeline log'],
  ['log:read-full', 'read full log'],
  ['audit:read', 'read audit log'],
  ['service:register', 'register service definitions'],
  ['service:reload', 'reload internal services'],
  ['network:read', 'read logical network state'],
  ['network:create', 'create logical networks'],
  ['network:join', 'join nodes to logical networks'],
  ['policy:approval-read', 'read pending approvals'],
  ['policy:approval-approve', 'approve pending operations'],
  ['policy:approval-reject', 'reject pending operations'],
  ['policy:approval-manage', 'manage approval records'],
  ['network:profile-read', 'read network regional profile definitions and state'],
  ['network:profile-enable', 'enable network regional profile for a network'],
  ['network:profile-disable', 'disable network regional profile for a network'],
  ['extension:read', 'read extension definitions and system/default instances'],
  ['extension:register', 'register control-plane extension manifests'],
  ['extension:enable', 'enable system/default extension instances'],
  ['extension:disable', 'disable system/default extension instances'],
  ['projection:read', 'read projection health and DLQ state'],
  ['projection:backfill', 'execute projection backfills'],
  ['projection:dlq-manage', 'replay or skip projection DLQ records']
] as const

const rolePermissions: Record<string, readonly string[]> = {
  viewer: ['core:read', 'timeline:read', 'network:read', 'extension:read'],
  operator: ['core:read', 'node:register', 'node:issue-token', 'task:read', 'task:submit', 'task:cancel', 'task:retry', 'timeline:read', 'log:read-full', 'service:reload', 'network:read', 'network:create', 'network:join', 'network:profile-read', 'projection:read', 'extension:read'],
  admin: ['core:read', 'node:register', 'node:issue-token', 'task:read', 'task:submit', 'task:cancel', 'task:retry', 'task:manage', 'timeline:read', 'log:read-full', 'service:register', 'service:reload', 'network:read', 'network:create', 'network:join', 'network:profile-read', 'network:profile-enable', 'network:profile-disable', 'policy:approval-read', ...projectionPermissions, ...extensionPermissions],
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
    'network:profile-read',
    'network:profile-enable',
    'network:profile-disable',
    ...approvalPermissions,
    ...extensionPermissions,
    ...projectionPermissions
  ]
}

await sql.begin(async (tx) => {
  // 移除 task:assign；先清理历史 seed 残留，避免会话权限返回无效字面量。
  await tx`delete from role_permissions where permission_id = 'task:assign'`
  await tx`delete from permissions where id = 'task:assign'`

  // 用户、角色、权限三类基础数据分别 upsert，保证反复 seed 仍是幂等操作。
  for (const [id, displayName] of users) {
    await tx`
      insert into users (id, display_name, created_at)
      values (${id}, ${displayName}, ${now})
      on conflict (id) do update set display_name = excluded.display_name
    `
  }

  for (const [id, description] of roles) {
    await tx`
      insert into roles (id, description)
      values (${id}, ${description})
      on conflict (id) do update set description = excluded.description
    `
  }

  for (const [id, description] of permissions) {
    await tx`
      insert into permissions (id, description)
      values (${id}, ${description})
      on conflict (id) do update set description = excluded.description
    `
  }

  for (const [userId] of users) {
    await tx`
      insert into user_roles (user_id, role_id)
      values (${userId}, ${userId})
      on conflict do nothing
    `
  }

  // 角色授权矩阵是 RBAC 的权威基础，测试与 CLI token 都依赖这里的初始状态。
  for (const [roleId, grantedPermissions] of Object.entries(rolePermissions)) {
    for (const permissionId of grantedPermissions) {
      await tx`
        insert into role_permissions (role_id, permission_id)
        values (${roleId}, ${permissionId})
        on conflict do nothing
      `
    }
  }

  // Seed identity actors for v0.2 token lifecycle
  for (const [id, displayName] of users) {
    await tx`
      insert into actors (id, display_name, status, created_at, updated_at)
      values (${id}, ${displayName}, 'active', ${now}, ${now})
      on conflict (id) do update set
        display_name = excluded.display_name,
        status = excluded.status,
        updated_at = excluded.updated_at
    `
  }

  // M-Task 默认只开放 noop 定义；更多任务类型必须显式扩展定义和风险语义。
  await tx`
    insert into task_definitions (id, type, version, description, danger_level, default_timeout_seconds, created_at, updated_at)
    values ('task-definition-noop-v0', 'noop', 'v0', 'M-Task noop task', 'medium', 30, ${now}, ${now})
    on conflict (id) do update set
      description = excluded.description,
      danger_level = excluded.danger_level,
      default_timeout_seconds = excluded.default_timeout_seconds,
      updated_at = excluded.updated_at
  `

  await tx`
    insert into mnet_profile_definitions (id, profile_version, region, schema_version, definition, status, created_at, updated_at)
    values (
      'mnet-profile-definition-default-v0-1-0',
      'm-net-default@0.1.0',
      'global',
      'mnet-profile@0.1.0',
      ${JSON.stringify({
        profileVersion: 'm-net-default@0.1.0',
        region: 'global',
        displayName: 'M-Net Default',
        schemaVersion: 'mnet-profile@0.1.0',
        status: 'available',
        rules: {
          defaultInterconnect: { mode: 'placeholder' }
        },
        capabilities: {
          realDerpRelay: false,
          realTcpInterconnect: false,
          realUdpPathSwitching: false,
          controlPlaneOnly: false
        }
      })}::jsonb,
      'available',
      ${now},
      ${now}
    )
    on conflict (id) do update set
      profile_version = excluded.profile_version,
      region = excluded.region,
      schema_version = excluded.schema_version,
      definition = excluded.definition,
      status = excluded.status,
      updated_at = excluded.updated_at
  `

  await tx`
    insert into mnet_profile_definitions (id, profile_version, region, schema_version, definition, status, created_at, updated_at)
    values (
      'mnet-profile-definition-cn-v0-1-0',
      'm-net-cn@0.1.0',
      'cn',
      'mnet-profile@0.1.0',
      ${JSON.stringify({
        profileVersion: 'm-net-cn@0.1.0',
        region: 'cn',
        displayName: 'M-Net CN',
        schemaVersion: 'mnet-profile@0.1.0',
        status: 'available',
        rules: {
          mainlandNodeWithoutPublicAccess: { interconnect: 'tcp_required' },
          asianStemToCore: { interconnect: 'tcp_required' },
          asianStemDerp: { allowed: true, mode: 'placeholder' },
          publicDerpFallback: { configurable: true, defaultEnabled: false }
        },
        capabilities: {
          realDerpRelay: false,
          realTcpInterconnect: false,
          realUdpPathSwitching: false,
          controlPlaneOnly: true
        }
      })}::jsonb,
      'available',
      ${now},
      ${now}
    )
    on conflict (id) do update set
      profile_version = excluded.profile_version,
      region = excluded.region,
      schema_version = excluded.schema_version,
      definition = excluded.definition,
      status = excluded.status,
      updated_at = excluded.updated_at
  `
})

await sql.end()
console.log('MVP seed data written')
