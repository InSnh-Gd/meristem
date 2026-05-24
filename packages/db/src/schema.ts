import { integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

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

// tasks 是 Phase 11 前 Core-owned MVP 路径的历史兼容表；canonical task state 由 M-Task 表组持有。
export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(),
  leafNodeId: text('leaf_node_id').notNull().references(() => nodes.id),
  type: text('type').notNull(),
  status: text('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true })
})

export const nodesRelations = relations(nodes, ({ many }) => ({
  tasks: many(tasks),
}))

export const tasksRelations = relations(tasks, ({ one }) => ({
  node: one(nodes, { fields: [tasks.leafNodeId], references: [nodes.id] }),
}))

// M-Task 表组是 Phase 11 后任务生命周期的权威写模型，不再由 Core tasks 表承载 canonical state。
export const taskDefinitions = pgTable('task_definitions', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  version: text('version').notNull(),
  description: text('description').notNull(),
  dangerLevel: text('danger_level').notNull(),
  defaultTimeoutSeconds: integer('default_timeout_seconds').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
})

export const taskRequests = pgTable('task_requests', {
  id: text('id').primaryKey(),
  definitionId: text('definition_id').notNull().references(() => taskDefinitions.id),
  nodeId: text('node_id').notNull().references(() => nodes.id),
  type: text('type').notNull(),
  status: text('status').notNull(),
  requestedBy: text('requested_by').notNull(),
  policyDecisionId: text('policy_decision_id').references(() => policyDecisions.id),
  correlationId: text('correlation_id'),
  risk: jsonb('risk').notNull(),
  timeoutAt: timestamp('timeout_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  canceledAt: timestamp('canceled_at', { withTimezone: true })
})

export const taskTransitions = pgTable('task_transitions', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => taskRequests.id),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  reason: text('reason'),
  correlationId: text('correlation_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
})

export const taskResults = pgTable('task_results', {
  taskId: text('task_id').primaryKey().references(() => taskRequests.id),
  status: text('status').notNull(),
  payload: jsonb('payload'),
  error: text('error'),
  completedAt: timestamp('completed_at', { withTimezone: true }).notNull()
})

export const taskCancellations = pgTable('task_cancellations', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => taskRequests.id),
  requestedBy: text('requested_by').notNull(),
  status: text('status').notNull(),
  correlationId: text('correlation_id'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
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

// Phase 10.1 Projection Platform 表：projector_jobs 记录投影作业生命周期
// 来源：docs/roadmap/PHASE-10.1.md §2.1
export const projectorJobs = pgTable('projector_jobs', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // backfill | incremental | repair
  index: text('index').notNull(),
  startCursor: jsonb('start_cursor'),
  endCursor: jsonb('end_cursor'),
  batchSize: integer('batch_size').notNull(),
  status: text('status').notNull(), // pending | running | completed | failed | cancelled
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true })
})

// Phase 10.1 Projection Platform：projection_cursors 持久化 per-index 投影游标
// 来源：docs/roadmap/PHASE-10.1.md §2.3
export const projectionCursors = pgTable('projection_cursors', {
  index: text('index').primaryKey(), // 索引名作为主键，每个索引一个 cursor
  factId: text('fact_id').notNull(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
})

// Phase 10.1 Projection Platform：projection_dlq 持久化死信队列
// 来源：docs/roadmap/PHASE-10.1.md §2.4
export const projectionDLQ = pgTable('projection_dlq', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull(),
  factId: text('fact_id').notNull(),
  index: text('index').notNull(),
  error: text('error').notNull(),
  attemptedAt: jsonb('attempted_at').notNull(), // ISO8601 string[]
  retries: integer('retries').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
})
