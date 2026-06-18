import { integer, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

import { networks } from './network.ts'
import { policyDecisions } from './policy.ts'

// Owning domain: m-net control state.
// 这些表保存控制面默认值、批量切换状态与禁用审批策略，不承担数据面运行时流量状态。

export const mnetGlobalDefaults = pgTable('mnet_global_defaults', {
  id: text('id').primaryKey(),
  defaultProfileVersion: text('default_profile_version').notNull(),
  switchState: text('switch_state').notNull(),
  switchOperationId: text('switch_operation_id'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
})

export const mnetProfileSwitchOperations = pgTable(
  'mnet_profile_switch_operations',
  {
    operationId: text('operation_id').primaryKey(),
    idempotencyKey: text('idempotency_key').notNull(),
    targetProfileVersion: text('target_profile_version').notNull(),
    batchSize: integer('batch_size').notNull(),
    reason: text('reason').notNull(),
    state: text('state').notNull(),
    currentBatchId: integer('current_batch_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  table => [
    uniqueIndex('mnet_profile_switch_operations_idempotency_unique').on(table.idempotencyKey)
  ]
)

export const mnetProfileSwitchBatches = pgTable(
  'mnet_profile_switch_batches',
  {
    operationId: text('operation_id')
      .notNull()
      .references(() => mnetProfileSwitchOperations.operationId),
    batchId: integer('batch_id').notNull()
  },
  table => [primaryKey({ columns: [table.operationId, table.batchId] })]
)

export const mnetProfileSwitchBatchMembers = pgTable(
  'mnet_profile_switch_batch_members',
  {
    operationId: text('operation_id').notNull(),
    batchId: integer('batch_id').notNull(),
    networkId: text('network_id')
      .notNull()
      .references(() => networks.id)
  },
  table => [primaryKey({ columns: [table.operationId, table.batchId, table.networkId] })]
)

export const mnetProfileSwitchResults = pgTable(
  'mnet_profile_switch_results',
  {
    operationId: text('operation_id')
      .notNull()
      .references(() => mnetProfileSwitchOperations.operationId),
    networkId: text('network_id')
      .notNull()
      .references(() => networks.id),
    previousProfileVersion: text('previous_profile_version').notNull(),
    targetProfileVersion: text('target_profile_version').notNull(),
    status: text('status').notNull(),
    reason: text('reason'),
    auditId: text('audit_id'),
    correlationId: text('correlation_id')
  },
  table => [primaryKey({ columns: [table.operationId, table.networkId] })]
)

export const mnetProfileSwitchSnapshots = pgTable(
  'mnet_profile_switch_snapshots',
  {
    operationId: text('operation_id')
      .notNull()
      .references(() => mnetProfileSwitchOperations.operationId),
    networkId: text('network_id')
      .notNull()
      .references(() => networks.id),
    previousProfileVersion: text('previous_profile_version').notNull()
  },
  table => [primaryKey({ columns: [table.operationId, table.networkId] })]
)

export const mnetProfileDefaultSetResults = pgTable('mnet_profile_default_set_results', {
  idempotencyKey: text('idempotency_key').primaryKey(),
  operationId: text('operation_id').notNull(),
  policyDecisionId: text('policy_decision_id')
    .notNull()
    .references(() => policyDecisions.id),
  auditId: text('audit_id').notNull()
})

export const mnetProfileDisablePolicies = pgTable('mnet_profile_disable_policies', {
  id: text('id').primaryKey(),
  requireApproval: text('require_approval').notNull(),
  emergencyBreakGlassEnabled: text('emergency_break_glass_enabled').notNull(),
  reason: text('reason').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
})
