import { jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

import { nodes } from './core.ts'
import { policyDecisions } from './policy.ts'

// Owning domain: network.
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
  table => [uniqueIndex('networks_name_unique').on(table.name)]
)

export const networkMemberships = pgTable(
  'network_memberships',
  {
    networkId: text('network_id')
      .notNull()
      .references(() => networks.id),
    nodeId: text('node_id')
      .notNull()
      .references(() => nodes.id),
    membershipMode: text('membership_mode').notNull(),
    status: text('status').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  table => [primaryKey({ columns: [table.networkId, table.nodeId] })]
)

export const mnetProfileDefinitions = pgTable(
  'mnet_profile_definitions',
  {
    id: text('id').primaryKey(),
    profileVersion: text('profile_version').notNull(),
    region: text('region').notNull(),
    schemaVersion: text('schema_version').notNull(),
    definition: jsonb('definition').notNull(),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  table => [uniqueIndex('mnet_profile_definitions_profile_version_unique').on(table.profileVersion)]
)

export const mnetNetworkProfileStates = pgTable('mnet_network_profile_states', {
  networkId: text('network_id')
    .primaryKey()
    .references(() => networks.id),
  profileVersion: text('profile_version').notNull(),
  status: text('status').notNull(),
  enabledBy: text('enabled_by'),
  policyDecisionId: text('policy_decision_id').references(() => policyDecisions.id),
  correlationId: text('correlation_id'),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  lastError: text('last_error'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
})

export const mnetProfileTransitions = pgTable('mnet_profile_transitions', {
  id: text('id').primaryKey(),
  networkId: text('network_id')
    .notNull()
    .references(() => networks.id),
  fromProfileVersion: text('from_profile_version').notNull(),
  toProfileVersion: text('to_profile_version').notNull(),
  fromStatus: text('from_status').notNull(),
  toStatus: text('to_status').notNull(),
  actor: text('actor').notNull(),
  reason: text('reason'),
  policyDecisionId: text('policy_decision_id').references(() => policyDecisions.id),
  correlationId: text('correlation_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
})

export const mnetSuspendedOperations = pgTable('mnet_suspended_operations', {
  id: text('id').primaryKey(),
  policyDecisionId: text('policy_decision_id')
    .notNull()
    .references(() => policyDecisions.id),
  action: text('action').notNull(),
  networkId: text('network_id')
    .notNull()
    .references(() => networks.id),
  fromProfileVersion: text('from_profile_version').notNull(),
  toProfileVersion: text('to_profile_version').notNull(),
  requestedBy: text('requested_by').notNull(),
  reason: text('reason'),
  correlationId: text('correlation_id').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  status: text('status').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  resumedAt: timestamp('resumed_at', { withTimezone: true }),
  terminalReason: text('terminal_reason')
})
