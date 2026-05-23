# PostgreSQL Schema MVP

> PostgreSQL is the authoritative state source for the MVP. This document defines the minimum logical schema; implementation may use migrations generated from these definitions.

---

## 1. Naming Rules

- Table names use snake_case plural nouns.
- IDs use text UUIDs unless implementation standardizes a UUID type.
- Timestamps use UTC.
- JSON payload fields use `jsonb`.
- Version fields are text semver strings unless specified otherwise.

---

## 2. Tables

MVP uses one PostgreSQL database. Services own table groups but do not get separate databases:

| Owner | Tables |
|-------|--------|
| Core | `nodes`, `node_credentials`, `service_definitions`, `tasks` |
| M-Net | `networks`, `network_memberships` |
| M-Policy | `users`, `roles`, `permissions`, `user_roles`, `role_permissions`, `policy_decisions` |
| M-Log | `timeline_logs`, `full_logs`, `audit_logs`, `projector_jobs`, `projection_cursors`, `projection_dlq` | Phase 10.1 投影平台表

### `users`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | actor ID |
| `display_name` | text | human label |
| `created_at` | timestamptz | UTC |

### `roles`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | `viewer`, `operator`, `admin`, `security-admin` |
| `description` | text | |

### `permissions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | e.g. `node:register` |
| `description` | text | |

### `user_roles`

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | text | references `users.id` |
| `role_id` | text | references `roles.id` |

### `role_permissions`

| Column | Type | Notes |
|--------|------|-------|
| `role_id` | text | references `roles.id` |
| `permission_id` | text | references `permissions.id` |

### `nodes`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | node ID |
| `kind` | text | `core`, `stem`, `leaf` |
| `name` | text | display name |
| `mode` | text | `agent` or `simulated` |
| `status` | text | `joining`, `healthy`, `degraded`, `offline`, `revoked` |
| `reachability` | text | `unknown`, `reachable`, `unreachable` |
| `last_seen_at` | timestamptz nullable | last accepted heartbeat |
| `agent_version` | text nullable | latest reported node-agent version |
| `capabilities` | jsonb | string array |
| `scope` | jsonb | string array |
| `created_at` | timestamptz | UTC |
| `updated_at` | timestamptz | UTC |

### `node_credentials`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | credential row ID |
| `node_id` | text | references `nodes.id` |
| `token_hash` | text | opaque token hash only |
| `status` | text | `active` or `revoked` |
| `issued_at` | timestamptz | UTC |
| `revoked_at` | timestamptz nullable | UTC |
| `last_used_at` | timestamptz nullable | UTC |

### `node_join_tickets`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | ticket row ID |
| `ticket_hash` | text | opaque Join Ticket hash only |
| `kind` | text | `stem` or `leaf` |
| `name` | text | fixed join-time node name |
| `capabilities` | jsonb | requested capability list |
| `status` | text | `active`, `redeemed`, `expired`, `revoked` |
| `expires_at` | timestamptz | UTC |
| `created_by` | text | issuing actor ID |
| `created_at` | timestamptz | UTC |
| `redeemed_at` | timestamptz nullable | UTC |
| `redeemed_node_id` | text nullable | references `nodes.id` |

### `service_definitions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | service name |
| `version` | text | service definition version |
| `domain` | text | service domain |
| `kind` | text | service kind |
| `definition` | jsonb | full service definition |
| `created_at` | timestamptz | UTC |
| `updated_at` | timestamptz | UTC |

### `tasks`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | task ID |
| `leaf_node_id` | text | references `nodes.id` |
| `type` | text | MVP supports `noop` |
| `status` | text | `requested`, `completed`, `failed` |
| `created_at` | timestamptz | UTC |
| `completed_at` | timestamptz nullable | UTC |

### `networks`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | network ID |
| `name` | text unique | logical network name |
| `profile_version` | text | defaults to `m-net-default@0.1.0` |
| `status` | text | `active` |
| `created_at` | timestamptz | UTC |
| `updated_at` | timestamptz | UTC |

### `network_memberships`

| Column | Type | Notes |
|--------|------|-------|
| `network_id` | text | references `networks.id` |
| `node_id` | text | references `nodes.id` |
| `membership_mode` | text | `full` or `restricted` |
| `status` | text | `joined` |
| `joined_at` | timestamptz | UTC |
| `updated_at` | timestamptz | UTC |

### `policy_decisions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | decision ID |
| `actor` | text | user ID or system actor |
| `action` | text | action string |
| `resource` | text | resource string |
| `result` | text | `allow`, `deny`, or require result |
| `reasons` | jsonb | string array |
| `created_at` | timestamptz | UTC |

### `timeline_logs`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | log ID |
| `timestamp` | timestamptz | UTC |
| `summary` | text | human-readable |
| `subject` | text nullable | related entity |
| `correlation_id` | text nullable | |

### `full_logs`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | log ID |
| `timestamp` | timestamptz | UTC |
| `level` | text | `debug`, `info`, `warn`, `error` |
| `source` | text | service or subsystem |
| `message` | text | |
| `correlation_id` | text nullable | |
| `trace_id` | text nullable | |
| `payload` | jsonb nullable | secrets forbidden |

### `audit_logs`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | audit ID |
| `timestamp` | timestamptz | UTC |
| `actor` | text | user or system actor |
| `action` | text | action string |
| `resource` | text | resource string |
| `decision_id` | text nullable | references `policy_decisions.id` |
| `result` | text | policy or audit result |
| `correlation_id` | text nullable | |
| `trace_id` | text nullable | |
| `payload` | jsonb nullable | secrets forbidden |

---

## 3. Seed Data

MVP seed users:

| User | Role |
|------|------|
| `viewer` | `viewer` |
| `operator` | `operator` |
| `admin` | `admin` |
| `security-admin` | `security-admin` |

MVP seed permissions:

```text
core:read
node:register
node:issue-token
network:read
network:create
network:join
task:assign
timeline:read
log:read-full
audit:read
service:register
```

---

## 4. Constraints

- Audit payloads must not contain secrets.
- Full Log payloads must not contain secrets.
- Leaf nodes must be stored with restricted defaults.
- node credential plaintext must never be stored.
- Logical network names must be unique.
- A network membership must be unique per `network_id` + `node_id`.
- Core node records are system-managed.
- Task target must be an existing Leaf node.

## 5. Migration Rules

- Drizzle schema is the source for table shape.
- `bun run db:migrate` creates or updates the MVP schema.
- `bun run db:seed` inserts seed actors, roles, permissions, and role mappings idempotently.
- Migration order must create M-Policy tables before protected operations can run.
