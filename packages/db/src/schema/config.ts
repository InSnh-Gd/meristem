import { jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

import { policyDecisions } from './policy.ts'

// Owning domain: config.
export const configRecords = pgTable('config_records', {
  id: text('id').primaryKey(),
  configVersion: text('config_version').notNull(),
  schemaVersion: text('schema_version').notNull(),
  configHash: text('config_hash').notNull(),
  domain: text('domain').notNull(),
  targetScope: jsonb('target_scope').notNull(),
  status: text('status').notNull(),
  payload: jsonb('payload').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  publishedBy: text('published_by'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  rollbackVersion: text('rollback_version'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
})

export const configVersions = pgTable('config_versions', {
  id: text('id').primaryKey(),
  configId: text('config_id')
    .notNull()
    .references(() => configRecords.id),
  version: text('version').notNull(),
  configHash: text('config_hash').notNull(),
  payload: jsonb('payload').notNull(),
  status: text('status').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
})

export const configTransitions = pgTable('config_transitions', {
  id: text('id').primaryKey(),
  configId: text('config_id')
    .notNull()
    .references(() => configRecords.id),
  fromStatus: text('from_status').notNull(),
  toStatus: text('to_status').notNull(),
  actor: text('actor').notNull(),
  reason: text('reason'),
  policyDecisionId: text('policy_decision_id').references(() => policyDecisions.id),
  correlationId: text('correlation_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
})

export const configApplyAcks = pgTable(
  'config_apply_acks',
  {
    id: text('id').primaryKey(),
    configId: text('config_id')
      .notNull()
      .references(() => configRecords.id),
    version: text('version').notNull(),
    targetService: text('target_service').notNull(),
    status: text('status').notNull(),
    error: text('error'),
    ackedAt: timestamp('acked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull()
  },
  table => [uniqueIndex('config_apply_acks_service_unique').on(table.configId, table.targetService)]
)
