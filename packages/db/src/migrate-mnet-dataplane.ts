import type postgres from 'postgres'

/**
 * 执行 M-Net 数据面权威表迁移，只保存控制面编排所需的元数据。
 */
export async function migrateMNetDataPlane(tx: postgres.TransactionSql) {
  await tx`
    create table if not exists mnet_profile_migrations (
      network_id text not null references networks(id),
      operation_id text not null,
      from_version text not null,
      to_version text not null,
      status text not null,
      idempotency_key text not null,
      started_at timestamptz not null,
      completed_at timestamptz,
      audit_metadata jsonb not null,
      primary key (network_id, operation_id)
    )
  `
  await tx`
    create table if not exists mnet_network_map_renders (
      network_id text not null references networks(id),
      map_version integer not null,
      profile_version text not null,
      map_json jsonb not null,
      signature_metadata jsonb not null,
      expires_at timestamptz not null,
      published_at timestamptz not null,
      primary key (network_id, map_version)
    )
  `
  await tx`
    create table if not exists mnet_node_public_keys (
      node_id text not null references nodes(id),
      key_id text not null,
      public_key text not null,
      fingerprint text not null,
      algorithm text not null,
      created_at timestamptz not null,
      rotated_at timestamptz,
      rotation_due_at timestamptz,
      rotation_counter integer not null,
      status text not null,
      endpoint text,
      primary key (node_id, key_id)
    )
  `
  // 幂等升级：已存在的表需要补 endpoint 列以匹配 Drizzle schema。
  await tx`
    alter table mnet_node_public_keys add column if not exists endpoint text
  `
  await tx`
    create unique index if not exists mnet_node_public_keys_fingerprint_unique
    on mnet_node_public_keys (fingerprint)
  `
  await tx`
    create table if not exists mnet_tunnel_address_allocations (
      network_id text not null references networks(id),
      node_id text not null references nodes(id),
      subnet_cidr text not null,
      tunnel_ip text not null,
      allocated_at timestamptz not null,
      primary key (network_id, node_id)
    )
  `
  await tx`
    create unique index if not exists mnet_tunnel_address_allocations_network_ip_unique
    on mnet_tunnel_address_allocations (network_id, tunnel_ip)
  `
  await tx`
    create table if not exists mnet_relay_assignments (
      network_id text not null references networks(id),
      relay_id text not null references nodes(id),
      relay_type text not null,
      endpoint text not null,
      assigned_at timestamptz not null,
      primary key (network_id, relay_id)
    )
  `
  await tx`
    create table if not exists mnet_data_plane_operation_locks (
      operation_id text primary key,
      network_id text not null references networks(id),
      operation_type text not null,
      idempotency_key text,
      acquired_at timestamptz not null,
      expires_at timestamptz not null,
      status text not null,
      lock_row_id text not null,
      fencing_token integer not null,
      updated_at timestamptz not null
    )
  `
  await tx`
    create unique index if not exists mnet_data_plane_operation_locks_lock_row_unique
    on mnet_data_plane_operation_locks (lock_row_id)
  `
  await tx`
    create table if not exists mnet_sidecar_desired_configs (
      node_id text primary key references nodes(id),
      config_hash text not null,
      desired_at timestamptz not null,
      applied_at timestamptz
    )
  `
  await tx`
    create table if not exists mnet_partition_states (
      network_id text primary key references networks(id),
      state text not null,
      reason jsonb not null,
      transitioned_at timestamptz not null,
      previous_state text
    )
  `
}
