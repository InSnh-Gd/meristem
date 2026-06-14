import { integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

import { policyDecisions } from './policy.ts'

// Owning domain: log.
// policy_decisions、timeline/full/audit logs 分别对应授权事实与三级日志事实。
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

// Projection Platform 表：projector_jobs 记录投影作业生命周期
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

// Projection Platform：projection_cursors 持久化 per-index 投影游标
export const projectionCursors = pgTable('projection_cursors', {
  index: text('index').primaryKey(), // 索引名作为主键，每个索引一个 cursor
  factId: text('fact_id').notNull(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
})

// Projection Platform：projection_dlq 持久化死信队列
export const projectionDLQ = pgTable('projection_dlq', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull(),
  factId: text('fact_id').notNull(),
  index: text('index').notNull(),
  error: text('error').notNull(),
  attemptedAt: jsonb('attempted_at').notNull(),
  retries: integer('retries').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
})
