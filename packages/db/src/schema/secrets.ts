import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

import { policyDecisions } from './policy.ts'

// Owning domain: secrets.
export const secretRefs = pgTable('secret_refs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  scope: text('scope').notNull(),
  status: text('status').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  metadata: jsonb('metadata').notNull()
})

export const secretRefVersions = pgTable('secret_ref_versions', {
  id: text('id').primaryKey(),
  secretRefId: text('secret_ref_id')
    .notNull()
    .references(() => secretRefs.id),
  version: text('version').notNull(),
  valueCiphertext: text('value_ciphertext').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  disabledAt: timestamp('disabled_at', { withTimezone: true })
})

export const secretRefTransitions = pgTable('secret_ref_transitions', {
  id: text('id').primaryKey(),
  secretRefId: text('secret_ref_id')
    .notNull()
    .references(() => secretRefs.id),
  fromStatus: text('from_status').notNull(),
  toStatus: text('to_status').notNull(),
  actor: text('actor').notNull(),
  reason: text('reason'),
  policyDecisionId: text('policy_decision_id').references(() => policyDecisions.id),
  correlationId: text('correlation_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
})
