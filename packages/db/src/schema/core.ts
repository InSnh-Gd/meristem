import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// Owning domain: core.
// PostgreSQL schema 是 MVP 权威写模型；事件、日志和缓存都不能替代这些表的职责。
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
  nodeId: text('node_id')
    .notNull()
    .references(() => nodes.id),
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

// tasks 是 Core-owned MVP 路径的历史兼容表；canonical task state 由 M-Task 表组持有。
export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(),
  leafNodeId: text('leaf_node_id')
    .notNull()
    .references(() => nodes.id),
  type: text('type').notNull(),
  status: text('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true })
})
