# M-EventBus Service Definition

## 1. Identity

| Field | Value |
|-------|-------|
| name | `m-eventbus` |
| version | `0.1.0` |
| domain | `m-eventbus` |
| kind | `internal` |

---

## 2. Responsibility

M-EventBus owns event, command, synchronization, and interconnect-information flow. It does not own authoritative state and must not become log storage.

Owns:

- NATS connection management
- event envelope validation
- event schema version enforcement
- command / event subject conventions
- correlationId and causationId propagation
- service lifecycle event routing
- node state event routing
- M-Net interconnect information events

Must not own:

- authoritative node state
- audit evidence
- long-term log storage
- M-Net actual routing decisions

---

## 3. Contracts

| Contract | Path / Subject | Version | Notes |
|----------|----------------|---------|-------|
| Event envelope | `MEventEnvelope` | `v0` | Defined in `MERISTEM-DEV.md §二.2.3` |
| NATS subjects | `docs/events/EVENT-CATALOG.md` | `v0` | All published subjects must be listed |
| Eden | `@meristem/contracts/m-eventbus` | `0.1.0` | Internal management APIs |

---

## 4. Failure Behavior

| Failure | Behavior |
|---------|----------|
| NATS unavailable | event-dependent capabilities degrade; critical state writes cannot depend only on event publish |
| schema validation fails | reject event, write Full Log, optionally Audit if high-risk |
| subscriber unavailable | retry according to subject policy; emit delivery failure event if applicable |
| duplicate event | consumers must handle idempotency by `id` or domain key |

---

## 5. Done Criteria

- Core can publish an event.
- Example service can subscribe to an event.
- Events include `id`, `type`, `version`, `source`, `timestamp`, and `payload`.
- `correlationId` is propagated where available.
- Event schema tests cover valid, invalid, and version-mismatch payloads.
