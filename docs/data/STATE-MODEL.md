# State Model

> Meristem must keep authoritative state, event state, cache state, read models, collaborative drafts, and log facts separate.

---

## 1. State Classes

| Class | Carrier | Owns | Must Not Become |
|-------|---------|------|-----------------|
| Authoritative State | PostgreSQL | users, roles, permissions, nodes, service definitions, config versions, secretRefs, M-Task task tables | event-only truth |
| Event State | M-EventBus / NATS | task events, node events, lifecycle events, network events, config publish events | authoritative database |
| Cache State | NATS KV first, Redis / KeyDB if needed | rate limit windows, ephemeral sessions, distributed lock, derived hot state | primary database |
| Read Model | OpenSearch or projection | log search, Timeline aggregation, Audit query, node state board, policy analysis view | authoritative system of record |
| Collaborative Draft State | Yjs or equivalent | config draft collaboration, UI schema draft | authoritative config |
| Log Facts | M-Log | Timeline, Full Log, Audit Log | mutable business state |

---

## 2. Initial Authoritative Entities

| Entity | Owner | Notes |
|--------|-------|-------|
| User | Core / M-Policy | base identity; exact auth provider remains separate |
| Role | M-Policy | RBAC baseline |
| Permission | M-Policy | resource/action/scope based |
| Actor / ActorToken / ActorTokenRevocation | Core | Identity v0.2 local-mode actor and token lifecycle state |
| Node | Core / M-Net | Core registers; M-Net updates reachability |
| NodeCredential | Core | hashed per-node agent credentials |
| Network | M-Net | logical node network owned by M-Net |
| NetworkMembership | M-Net | logical node-to-network membership; real path state remains separate |
| ServiceDefinition | Core | service contract entrypoint |
| ConfigVersion | Core / config subsystem | published config state |
| SecretRef | Core | value storage backend is implementation detail |
| SecretRefVersion / SecretRefTransition | Core | SecretRef v0.1 metadata, local value version, and lifecycle transition state |
| ConfigRecord / ConfigApplyAck / ConfigTransition | Core | Config Lifecycle v0.1 authoritative state |
| TaskRequest / TaskTransition / TaskResult / TaskCancellation | M-Task | canonical task lifecycle state |
| PolicyDecision | M-Policy | decision fact; high-risk copies into Audit Log |
| ExtensionDefinition / ExtensionInstance / ExtensionTransition | M-Extension | M-Extension control-plane registry and `system/default` instance state; no execution runtime state |

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

The optional deployment pack provides a Redis compose profile only. It does not introduce a runtime adapter or move any cache, session, lock, rate-limit, task queue, or coordination state to Redis. KeyDB remains a compatible candidate but has no optional deployment pack profile.

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

## 6. Projection Platform State Ownership

The Projection Platform adds three PostgreSQL tables, all owned by M-Log:

```text
projector_jobs
projection_cursors
projection_dlq
```

Ownership rules:

- these tables are authoritative state owned by M-Log
- they must not be used as cache or event state
- the concrete column definitions live in `POSTGRES-SCHEMA-MVP.md`

---

## 7. M-Extension Control Plane State Ownership

M-Extension owns these PostgreSQL authoritative tables:

```text
extension_definitions
extension_instances
extension_transitions
```

Ownership rules:

- these tables must not store executable code, Wasm binaries, raw webhook tokens, secret values, or runtime execution state
- `scopeType` / `scopeId` remain bounded to `system/default` in the current baseline
- the concrete column definitions live in `POSTGRES-SCHEMA-MVP.md`

---

## 8. Identity v0.2 State Ownership

Core owns these PostgreSQL authoritative tables:

```text
actors
actor_tokens
actor_token_revocations
```

Rules:

- token plaintext is never stored.
- `jti` is the revocation key.
- Capability domain services must use Core introspection and must not read these tables directly.
- the concrete column definitions live in `POSTGRES-SCHEMA-MVP.md`.

---

## 9. SecretRef v0.1 State Ownership

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
- the concrete column definitions live in `POSTGRES-SCHEMA-MVP.md`.

---

## 10. Config Lifecycle v0.1 State Ownership

Core owns these PostgreSQL authoritative tables:

```text
config_records
config_versions
config_apply_acks
config_transitions
```

Rules:

- configuration state is authoritative in PostgreSQL.
- event subjects notify lifecycle changes but do not replace PostgreSQL as the authoritative state.
- config payloads must not contain secret plaintext; use `secretRef`.
- OpenSearch may project lifecycle facts but must not become the canonical authority.
- the concrete column definitions live in `POSTGRES-SCHEMA-MVP.md`.

## 11. Approval State Ownership

Approval flow adds three PostgreSQL authoritative tables owned by two services.

M-Policy-owned tables:

```text
policy_approvals
policy_approval_votes
```

M-Task-owned table:

```text
task_suspended_operations
```

Ownership rules:

- `policy_approvals.operation_id` references the origin operation by convention, not by cross-service foreign key
- PostgreSQL may be shared, but service ownership remains explicit
- the concrete column definitions live in `POSTGRES-SCHEMA-MVP.md`
