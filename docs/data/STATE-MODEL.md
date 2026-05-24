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
| Node | Core / M-Net | Core registers; M-Net updates reachability |
| NodeCredential | Core | hashed per-node agent credentials |
| Network | M-Net | logical node network owned by M-Net |
| NetworkMembership | M-Net | logical node-to-network membership; real path state remains separate |
| ServiceDefinition | Core | service contract entrypoint |
| ConfigVersion | Core / config subsystem | published config state |
| SecretRef | Core | value storage backend is implementation detail |
| TaskRequest / TaskTransition / TaskResult / TaskCancellation | M-Task | Phase 11 canonical task lifecycle state |
| PolicyDecision | M-Policy | decision fact; high-risk copies into Audit Log |

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
