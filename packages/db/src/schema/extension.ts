import { jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

import { policyDecisions } from './policy.ts'

// Owning domain: extension.
// M-Extension 表组只保存控制面声明和 system/default 实例状态，不保存执行代码或 secret 明文。
export const extensionDefinitions = pgTable('extension_definitions', {
  id: text('id').primaryKey(),
  manifestVersion: text('manifest_version').notNull(),
  kind: text('kind').notNull(),
  displayName: text('display_name').notNull(),
  owner: text('owner').notNull(),
  license: text('license').notNull(),
  manifest: jsonb('manifest').notNull(),
  declaredCapabilities: jsonb('declared_capabilities').notNull(),
  requestedPermissions: jsonb('requested_permissions').notNull(),
  riskClass: text('risk_class').notNull(),
  status: text('status').notNull(),
  registeredBy: text('registered_by').notNull(),
  policyDecisionId: text('policy_decision_id')
    .notNull()
    .references(() => policyDecisions.id),
  correlationId: text('correlation_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
})

export const extensionInstances = pgTable(
  'extension_instances',
  {
    id: text('id').primaryKey(),
    extensionId: text('extension_id')
      .notNull()
      .references(() => extensionDefinitions.id),
    scopeType: text('scope_type').notNull(),
    scopeId: text('scope_id').notNull(),
    status: text('status').notNull(),
    enabledBy: text('enabled_by'),
    disabledBy: text('disabled_by'),
    policyDecisionId: text('policy_decision_id').references(() => policyDecisions.id),
    correlationId: text('correlation_id'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    enabledAt: timestamp('enabled_at', { withTimezone: true }),
    disabledAt: timestamp('disabled_at', { withTimezone: true })
  },
  table => [
    uniqueIndex('extension_instances_scope_unique').on(
      table.extensionId,
      table.scopeType,
      table.scopeId
    )
  ]
)

export const extensionTransitions = pgTable('extension_transitions', {
  id: text('id').primaryKey(),
  extensionId: text('extension_id')
    .notNull()
    .references(() => extensionDefinitions.id),
  instanceId: text('instance_id').references(() => extensionInstances.id),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  actor: text('actor').notNull(),
  reason: text('reason'),
  policyDecisionId: text('policy_decision_id')
    .notNull()
    .references(() => policyDecisions.id),
  correlationId: text('correlation_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
})
