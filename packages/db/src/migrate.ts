import { createSqlClient } from './client.ts'

// MVP 迁移脚本保持显式 SQL，确保每个阶段新增字段和表都能被清楚追踪与审核。
const sql = createSqlClient()

await sql.begin(async tx => {
  await tx`
    create table if not exists users (
      id text primary key,
      display_name text not null,
      created_at timestamptz not null
    )
  `
  await tx`
    create table if not exists roles (
      id text primary key,
      description text not null
    )
  `
  await tx`
    create table if not exists permissions (
      id text primary key,
      description text not null
    )
  `
  await tx`
    create table if not exists user_roles (
      user_id text not null references users(id),
      role_id text not null references roles(id),
      primary key (user_id, role_id)
    )
  `
  await tx`
    create table if not exists role_permissions (
      role_id text not null references roles(id),
      permission_id text not null references permissions(id),
      primary key (role_id, permission_id)
    )
  `
  await tx`
    create table if not exists nodes (
      id text primary key,
      kind text not null,
      name text not null,
      mode text not null,
      status text not null,
      reachability text not null,
      last_seen_at timestamptz,
      agent_version text,
      capabilities jsonb not null,
      scope jsonb not null,
      created_at timestamptz not null,
      updated_at timestamptz not null
    )
  `
  await tx`alter table nodes add column if not exists mode text`
  await tx`alter table nodes add column if not exists reachability text`
  await tx`alter table nodes add column if not exists last_seen_at timestamptz`
  await tx`alter table nodes add column if not exists agent_version text`
  // 老数据补默认值，保证 agent/simulated 双模式切入后仍能兼容先前注册的节点记录。
  await tx`
    update nodes
    set
      mode = coalesce(mode, 'simulated'),
      reachability = coalesce(
        reachability,
        case
          when status in ('healthy', 'degraded') then 'reachable'
          when status = 'offline' then 'unreachable'
          else 'unknown'
        end
      )
    where mode is null or reachability is null
  `
  await tx`alter table nodes alter column mode set not null`
  await tx`alter table nodes alter column reachability set not null`
  await tx`
    create table if not exists node_credentials (
      id text primary key,
      node_id text not null references nodes(id),
      token_hash text not null,
      status text not null,
      issued_at timestamptz not null,
      revoked_at timestamptz,
      last_used_at timestamptz
    )
  `
  await tx`
    create table if not exists node_join_tickets (
      id text primary key,
      ticket_hash text not null,
      kind text not null,
      name text not null,
      capabilities jsonb not null,
      status text not null,
      expires_at timestamptz not null,
      created_by text not null,
      created_at timestamptz not null,
      redeemed_at timestamptz,
      redeemed_node_id text references nodes(id)
    )
  `
  await tx`
    create table if not exists service_definitions (
      id text primary key,
      version text not null,
      domain text not null,
      kind text not null,
      definition jsonb not null,
      created_at timestamptz not null,
      updated_at timestamptz not null
    )
  `
  await tx`
    create table if not exists tasks (
      id text primary key,
      leaf_node_id text not null references nodes(id),
      type text not null,
      status text not null,
      created_at timestamptz not null,
      completed_at timestamptz
    )
  `
  await tx`
    create table if not exists policy_decisions (
      id text primary key,
      actor text not null,
      action text not null,
      resource text not null,
      result text not null,
      reasons jsonb not null,
      created_at timestamptz not null
    )
  `
  await tx`
    create table if not exists policy_approvals (
      id text primary key,
      policy_decision_id text not null references policy_decisions(id),
      origin_service text not null,
      operation_id text not null,
      requested_by text not null,
      required_action text not null,
      status text not null,
      quorum_required integer not null,
      expires_at timestamptz not null,
      created_at timestamptz not null,
      updated_at timestamptz not null,
      completed_at timestamptz
    )
  `
  await tx`
    create table if not exists policy_approval_votes (
      id text primary key,
      approval_id text not null references policy_approvals(id),
      actor text not null,
      vote text not null,
      reason text,
      created_at timestamptz not null
    )
  `
  await tx`
    create unique index if not exists policy_approval_votes_approval_actor_unique
    on policy_approval_votes (approval_id, actor)
  `
  await tx`
    create table if not exists task_definitions (
      id text primary key,
      type text not null,
      version text not null,
      description text not null,
      danger_level text not null,
      default_timeout_seconds integer not null,
      created_at timestamptz not null,
      updated_at timestamptz not null
    )
  `
  await tx`
    create table if not exists task_requests (
      id text primary key,
      definition_id text not null references task_definitions(id),
      node_id text not null references nodes(id),
      type text not null,
      status text not null,
      requested_by text not null,
      policy_decision_id text references policy_decisions(id),
      correlation_id text,
      risk jsonb not null,
      timeout_at timestamptz,
      created_at timestamptz not null,
      updated_at timestamptz not null,
      completed_at timestamptz,
      canceled_at timestamptz
    )
  `
  await tx`
    create table if not exists task_transitions (
      id text primary key,
      task_id text not null references task_requests(id),
      from_status text,
      to_status text not null,
      reason text,
      correlation_id text,
      created_at timestamptz not null
    )
  `
  await tx`
    create table if not exists task_results (
      task_id text primary key references task_requests(id),
      status text not null,
      payload jsonb,
      error text,
      completed_at timestamptz not null
    )
  `
  await tx`
    create table if not exists task_cancellations (
      id text primary key,
      task_id text not null references task_requests(id),
      requested_by text not null,
      status text not null,
      correlation_id text,
      requested_at timestamptz not null,
      completed_at timestamptz
    )
  `
  await tx`
    create table if not exists task_suspended_operations (
      id text primary key,
      policy_decision_id text not null references policy_decisions(id),
      action text not null,
      requested_by text not null,
      resource text not null,
      sanitized_payload jsonb,
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
    create table if not exists networks (
      id text primary key,
      name text not null unique,
      profile_version text not null,
      status text not null,
      created_at timestamptz not null,
      updated_at timestamptz not null
    )
  `
  await tx`
    create table if not exists network_memberships (
      network_id text not null references networks(id),
      node_id text not null references nodes(id),
      membership_mode text not null,
      status text not null,
      joined_at timestamptz not null,
      updated_at timestamptz not null,
      primary key (network_id, node_id)
    )
  `
  await tx`
    create table if not exists timeline_logs (
      id text primary key,
      timestamp timestamptz not null,
      summary text not null,
      subject text,
      correlation_id text
    )
  `
  await tx`
    create table if not exists full_logs (
      id text primary key,
      timestamp timestamptz not null,
      level text not null,
      source text not null,
      message text not null,
      correlation_id text,
      trace_id text,
      payload jsonb
    )
  `
  await tx`
    create table if not exists audit_logs (
      id text primary key,
      timestamp timestamptz not null,
      actor text not null,
      action text not null,
      resource text not null,
      decision_id text references policy_decisions(id),
      result text not null,
      correlation_id text,
      trace_id text,
      payload jsonb
    )
  `
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
})

await sql.end()
console.log('MVP schema migrated')
