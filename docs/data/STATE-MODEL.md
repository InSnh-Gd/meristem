# State Model

> Meristem must keep authoritative state, event state, cache state, read models, collaborative drafts, and log facts separate.

---

## 1. State Classes

| Class | Carrier | Owns | Must Not Become |
|-------|---------|------|-----------------|
| Authoritative State | PostgreSQL | users, roles, permissions, nodes, service definitions, config versions, secretRefs, M-Task task tables | event-only truth |
| Event State | M-EventBus / NATS | task events, node events, lifecycle events, network events, config publish events | authoritative database |
| Cache State | NATS KV first, Redis / KeyDB if needed | rate limit windows, ephemeral sessions, distributed lock, derived hot state | primary database |
| Read Model | OpenSearch or projection | log search, Timeline aggregation, Audit query, node state board, policy analysis view | source of truth |
| Collaborative Draft State | Yjs or equivalent | config draft collaboration, UI schema draft | authoritative config |
| Log Facts | M-Log | Timeline, Full Log, Audit Log | mutable business state |

---

## 2. Initial Authoritative Entities

| Entity | Owner | Notes |
|--------|-------|-------|
| User | Core / M-Policy | base identity; exact auth provider remains separate |
| Role | M-Policy | RBAC baseline |
| Permission | M-Policy | resource/action/scope based |
| Actor / ActorToken / ActorTokenRevocation | Core | Phase 17 Identity v0.2 local-mode actor and token lifecycle state |
| Node | Core / M-Net | Core registers; M-Net updates reachability |
| NodeCredential | Core | hashed per-node agent credentials |
| Network | M-Net | logical node network owned by M-Net |
| NetworkMembership | M-Net | logical node-to-network membership; real path state remains separate |
| ServiceDefinition | Core | service contract entrypoint |
| ConfigVersion | Core / config subsystem | published config state |
| SecretRef | Core | value storage backend is implementation detail |
| SecretRefVersion / SecretRefTransition | Core | Phase 18 secretRef metadata, local value version, and lifecycle transition state |
| ConfigRecord / ConfigApplyAck / ConfigTransition | Core | Phase 19 generic Config Lifecycle v0.1 authoritative state |
| TaskRequest / TaskTransition / TaskResult / TaskCancellation | M-Task | Phase 11 canonical task lifecycle state |
| PolicyDecision | M-Policy | decision fact; high-risk copies into Audit Log |
| ExtensionDefinition / ExtensionInstance / ExtensionTransition | M-Extension | Phase 15 control-plane registry and `system/default` instance state; no execution runtime state |

The MVP concrete schema is defined in `docs/data/POSTGRES-SCHEMA-MVP.md`.

---

## 3. Read Model Rule

OpenSearch projections may optimize:

- Full Log search
- Audit query
- Timeline aggregation
- M-Net historical path view
- M-Policy behavior analysis view

OpenSearch must never be the only place where authoritative state is stored.

---

## 4. Cache Rule

NATS KV is the default cache. Redis / KeyDB can be introduced only when one of these is required:

- complex cache semantics
- high-frequency rate limit
- complex distributed lock
- sorted set
- special session or ephemeral state
- external component requires Redis protocol

Introducing Redis / KeyDB requires a dependency note and failure behavior.

Phase 16 provides a Redis optional compose profile only. It does not introduce a runtime adapter or move any cache, session, lock, rate-limit, task queue, or coordination state to Redis. KeyDB remains a compatible candidate but has no Phase 16 profile.

---

## 5. Data Change Checklist

Before adding new state, answer:

1. Is this authoritative, event, cache, read model, draft, or log fact?
2. Who owns writes?
3. Who can read it?
4. Does it need versioning?
5. Does it need Audit Log?
6. How does it degrade when storage is unavailable?
7. Does it affect Core / Stem / Leaf compatibility?

---

## 5. Phase 10.1 Projection State Tables

Phase 10.1 Projection Platform Track 新增三张 PostgreSQL 表，均归属 M-Log。

### `projector_jobs`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | job UUID |
| `type` | text | `backfill`, `incremental`, `repair` |
| `index` | text | target OpenSearch index name |
| `start_cursor` | jsonb | `{ factId, timestamp }` or null |
| `end_cursor` | jsonb | `{ factId, timestamp }` or null |
| `batch_size` | integer | documents per batch |
| `status` | text | `pending`, `running`, `completed`, `failed`, `cancelled` |
| `error` | text | failure reason when status is failed |
| `created_at` | timestamptz | UTC |
| `updated_at` | timestamptz | UTC |
| `completed_at` | timestamptz | set on terminal state |

### `projection_cursors`

| Column | Type | Notes |
|--------|------|-------|
| `index` | text primary key | OpenSearch index name, one cursor per index |
| `fact_id` | text | last projected PostgreSQL fact ID |
| `timestamp` | timestamptz | last projected fact timestamp |
| `updated_at` | timestamptz | cursor last advanced at |

### `projection_dlq`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | DLQ record UUID |
| `job_id` | text | originating projector job ID |
| `fact_id` | text | PostgreSQL fact ID that failed projection |
| `index` | text | target OpenSearch index |
| `error` | text | failure reason |
| `attempted_at` | jsonb | ISO8601 timestamp array per retry |
| `retries` | integer | number of retry attempts |
| `created_at` | timestamptz | UTC |

All three tables are authoritative state owned by M-Log and must not be used as cache or event state.

---

## 6. Phase 15 M-Extension State Tables

Phase 15 adds three PostgreSQL authoritative tables owned by M-Extension.

### `extension_definitions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | extension id from manifest |
| `manifest_version` | text | `m-extension-manifest@0.1.0` |
| `kind` | text | declaration kind only |
| `display_name` | text | operator-visible name |
| `owner` | text | manifest owner |
| `license` | text | declared license |
| `manifest` | jsonb | validated governance manifest |
| `declared_capabilities` | jsonb | string array |
| `requested_permissions` | jsonb | known Meristem permissions only |
| `risk_class` | text | `low` or `medium` in Phase 15 |
| `status` | text | `registered`, `rejected`, `deprecated` |
| `registered_by` | text | actor subject |
| `policy_decision_id` | text | M-Policy decision id |
| `correlation_id` | text | optional trace correlation |
| `created_at` | timestamptz | UTC |
| `updated_at` | timestamptz | UTC |

### `extension_instances`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | instance UUID |
| `extension_id` | text | references extension definition |
| `scope_type` | text | only `system` in Phase 15 |
| `scope_id` | text | only `default` in Phase 15 |
| `status` | text | `disabled`, `enabled`, `enable_failed`, `disable_failed` |
| `enabled_by` | text | actor subject when enabled |
| `disabled_by` | text | actor subject when disabled |
| `policy_decision_id` | text | latest M-Policy decision id |
| `correlation_id` | text | optional trace correlation |
| `last_error` | text | failure reason when terminal failure status is set |
| `created_at` | timestamptz | UTC |
| `updated_at` | timestamptz | UTC |
| `enabled_at` | timestamptz | set when enabled |
| `disabled_at` | timestamptz | set when disabled |

### `extension_transitions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | transition UUID |
| `extension_id` | text | extension definition id |
| `instance_id` | text | instance id when transition is instance-scoped |
| `from_status` | text | previous status |
| `to_status` | text | next status |
| `actor` | text | actor subject |
| `reason` | text | optional operator reason |
| `policy_decision_id` | text | M-Policy decision id |
| `correlation_id` | text | optional trace correlation |
| `created_at` | timestamptz | UTC |

These tables must not store executable code, Wasm binaries, raw webhook tokens, secret values, or runtime execution state.

---

## 7. Phase 17 Identity v0.2 State Tables

Core owns these PostgreSQL authoritative tables:

```text
actors
actor_tokens
actor_token_revocations
```

Rules:

- token plaintext is never stored.
- `jti` is the revocation key.
- M-* services must use Core introspection and must not read these tables directly.

---

## 8. Phase 18 SecretRef State Tables

Core owns these PostgreSQL authoritative tables:

```text
secret_refs
secret_ref_versions
secret_ref_transitions
```

Rules:

- metadata must be non-secret.
- secret plaintext must not be returned after create / rotate.
- secret values must not appear in logs, projections, UI errors, LLM prompts, or event payloads.
- production KMS / Vault storage remains deferred.

---

## 9. Phase 19 Config Lifecycle State Tables

Core owns these PostgreSQL authoritative tables:

```text
config_records
config_versions
config_apply_acks
config_transitions
```

Rules:

- configuration state is authoritative in PostgreSQL.
- event subjects notify lifecycle changes but are not the source of truth.
- config payloads must not contain secret plaintext; use `secretRef`.
- OpenSearch may project lifecycle facts but must not become source of truth.

## 7. Phase 12 Approval State Tables

Phase 12 adds three PostgreSQL authoritative tables owned by two services.

### M-Policy-Owned Tables

#### `policy_approvals`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text primary key | approval UUID |
| `policy_decision_id` | text | references `policy_decisions.id` |
| `origin_service` | text | `m-task` in Phase 12 |
| `operation_id` | text | origin operation identifier by convention |
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
| unique | `(approval_id, actor)` | each actor can vote once per approval |

### M-Task-Owned Table

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

`policy_approvals.operation_id` references the origin operation by convention, not by cross-service foreign key. PostgreSQL may be shared, but service ownership remains explicit.
