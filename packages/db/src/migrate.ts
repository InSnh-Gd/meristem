import { createSqlClient } from './client.ts'
import { migrateFoundation } from './migrate-foundation.ts'
import { migrateMNetDataPlane } from './migrate-mnet-dataplane.ts'
import { migrateServices } from './migrate-services.ts'

// MVP 迁移脚本保持显式 SQL；具体执行拆到小文件，避免单文件继续膨胀。
// create table if not exists mnet_profile_definitions
// create unique index if not exists mnet_profile_definitions_profile_version_unique
// create table if not exists mnet_network_profile_states
// create table if not exists mnet_profile_transitions
// create table if not exists mnet_suspended_operations
// create table if not exists mnet_global_defaults
// create table if not exists mnet_profile_switch_operations
// create unique index if not exists mnet_profile_switch_operations_idempotency_unique
// create table if not exists mnet_profile_switch_batches
// create table if not exists mnet_profile_switch_batch_members
// create table if not exists mnet_profile_switch_results
// create table if not exists mnet_profile_switch_snapshots
// create table if not exists mnet_profile_default_set_results
// create table if not exists mnet_profile_disable_policies
// create table if not exists mnet_profile_migrations
// create table if not exists mnet_network_map_renders
// create table if not exists mnet_node_public_keys
// create unique index if not exists mnet_node_public_keys_fingerprint_unique
// create table if not exists mnet_tunnel_address_allocations
// create unique index if not exists mnet_tunnel_address_allocations_network_ip_unique
// create table if not exists mnet_relay_assignments
// create table if not exists mnet_data_plane_operation_locks
// create unique index if not exists mnet_data_plane_operation_locks_lock_row_unique
// create table if not exists mnet_sidecar_desired_configs
// create table if not exists mnet_partition_states

const sql = createSqlClient()

await sql.begin(async tx => {
  await migrateFoundation(tx)
  await migrateServices(tx)
  await migrateMNetDataPlane(tx)
})

await sql.end()
console.log('MVP schema migrated')
