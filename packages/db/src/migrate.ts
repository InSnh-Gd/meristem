import { createSqlClient } from './client.ts'

const sql = createSqlClient()

await sql.begin(async (tx) => {
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
      status text not null,
      capabilities jsonb not null,
      scope jsonb not null,
      created_at timestamptz not null,
      updated_at timestamptz not null
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
})

await sql.end()
console.log('MVP schema migrated')
