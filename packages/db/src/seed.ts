import { createSqlClient } from './client.ts'

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
  ['task:assign', 'assign noop tasks'],
  ['timeline:read', 'read timeline log'],
  ['log:read-full', 'read full log'],
  ['audit:read', 'read audit log'],
  ['service:register', 'register service definitions'],
  ['network:read', 'read logical network state'],
  ['network:create', 'create logical networks'],
  ['network:join', 'join nodes to logical networks']
] as const

const rolePermissions: Record<string, readonly string[]> = {
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

await sql.begin(async (tx) => {
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

  for (const [roleId, grantedPermissions] of Object.entries(rolePermissions)) {
    for (const permissionId of grantedPermissions) {
      await tx`
        insert into role_permissions (role_id, permission_id)
        values (${roleId}, ${permissionId})
        on conflict do nothing
      `
    }
  }
})

await sql.end()
console.log('MVP seed data written')
