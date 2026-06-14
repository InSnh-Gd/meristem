import { integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

import { nodes } from './core.ts'
import { policyDecisions } from './policy.ts'

// Owning domain: task.
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
  definitionId: text('definition_id')
    .notNull()
    .references(() => taskDefinitions.id),
  nodeId: text('node_id')
    .notNull()
    .references(() => nodes.id),
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
  taskId: text('task_id')
    .notNull()
    .references(() => taskRequests.id),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  reason: text('reason'),
  correlationId: text('correlation_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
})

export const taskResults = pgTable('task_results', {
  taskId: text('task_id')
    .primaryKey()
    .references(() => taskRequests.id),
  status: text('status').notNull(),
  payload: jsonb('payload'),
  error: text('error'),
  completedAt: timestamp('completed_at', { withTimezone: true }).notNull()
})

export const taskCancellations = pgTable('task_cancellations', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => taskRequests.id),
  requestedBy: text('requested_by').notNull(),
  status: text('status').notNull(),
  correlationId: text('correlation_id'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true })
})

export const taskSuspendedOperations = pgTable('task_suspended_operations', {
  id: text('id').primaryKey(),
  policyDecisionId: text('policy_decision_id')
    .notNull()
    .references(() => policyDecisions.id),
  action: text('action').notNull(),
  requestedBy: text('requested_by').notNull(),
  resource: text('resource').notNull(),
  sanitizedPayload: jsonb('sanitized_payload'),
  correlationId: text('correlation_id').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  status: text('status').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  resumedAt: timestamp('resumed_at', { withTimezone: true }),
  terminalReason: text('terminal_reason')
})
