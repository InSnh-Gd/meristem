import { jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
})

export const roles = pgTable('roles', {
  id: text('id').primaryKey(),
  description: text('description').notNull()
})

export const permissions = pgTable('permissions', {
  id: text('id').primaryKey(),
  description: text('description').notNull()
})

export const userRoles = pgTable(
  'user_roles',
  {
    userId: text('user_id').notNull().references(() => users.id),
    roleId: text('role_id').notNull().references(() => roles.id)
  },
  (table) => [primaryKey({ columns: [table.userId, table.roleId] })]
)

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: text('role_id').notNull().references(() => roles.id),
    permissionId: text('permission_id').notNull().references(() => permissions.id)
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionId] })]
)

export const nodes = pgTable('nodes', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull(),
  capabilities: jsonb('capabilities').notNull(),
  scope: jsonb('scope').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
})

export const serviceDefinitions = pgTable('service_definitions', {
  id: text('id').primaryKey(),
  version: text('version').notNull(),
  domain: text('domain').notNull(),
  kind: text('kind').notNull(),
  definition: jsonb('definition').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
})

export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(),
  leafNodeId: text('leaf_node_id').notNull().references(() => nodes.id),
  type: text('type').notNull(),
  status: text('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true })
})

export const networks = pgTable(
  'networks',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    profileVersion: text('profile_version').notNull(),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  (table) => [uniqueIndex('networks_name_unique').on(table.name)]
)

export const networkMemberships = pgTable(
  'network_memberships',
  {
    networkId: text('network_id').notNull().references(() => networks.id),
    nodeId: text('node_id').notNull().references(() => nodes.id),
    membershipMode: text('membership_mode').notNull(),
    status: text('status').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  (table) => [primaryKey({ columns: [table.networkId, table.nodeId] })]
)

export const policyDecisions = pgTable('policy_decisions', {
  id: text('id').primaryKey(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  resource: text('resource').notNull(),
  result: text('result').notNull(),
  reasons: jsonb('reasons').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
})

export const timelineLogs = pgTable('timeline_logs', {
  id: text('id').primaryKey(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  summary: text('summary').notNull(),
  subject: text('subject'),
  correlationId: text('correlation_id')
})

export const fullLogs = pgTable('full_logs', {
  id: text('id').primaryKey(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  level: text('level').notNull(),
  source: text('source').notNull(),
  message: text('message').notNull(),
  correlationId: text('correlation_id'),
  traceId: text('trace_id'),
  payload: jsonb('payload')
})

export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  resource: text('resource').notNull(),
  decisionId: text('decision_id').references(() => policyDecisions.id),
  result: text('result').notNull(),
  correlationId: text('correlation_id'),
  traceId: text('trace_id'),
  payload: jsonb('payload')
})
