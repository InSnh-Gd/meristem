import {
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex
} from 'drizzle-orm/pg-core'

import { nodes } from './core.ts'
import { networks } from './network.ts'

// Owning domain: m-net data plane.
// 这些表只保存权威元数据，不保存 WireGuard 私钥或实际包转发状态。

export const mnetProfileMigrations = pgTable(
  'mnet_profile_migrations',
  {
    networkId: text('network_id')
      .notNull()
      .references(() => networks.id),
    operationId: text('operation_id').notNull(),
    fromVersion: text('from_version').notNull(),
    toVersion: text('to_version').notNull(),
    status: text('status').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    auditMetadata: jsonb('audit_metadata').notNull()
  },
  table => [primaryKey({ columns: [table.networkId, table.operationId] })]
)

export const mnetNetworkMapRenders = pgTable(
  'mnet_network_map_renders',
  {
    networkId: text('network_id')
      .notNull()
      .references(() => networks.id),
    mapVersion: integer('map_version').notNull(),
    profileVersion: text('profile_version').notNull(),
    mapJson: jsonb('map_json').notNull(),
    signatureMetadata: jsonb('signature_metadata').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull()
  },
  table => [primaryKey({ columns: [table.networkId, table.mapVersion] })]
)

export const mnetNodePublicKeys = pgTable(
  'mnet_node_public_keys',
  {
    nodeId: text('node_id')
      .notNull()
      .references(() => nodes.id),
    keyId: text('key_id').notNull(),
    publicKey: text('public_key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    algorithm: text('algorithm').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    rotationDueAt: timestamp('rotation_due_at', { withTimezone: true }),
    rotationCounter: integer('rotation_counter').notNull(),
    status: text('status').notNull()
  },
  table => [
    primaryKey({ columns: [table.nodeId, table.keyId] }),
    uniqueIndex('mnet_node_public_keys_fingerprint_unique').on(table.fingerprint)
  ]
)

export const mnetTunnelAddressAllocations = pgTable(
  'mnet_tunnel_address_allocations',
  {
    networkId: text('network_id')
      .notNull()
      .references(() => networks.id),
    nodeId: text('node_id')
      .notNull()
      .references(() => nodes.id),
    subnetCidr: text('subnet_cidr').notNull(),
    tunnelIp: text('tunnel_ip').notNull(),
    allocatedAt: timestamp('allocated_at', { withTimezone: true }).notNull()
  },
  table => [
    primaryKey({ columns: [table.networkId, table.nodeId] }),
    uniqueIndex('mnet_tunnel_address_allocations_network_ip_unique').on(
      table.networkId,
      table.tunnelIp
    )
  ]
)

export const mnetRelayAssignments = pgTable(
  'mnet_relay_assignments',
  {
    networkId: text('network_id')
      .notNull()
      .references(() => networks.id),
    relayId: text('relay_id')
      .notNull()
      .references(() => nodes.id),
    relayType: text('relay_type').notNull(),
    endpoint: text('endpoint').notNull(),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull()
  },
  table => [primaryKey({ columns: [table.networkId, table.relayId] })]
)

export const mnetDataPlaneOperationLocks = pgTable(
  'mnet_data_plane_operation_locks',
  {
    operationId: text('operation_id').primaryKey(),
    networkId: text('network_id')
      .notNull()
      .references(() => networks.id),
    operationType: text('operation_type').notNull(),
    idempotencyKey: text('idempotency_key'),
    acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    status: text('status').notNull(),
    lockRowId: text('lock_row_id').notNull(),
    fencingToken: integer('fencing_token').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  table => [uniqueIndex('mnet_data_plane_operation_locks_lock_row_unique').on(table.lockRowId)]
)

export const mnetSidecarDesiredConfigs = pgTable('mnet_sidecar_desired_configs', {
  nodeId: text('node_id')
    .primaryKey()
    .references(() => nodes.id),
  configHash: text('config_hash').notNull(),
  desiredAt: timestamp('desired_at', { withTimezone: true }).notNull(),
  appliedAt: timestamp('applied_at', { withTimezone: true })
})

export const mnetPartitionStates = pgTable('mnet_partition_states', {
  networkId: text('network_id')
    .primaryKey()
    .references(() => networks.id),
  state: text('state').notNull(),
  reason: jsonb('reason').notNull(),
  transitionedAt: timestamp('transitioned_at', { withTimezone: true }).notNull(),
  previousState: text('previous_state')
})
