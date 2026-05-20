# State Model

> Meristem must keep authoritative state, event state, cache state, read models, collaborative drafts, and log facts separate.

---

## 1. State Classes

| Class | Carrier | Owns | Must Not Become |
|-------|---------|------|-----------------|
| Authoritative State | PostgreSQL | users, roles, permissions, nodes, service definitions, config versions, secretRefs, tasks | event-only truth |
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
| TaskRecord | Core or task service | v0 minimal task assignment |
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
