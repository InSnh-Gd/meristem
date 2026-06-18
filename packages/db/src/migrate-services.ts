import type postgres from 'postgres'

/**
 * 执行服务侧控制面迁移，覆盖 M-Net profile、扩展、身份、SecretRef 与配置状态。
 */
export async function migrateServices(tx: postgres.TransactionSql) {
  await tx`
    create table if not exists mnet_profile_definitions (
      id text primary key,
      profile_version text not null,
      region text not null,
      schema_version text not null,
      definition jsonb not null,
      status text not null,
      created_at timestamptz not null,
      updated_at timestamptz not null
    )
  `
  await tx`
    create unique index if not exists mnet_profile_definitions_profile_version_unique
    on mnet_profile_definitions (profile_version)
  `
  await tx`
    create table if not exists mnet_network_profile_states (
      network_id text primary key references networks(id),
      profile_version text not null,
      status text not null,
      enabled_by text,
      policy_decision_id text references policy_decisions(id),
      correlation_id text,
      applied_at timestamptz,
      disabled_at timestamptz,
      last_error text,
      updated_at timestamptz not null
    )
  `
  await tx`
    create table if not exists mnet_profile_transitions (
      id text primary key,
      network_id text not null references networks(id),
      from_profile_version text not null,
      to_profile_version text not null,
      from_status text not null,
      to_status text not null,
      actor text not null,
      reason text,
      policy_decision_id text references policy_decisions(id),
      correlation_id text,
      created_at timestamptz not null
    )
  `
  await tx`
    create table if not exists mnet_suspended_operations (
      id text primary key,
      policy_decision_id text not null references policy_decisions(id),
      action text not null,
      network_id text not null references networks(id),
      from_profile_version text not null,
      to_profile_version text not null,
      requested_by text not null,
      reason text,
      correlation_id text not null,
      idempotency_key text not null,
      status text not null,
      expires_at timestamptz not null,
      created_at timestamptz not null,
      resumed_at timestamptz,
      terminal_reason text
    )
  `
  await tx`
    create table if not exists mnet_global_defaults (
      id text primary key,
      default_profile_version text not null,
      switch_state text not null,
      switch_operation_id text,
      updated_at timestamptz not null
    )
  `
  await tx`
    create table if not exists mnet_profile_switch_operations (
      operation_id text primary key,
      idempotency_key text not null,
      target_profile_version text not null,
      batch_size integer not null,
      reason text not null,
      state text not null,
      current_batch_id integer,
      created_at timestamptz not null,
      updated_at timestamptz not null
    )
  `
  await tx`
    create unique index if not exists mnet_profile_switch_operations_idempotency_unique
    on mnet_profile_switch_operations (idempotency_key)
  `
  await tx`
    create table if not exists mnet_profile_switch_batches (
      operation_id text not null references mnet_profile_switch_operations(operation_id),
      batch_id integer not null,
      primary key (operation_id, batch_id)
    )
  `
  await tx`
    create table if not exists mnet_profile_switch_batch_members (
      operation_id text not null,
      batch_id integer not null,
      network_id text not null references networks(id),
      primary key (operation_id, batch_id, network_id)
    )
  `
  await tx`
    create table if not exists mnet_profile_switch_results (
      operation_id text not null references mnet_profile_switch_operations(operation_id),
      network_id text not null references networks(id),
      previous_profile_version text not null,
      target_profile_version text not null,
      status text not null,
      reason text,
      audit_id text,
      correlation_id text,
      primary key (operation_id, network_id)
    )
  `
  await tx`
    create table if not exists mnet_profile_switch_snapshots (
      operation_id text not null references mnet_profile_switch_operations(operation_id),
      network_id text not null references networks(id),
      previous_profile_version text not null,
      primary key (operation_id, network_id)
    )
  `
  await tx`
    create table if not exists mnet_profile_default_set_results (
      idempotency_key text primary key,
      operation_id text not null,
      policy_decision_id text not null references policy_decisions(id),
      audit_id text not null
    )
  `
  await tx`
    create table if not exists mnet_profile_disable_policies (
      id text primary key,
      require_approval text not null,
      emergency_break_glass_enabled text not null,
      reason text not null,
      idempotency_key text not null,
      updated_at timestamptz not null
    )
  `
  await tx`
    create table if not exists extension_definitions (
      id text primary key,
      manifest_version text not null,
      kind text not null,
      display_name text not null,
      owner text not null,
      license text not null,
      manifest jsonb not null,
      declared_capabilities jsonb not null,
      requested_permissions jsonb not null,
      risk_class text not null,
      status text not null,
      registered_by text not null,
      policy_decision_id text not null references policy_decisions(id),
      correlation_id text not null,
      created_at timestamptz not null,
      updated_at timestamptz not null
    )
  `
  await tx`
    create table if not exists extension_instances (
      id text primary key,
      extension_id text not null references extension_definitions(id),
      scope_type text not null,
      scope_id text not null,
      status text not null,
      enabled_by text,
      disabled_by text,
      policy_decision_id text references policy_decisions(id),
      correlation_id text,
      last_error text,
      created_at timestamptz not null,
      updated_at timestamptz not null,
      enabled_at timestamptz,
      disabled_at timestamptz
    )
  `
  await tx`
    create unique index if not exists extension_instances_scope_unique
    on extension_instances (extension_id, scope_type, scope_id)
  `
  await tx`
    create table if not exists extension_transitions (
      id text primary key,
      extension_id text not null references extension_definitions(id),
      instance_id text references extension_instances(id),
      from_status text,
      to_status text not null,
      actor text not null,
      reason text,
      policy_decision_id text not null references policy_decisions(id),
      correlation_id text not null,
      created_at timestamptz not null
    )
  `
  await tx`
    create table if not exists actors (
      id text primary key,
      display_name text not null,
      status text not null,
      created_at timestamptz not null,
      updated_at timestamptz not null
    )
  `
  await tx`
    create table if not exists actor_tokens (
      jti text primary key,
      actor_id text not null references actors(id),
      issuer text not null,
      audience text not null,
      issued_at timestamptz not null,
      expires_at timestamptz not null,
      issued_by text not null,
      purpose text not null,
      status text not null,
      created_at timestamptz not null,
      updated_at timestamptz not null
    )
  `
  await tx`
    create unique index if not exists actor_tokens_jti_unique
    on actor_tokens (jti)
  `
  await tx`
    create table if not exists actor_token_revocations (
      jti text primary key references actor_tokens(jti),
      revoked_at timestamptz not null,
      revoked_by text not null,
      reason text not null,
      correlation_id text
    )
  `
  await tx`
    create table if not exists secret_refs (
      id text primary key,
      name text not null,
      scope text not null,
      status text not null,
      created_by text not null,
      created_at timestamptz not null,
      updated_at timestamptz not null,
      metadata jsonb not null
    )
  `
  await tx`
    create table if not exists secret_ref_versions (
      id text primary key,
      secret_ref_id text not null references secret_refs(id),
      version text not null,
      value_ciphertext text not null,
      created_by text not null,
      created_at timestamptz not null,
      disabled_at timestamptz
    )
  `
  await tx`
    create table if not exists secret_ref_transitions (
      id text primary key,
      secret_ref_id text not null references secret_refs(id),
      from_status text not null,
      to_status text not null,
      actor text not null,
      reason text,
      policy_decision_id text references policy_decisions(id),
      correlation_id text,
      created_at timestamptz not null
    )
  `
  await tx`
    create table if not exists config_records (
      id text primary key,
      config_version text not null,
      schema_version text not null,
      config_hash text not null,
      domain text not null,
      target_scope jsonb not null,
      status text not null,
      payload jsonb not null,
      created_by text not null,
      created_at timestamptz not null,
      published_by text,
      published_at timestamptz,
      rollback_version text,
      updated_at timestamptz not null
    )
  `
  await tx`
    create table if not exists config_versions (
      id text primary key,
      config_id text not null references config_records(id),
      version text not null,
      config_hash text not null,
      payload jsonb not null,
      status text not null,
      created_by text not null,
      created_at timestamptz not null
    )
  `
  await tx`
    create table if not exists config_transitions (
      id text primary key,
      config_id text not null references config_records(id),
      from_status text not null,
      to_status text not null,
      actor text not null,
      reason text,
      policy_decision_id text references policy_decisions(id),
      correlation_id text,
      created_at timestamptz not null
    )
  `
  await tx`
    create table if not exists config_apply_acks (
      id text primary key,
      config_id text not null references config_records(id),
      version text not null,
      target_service text not null,
      status text not null,
      error text,
      acked_at timestamptz,
      expires_at timestamptz,
      created_at timestamptz not null
    )
  `
  await tx`
    create unique index if not exists config_apply_acks_service_unique
    on config_apply_acks (config_id, target_service)
  `
}
