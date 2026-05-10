import { jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

// PostgreSQL schema 是 MVP 权威写模型；事件、日志和缓存都不能替代这些表的职责。
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

// nodes 保存控制面理解的统一节点事实，既包含 simulated 节点也包含真实 agent 节点。
export const nodes = pgTable('nodes', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  mode: text('mode').notNull(),
  status: text('status').notNull(),
  reachability: text('reachability').notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  agentVersion: text('agent_version'),
  capabilities: jsonb('capabilities').notNull(),
  scope: jsonb('scope').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
})

// node_credentials 只存 token 哈希和生命周期元数据，绝不保存节点 token 明文。
export const nodeCredentials = pgTable('node_credentials', {
  id: text('id').primaryKey(),
  nodeId: text('node_id').notNull().references(() => nodes.id),
  tokenHash: text('token_hash').notNull(),
  status: text('status').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true })
})

// node_join_tickets 是一次性加入凭据的权威表；M-Net 只能兑换 active 且未过期的 ticket。
export const nodeJoinTickets = pgTable('node_join_tickets', {
  id: text('id').primaryKey(),
  ticketHash: text('ticket_hash').notNull(),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  capabilities: jsonb('capabilities').notNull(),
  status: text('status').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
  redeemedNodeId: text('redeemed_node_id').references(() => nodes.id)
})

// service_definitions 当前主要承载内建服务与生命周期原型所需的最小元数据。
export const serviceDefinitions = pgTable('service_definitions', {
  id: text('id').primaryKey(),
  version: text('version').notNull(),
  domain: text('domain').notNull(),
  kind: text('kind').notNull(),
  definition: jsonb('definition').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
})

// tasks 仍保持最小 MVP 形状，避免在 agent 原型阶段提前引入复杂调度状态机。
export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(),
  leafNodeId: text('leaf_node_id').notNull().references(() => nodes.id),
  type: text('type').notNull(),
  status: text('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true })
})

// 逻辑网络表只表达网络和成员归属，不表达链路、带宽或实际传输路径。
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

// policy_decisions、timeline/full/audit logs 分别对应授权事实与三级日志事实。
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
