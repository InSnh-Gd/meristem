# PostgreSQL Schema MVP

> PostgreSQL is the authoritative state source for the MVP. This document records the current table shape implemented in `packages/db/src/schema.ts` and `packages/db/src/migrate.ts`, and the drift contract keeps the document aligned with those files. If implementation changes first, update this document in the same change so the docs set stays explicit and current.

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
| Core | `nodes`, `node_credentials`, `node_join_tickets`, `service_definitions`, `tasks` (historical compatibility table), `actors`, `actor_tokens`, `actor_token_revocations` |
| M-Net | `networks`, `network_memberships`, `mnet_profile_definitions`, `mnet_network_profile_states`, `mnet_profile_transitions`, `mnet_suspended_operations`, `mnet_global_defaults`, `mnet_profile_switch_operations`, `mnet_profile_switch_batches`, `mnet_profile_switch_batch_members`, `mnet_profile_switch_results`, `mnet_profile_switch_snapshots`, `mnet_profile_default_set_results`, `mnet_profile_disable_policies`, `mnet_profile_migrations`, `mnet_network_map_renders`, `mnet_node_public_keys`, `mnet_tunnel_address_allocations`, `mnet_relay_assignments`, `mnet_data_plane_operation_locks`, `mnet_sidecar_desired_configs`, `mnet_partition_states` |
| M-Task | `task_definitions`, `task_requests`, `task_transitions`, `task_results`, `task_cancellations`, `task_suspended_operations` |
| M-Extension | `extension_definitions`, `extension_instances`, `extension_transitions` |
| M-Policy | `users`, `roles`, `permissions`, `user_roles`, `role_permissions`, `policy_decisions`, `policy_approvals`, `policy_approval_votes` |
| Core (SecretRef boundary) | `secret_refs`, `secret_ref_versions`, `secret_ref_transitions` |
| M-Config | `config_records`, `config_versions`, `config_transitions`, `config_apply_acks` |
| M-Log | `timeline_logs`, `full_logs`, `audit_logs`, `projector_jobs`, `projection_cursors`, `projection_dlq` |

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
| `status` | text | `ready`, `joining`, `healthy`, `degraded`, `offline`, `disabled`, `isolated`, `recovering`, `revoked` |
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

### Identity v0.2 Hardening Tables

#### `actors`

Core-owned actor registry for local-mode identity hardening.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | actor ID |
| `display_name` | text | human label |
| `status` | text | actor lifecycle status |
| `created_at` | timestamptz | UTC |
| `updated_at` | timestamptz | UTC |

#### `actor_tokens`

Core-issued actor bearer token lifecycle, scoped by JTI.

| Column | Type | Notes |
|--------|------|-------|
| `jti` | text primary key | token JWT ID |
| `actor_id` | text | references `actors.id` |
| `issuer` | text | token issuer |
| `audience` | text | token audience |
| `issued_at` | timestamptz | UTC |
| `expires_at` | timestamptz | UTC |
| `issued_by` | text | issuing actor ID |
| `purpose` | text | token purpose label |
| `status` | text | token lifecycle status |
| `created_at` | timestamptz | UTC |
| `updated_at` | timestamptz | UTC |

Unique index: `actor_tokens_jti_unique` on `jti`.

#### `actor_token_revocations`

Permanent token revocation records.

| Column | Type | Notes |
|--------|------|-------|
| `jti` | text primary key | references `actor_tokens.jti` |
| `revoked_at` | timestamptz | UTC |
| `revoked_by` | text | revoking actor ID |
| `reason` | text | revocation reason |
| `correlation_id` | text nullable | request correlation |

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

Historical compatibility table.

M-Task cutover moves canonical task lifecycle state to M-Task-owned tables. `tasks` remains only for pre-cutover compatibility and must not be used as the canonical task state source.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | task ID |
| `leaf_node_id` | text | references `nodes.id` |
| `type` | text | MVP supports `noop` |
| `status` | text | `requested`, `completed`, `failed` |
| `created_at` | timestamptz | UTC |
| `completed_at` | timestamptz nullable | UTC |

### `task_definitions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | task definition ID |
| `type` | text | MVP supports `noop` |
| `version` | text | definition version, e.g. `v0` |
| `description` | text | operator-facing summary |
| `danger_level` | text | `low`, `medium`, `high`, or `critical` |
| `default_timeout_seconds` | integer | default timeout |
| `created_at` | timestamptz | UTC |
| `updated_at` | timestamptz | UTC |

### `task_requests`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | task request ID |
| `definition_id` | text | references `task_definitions.id` |
| `node_id` | text | references `nodes.id` |
| `type` | text | task type |
| `status` | text | `accepted`, `queued`, `dispatched`, `running`, `completed`, `failed`, `cancel_requested`, `canceled`, `timed_out` |
| `requested_by` | text | actor ID |
| `policy_decision_id` | text nullable | references `policy_decisions.id` |
| `correlation_id` | text nullable | request correlation |
| `risk` | jsonb | operation danger level, suspicion score, and risk factors |
| `timeout_at` | timestamptz nullable | task deadline |
| `created_at` | timestamptz | UTC |
| `updated_at` | timestamptz | UTC |
| `completed_at` | timestamptz nullable | UTC |
| `canceled_at` | timestamptz nullable | UTC |

### `task_transitions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | transition row ID |
| `task_id` | text | references `task_requests.id` |
| `from_status` | text nullable | previous state |
| `to_status` | text | next state |
| `reason` | text nullable | transition cause |
| `correlation_id` | text nullable | request correlation |
| `created_at` | timestamptz | UTC |

### `task_results`

| Column | Type | Notes |
|--------|------|-------|
| `task_id` | text primary key | references `task_requests.id` |
| `status` | text | terminal result status |
| `payload` | jsonb nullable | non-secret result payload |
| `error` | text nullable | failure summary |
| `completed_at` | timestamptz | UTC |

### `task_cancellations`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | cancellation row ID |
| `task_id` | text | references `task_requests.id` |
| `requested_by` | text | actor ID |
| `status` | text | cancellation lifecycle status |
| `correlation_id` | text nullable | request correlation |
| `requested_at` | timestamptz | UTC |
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

### M-Net Profile Lifecycle Tables

#### `mnet_profile_definitions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | profile definition ID |
| `profile_version` | text | e.g. `m-net-default@0.1.0`, `m-net-cn@0.1.0` |
| `region` | text | regional scope |
| `schema_version` | text | profile schema version |
| `definition` | jsonb | full profile definition with rules and capabilities |
| `status` | text | `available` |
| `created_at` | timestamptz | UTC |
| `updated_at` | timestamptz | UTC |

#### `mnet_network_profile_states`

| Column | Type | Notes |
|--------|------|-------|
| `network_id` | text | references `networks.id` |
| `profile_version` | text | applied profile version |
| `status` | text | `disabled`, `enabling`, `enabled`, `disabling`, `failed` |
| `enabled_by` | text | actor ID |
| `policy_decision_id` | text | references `policy_decisions.id` |
| `correlation_id` | text nullable | request correlation |
| `applied_at` | timestamptz nullable | when profile was applied |
| `disabled_at` | timestamptz nullable | when profile was disabled |
| `last_error` | text nullable | last error message |
| `updated_at` | timestamptz | UTC |

#### `mnet_profile_transitions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | transition row ID |
| `network_id` | text | references `networks.id` |
| `from_profile_version` | text nullable | previous profile version |
| `to_profile_version` | text | target profile version |
| `from_status` | text nullable | previous state |
| `to_status` | text | target state |
| `actor` | text | actor ID |
| `reason` | text nullable | transition cause |
| `policy_decision_id` | text | references `policy_decisions.id` |
| `correlation_id` | text nullable | request correlation |
| `created_at` | timestamptz | UTC |

#### `mnet_suspended_operations`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | suspended operation UUID |
| `policy_decision_id` | text | references `policy_decisions.id` |
| `action` | text | `profile.enable` |
| `network_id` | text | references `networks.id` |
| `from_profile_version` | text | current profile version |
| `to_profile_version` | text | requested profile version |
| `requested_by` | text | actor ID |
| `reason` | text | operator reason |
| `correlation_id` | text | request correlation |
| `idempotency_key` | text | prevents duplicate resume |
| `status` | text | `suspended`, `resumed`, `resume_failed`, `expired` |
| `expires_at` | timestamptz | UTC |
| `created_at` | timestamptz | UTC |
| `resumed_at` | timestamptz nullable | set when resumed |
| `terminal_reason` | text nullable | expiration or error reason |

`networks.profile_version` remains the operator-visible current profile for a network. The M-Net profile state table records lifecycle metadata around that profile assignment.

### M-Net Profile Switching Tables

#### `mnet_global_defaults`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | singleton row ID |
| `default_profile_version` | text | default profile version for new networks |
| `switch_state` | text | global switch operation state |
| `switch_operation_id` | text nullable | active switch operation reference |
| `updated_at` | timestamptz | UTC |

#### `mnet_profile_switch_operations`

| Column | Type | Notes |
|--------|------|-------|
| `operation_id` | text primary key | switch operation ID |
| `idempotency_key` | text unique | idempotency key |
| `target_profile_version` | text | target profile version for the switch |
| `batch_size` | integer | networks per batch |
| `reason` | text | operator reason |
| `state` | text | operation lifecycle state |
| `current_batch_id` | integer nullable | current executing batch |
| `created_at` | timestamptz | UTC |
| `updated_at` | timestamptz | UTC |

#### `mnet_profile_switch_batches`

| Column | Type | Notes |
|--------|------|-------|
| `operation_id` | text | references `mnet_profile_switch_operations.operation_id` |
| `batch_id` | integer | batch sequence number |

Primary key: `(operation_id, batch_id)`.

#### `mnet_profile_switch_batch_members`

| Column | Type | Notes |
|--------|------|-------|
| `operation_id` | text | references `mnet_profile_switch_operations.operation_id` |
| `batch_id` | integer | batch sequence number |
| `network_id` | text | references `networks.id` |

Primary key: `(operation_id, batch_id, network_id)`.

#### `mnet_profile_switch_results`

| Column | Type | Notes |
|--------|------|-------|
| `operation_id` | text | references `mnet_profile_switch_operations.operation_id` |
| `network_id` | text | references `networks.id` |
| `previous_profile_version` | text | profile version before switch |
| `target_profile_version` | text | target profile version |
| `status` | text | switch result status |
| `reason` | text nullable | failure or skip reason |
| `audit_id` | text nullable | audit record reference |
| `correlation_id` | text nullable | request correlation |

Primary key: `(operation_id, network_id)`.

#### `mnet_profile_switch_snapshots`

| Column | Type | Notes |
|--------|------|-------|
| `operation_id` | text | references `mnet_profile_switch_operations.operation_id` |
| `network_id` | text | references `networks.id` |
| `previous_profile_version` | text | profile version snapshot |

Primary key: `(operation_id, network_id)`.

#### `mnet_profile_default_set_results`

| Column | Type | Notes |
|--------|------|-------|
| `idempotency_key` | text primary key | idempotency key |
| `operation_id` | text | originating operation ID |
| `policy_decision_id` | text | references `policy_decisions.id` |
| `audit_id` | text | audit record reference |

#### `mnet_profile_disable_policies`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | policy row ID |
| `require_approval` | text | approval requirement setting |
| `emergency_break_glass_enabled` | text | break-glass override flag |
| `reason` | text | policy reason |
| `idempotency_key` | text | idempotency key |
| `updated_at` | timestamptz | UTC |

### M-Net Data Plane Tables

M-Net data plane tables store authoritative metadata for node-to-node connectivity, tunnel addressing, relay assignments, and operational locks. They do not store WireGuard private keys or packet forwarding state.

#### `mnet_profile_migrations`

| Column | Type | Notes |
|--------|------|-------|
| `network_id` | text | references `networks.id` |
| `operation_id` | text | migration operation ID |
| `from_version` | text | previous profile version |
| `to_version` | text | target profile version |
| `status` | text | migration lifecycle status |
| `idempotency_key` | text | idempotency key |
| `started_at` | timestamptz | UTC |
| `completed_at` | timestamptz nullable | UTC |
| `audit_metadata` | jsonb | audit metadata |

Primary key: `(network_id, operation_id)`.

#### `mnet_network_map_renders`

| Column | Type | Notes |
|--------|------|-------|
| `network_id` | text | references `networks.id` |
| `map_version` | integer | monotonic render version |
| `profile_version` | text | profile version used for render |
| `map_json` | jsonb | rendered network map |
| `signature_metadata` | jsonb | signing metadata |
| `expires_at` | timestamptz | UTC |
| `published_at` | timestamptz | UTC |

Primary key: `(network_id, map_version)`.

#### `mnet_node_public_keys`

| Column | Type | Notes |
|--------|------|-------|
| `node_id` | text | references `nodes.id` |
| `key_id` | text | key identifier |
| `public_key` | text | node public key |
| `fingerprint` | text unique | key fingerprint |
| `algorithm` | text | key algorithm |
| `created_at` | timestamptz | UTC |
| `rotated_at` | timestamptz nullable | last rotation |
| `rotation_due_at` | timestamptz nullable | next rotation deadline |
| `rotation_counter` | integer | rotation count |
| `status` | text | key lifecycle status |
| `endpoint` | text | STUN-discovered public WireGuard endpoint (e.g. `203.0.113.5:51820`); nullable, omitted when no direct P2P endpoint is available |

Primary key: `(node_id, key_id)`.

#### `mnet_tunnel_address_allocations`

| Column | Type | Notes |
|--------|------|-------|
| `network_id` | text | references `networks.id` |
| `node_id` | text | references `nodes.id` |
| `subnet_cidr` | text | assigned subnet |
| `tunnel_ip` | text | unique within network |
| `allocated_at` | timestamptz | UTC |

Primary key: `(network_id, node_id)`.
Unique index: `(network_id, tunnel_ip)`.

#### `mnet_relay_assignments`

| Column | Type | Notes |
|--------|------|-------|
| `network_id` | text | references `networks.id` |
| `relay_id` | text | references `nodes.id` |
| `relay_type` | text | relay role type |
| `endpoint` | text | relay endpoint address |
| `assigned_at` | timestamptz | UTC |

Primary key: `(network_id, relay_id)`.

#### `mnet_data_plane_operation_locks`

| Column | Type | Notes |
|--------|------|-------|
| `operation_id` | text primary key | lock operation ID |
| `network_id` | text | references `networks.id` |
| `operation_type` | text | lock operation type |
| `idempotency_key` | text nullable | idempotency key |
| `acquired_at` | timestamptz | UTC |
| `expires_at` | timestamptz | UTC |
| `status` | text | lock lifecycle status |
| `lock_row_id` | text unique | unique lock row identifier |
| `fencing_token` | integer | fencing token |
| `updated_at` | timestamptz | UTC |

#### `mnet_sidecar_desired_configs`

| Column | Type | Notes |
|--------|------|-------|
| `node_id` | text primary key | references `nodes.id` |
| `config_hash` | text | desired config hash |
| `desired_at` | timestamptz | UTC |
| `applied_at` | timestamptz nullable | UTC |

#### `mnet_partition_states`

| Column | Type | Notes |
|--------|------|-------|
| `network_id` | text primary key | references `networks.id` |
| `state` | text | partition state |
| `reason` | jsonb | partition reason |
| `transitioned_at` | timestamptz | UTC |
| `previous_state` | text nullable | previous partition state |

### M-Extension Control Plane Tables

#### `extension_definitions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | extension ID from the manifest |
| `manifest_version` | text | `m-extension-manifest@0.1.0` |
| `kind` | text | control-plane declaration kind only |
| `display_name` | text | operator-visible name |
| `owner` | text | manifest owner |
| `license` | text | declared license |
| `manifest` | jsonb | validated governance manifest; no executable code or secret payloads |
| `declared_capabilities` | jsonb | string array |
| `requested_permissions` | jsonb | known Meristem permissions only |
| `risk_class` | text | `low` or `medium` |
| `status` | text | `registered`, `rejected`, `deprecated` |
| `registered_by` | text | actor subject |
| `policy_decision_id` | text | references `policy_decisions.id` |
| `correlation_id` | text | request correlation |
| `created_at` | timestamptz | UTC |
| `updated_at` | timestamptz | UTC |

#### `extension_instances`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | instance UUID |
| `extension_id` | text | references `extension_definitions.id` |
| `scope_type` | text | only `system` |
| `scope_id` | text | only `default` |
| `status` | text | `disabled`, `enabled`, `enable_failed`, `disable_failed` |
| `enabled_by` | text nullable | actor subject when enabled |
| `disabled_by` | text nullable | actor subject when disabled |
| `policy_decision_id` | text nullable | references `policy_decisions.id` |
| `correlation_id` | text nullable | request correlation |
| `last_error` | text nullable | failure reason when failure status is set |
| `created_at` | timestamptz | UTC |
| `updated_at` | timestamptz | UTC |
| `enabled_at` | timestamptz nullable | set when enabled |
| `disabled_at` | timestamptz nullable | set when disabled |

Unique constraint: `(extension_id, scope_type, scope_id)` — M-Extension control plane permits one `system/default` instance per extension definition.

#### `extension_transitions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | transition UUID |
| `extension_id` | text | references `extension_definitions.id` |
| `instance_id` | text nullable | references `extension_instances.id` when instance-scoped |
| `from_status` | text nullable | previous status |
| `to_status` | text | next status |
| `actor` | text | actor subject |
| `reason` | text nullable | optional operator reason |
| `policy_decision_id` | text | references `policy_decisions.id` |
| `correlation_id` | text | request correlation |
| `created_at` | timestamptz | UTC |

M-Extension tables are authoritative for extension definition and instance state. They must not store executable code, Wasm binaries, raw webhook tokens, secret values, or runtime execution state.

### SecretRef v0.1 Tables

#### `secret_refs`

Control-plane secret reference registry. Secret values are never stored here; only metadata and version pointers are kept.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | secret reference ID |
| `name` | text | operator-visible secret name |
| `scope` | text | secret scope |
| `status` | text | lifecycle status |
| `created_by` | text | creating actor ID |
| `created_at` | timestamptz | UTC |
| `updated_at` | timestamptz | UTC |
| `metadata` | jsonb | non-secret metadata |

#### `secret_ref_versions`

Versioned secret ciphertext for a secret reference.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | version row ID |
| `secret_ref_id` | text | references `secret_refs.id` |
| `version` | text | version label |
| `value_ciphertext` | text | encrypted secret value |
| `created_by` | text | creating actor ID |
| `created_at` | timestamptz | UTC |
| `disabled_at` | timestamptz nullable | set when version is disabled |

#### `secret_ref_transitions`

Lifecycle transition audit for secret references.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | transition row ID |
| `secret_ref_id` | text | references `secret_refs.id` |
| `from_status` | text | previous status |
| `to_status` | text | next status |
| `actor` | text | actor ID |
| `reason` | text nullable | transition cause |
| `policy_decision_id` | text nullable | references `policy_decisions.id` |
| `correlation_id` | text nullable | request correlation |
| `created_at` | timestamptz | UTC |

### Config Lifecycle v0.1 Tables

#### `config_records`

Top-level config lifecycle record. Tracks draft, publish, apply, and rollback states.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | config record ID |
| `config_version` | text | config semantic version |
| `schema_version` | text | config schema version |
| `config_hash` | text | hash of the canonical config payload |
| `domain` | text | config domain |
| `target_scope` | jsonb | scope selector |
| `status` | text | lifecycle status |
| `payload` | jsonb | canonical config payload |
| `created_by` | text | creating actor ID |
| `created_at` | timestamptz | UTC |
| `published_by` | text nullable | publishing actor ID |
| `published_at` | timestamptz nullable | UTC |
| `rollback_version` | text nullable | previous version to roll back to |
| `updated_at` | timestamptz | UTC |

#### `config_versions`

Immutable published versions of a config record.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | version row ID |
| `config_id` | text | references `config_records.id` |
| `version` | text | version label |
| `config_hash` | text | hash of the version payload |
| `payload` | jsonb | version payload |
| `status` | text | version status |
| `created_by` | text | creating actor ID |
| `created_at` | timestamptz | UTC |

#### `config_transitions`

Config status transition audit.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | transition row ID |
| `config_id` | text | references `config_records.id` |
| `from_status` | text | previous status |
| `to_status` | text | next status |
| `actor` | text | actor ID |
| `reason` | text nullable | transition cause |
| `policy_decision_id` | text nullable | references `policy_decisions.id` |
| `correlation_id` | text nullable | request correlation |
| `created_at` | timestamptz | UTC |

#### `config_apply_acks`

Per-target-service apply acknowledgement tracking.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | ack row ID |
| `config_id` | text | references `config_records.id` |
| `version` | text | config version being applied |
| `target_service` | text | service that must acknowledge |
| `status` | text | ack lifecycle status |
| `error` | text nullable | failure reason |
| `acked_at` | timestamptz nullable | UTC |
| `expires_at` | timestamptz nullable | UTC |
| `created_at` | timestamptz | UTC |

Unique index: `config_apply_acks_service_unique` on `(config_id, target_service)`.

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

### Projection Platform Tables

#### `projector_jobs`

Projection job lifecycle.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | job ID |
| `type` | text | `backfill`, `incremental`, or `repair` |
| `index` | text | target OpenSearch index |
| `start_cursor` | jsonb nullable | starting cursor |
| `end_cursor` | jsonb nullable | ending cursor |
| `batch_size` | integer | facts processed per batch |
| `status` | text | `pending`, `running`, `completed`, `failed`, or `cancelled` |
| `error` | text nullable | failure reason |
| `created_at` | timestamptz | UTC |
| `updated_at` | timestamptz | UTC |
| `completed_at` | timestamptz nullable | UTC |

#### `projection_cursors`

Per-index projection cursor checkpoint.

| Column | Type | Notes |
|--------|------|-------|
| `index` | text primary key | OpenSearch index name |
| `fact_id` | text | last projected fact ID |
| `timestamp` | timestamptz | UTC of the last projected fact |
| `updated_at` | timestamptz | UTC |

#### `projection_dlq`

Projection dead-letter queue for failed facts.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | DLQ row ID |
| `job_id` | text | originating projector job ID |
| `fact_id` | text | failed fact ID |
| `index` | text | target OpenSearch index |
| `error` | text | failure reason |
| `attempted_at` | jsonb | ISO8601 string array of retry timestamps |
| `retries` | integer | retry count |
| `created_at` | timestamptz | UTC |

### Approval Flow Tables

#### `policy_approvals`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | approval UUID |
| `policy_decision_id` | text | references `policy_decisions.id` |
| `origin_service` | text | `m-task` |
| `operation_id` | text | origin operation by convention |
| `requested_by` | text | actor who triggered the blocked operation |
| `required_action` | text | `manual_review` or `multi_approval` |
| `status` | text | `pending`, `approved`, `rejected`, `expired`, `canceled` |
| `quorum_required` | integer | 1 for manual review, 2 for multi-approval |
| `expires_at` | timestamptz | UTC |
| `created_at` | timestamptz | UTC |
| `updated_at` | timestamptz | UTC |
| `completed_at` | timestamptz nullable | set on terminal state |

#### `policy_approval_votes`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | vote UUID |
| `approval_id` | text | references `policy_approvals.id` |
| `actor` | text | voter actor ID |
| `vote` | text | `approve` or `reject` |
| `reason` | text nullable | optional operator reason |
| `created_at` | timestamptz | UTC |

Unique constraint: `(approval_id, actor)` — each actor can vote once per approval.

#### `task_suspended_operations`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | suspended operation UUID |
| `policy_decision_id` | text | references `policy_decisions.id` |
| `action` | text | `task.submit`, `task.cancel`, or `task.retry` |
| `requested_by` | text | actor who triggered the operation |
| `resource` | text | target resource identifier |
| `sanitized_payload` | jsonb | operation context without secrets |
| `correlation_id` | text | request correlation |
| `idempotency_key` | text | prevents duplicate resume |
| `status` | text | `suspended`, `resumed`, `rejected`, `expired`, `resume_failed` |
| `expires_at` | timestamptz | UTC |
| `created_at` | timestamptz | UTC |
| `resumed_at` | timestamptz nullable | set when resumed |
| `terminal_reason` | text nullable | rejection, expiration, or error reason |

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
network:profile-read
network:profile-enable
network:profile-disable
extension:read
extension:register
extension:enable
extension:disable
task:submit
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
- M-Task-owned task tables are the canonical task lifecycle source after M-Task cutover.

## 5. Migration Rules

- Drizzle schema is the source for table shape.
- `bun run db:migrate` creates or updates the MVP schema.
- `bun run db:seed` inserts seed actors, roles, permissions, and role mappings idempotently.
- Migration order must create M-Policy tables before protected operations can run.
