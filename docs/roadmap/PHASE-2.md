# Phase 2 - M-EventBus Minimum Event Loop

> Goal: connect Core to real NATS and establish versioned event publication for Core lifecycle and service registration.

---

## 1. Scope

Phase 2 includes:

- NATS connection module.
- `MEventEnvelope` type and validator.
- subject naming helper.
- event schema version checks.
- correlationId and causationId propagation.
- Core lifecycle events.
- service registration events.
- event contract tests.

Phase 2 excludes:

- durable dead-letter queue.
- advanced retry policies.
- OpenSearch projections.
- cross-node event mesh.

---

## 2. Target Files

Expected implementation areas:

```text
packages/events/
packages/contracts/
apps/core/
services/m-eventbus/
```

---

## 3. Required Events

Defined in `docs/events/EVENT-CATALOG.md`:

- `core.lifecycle.started.v0`
- `core.lifecycle.degraded.v0`
- `service.lifecycle.registered.v0`

---

## 4. Completion Criteria

- Core publishes `core.lifecycle.started.v0` on startup.
- Dependency degradation publishes `core.lifecycle.degraded.v0`.
- Service registration publishes `service.lifecycle.registered.v0`.
- Every event has `id`, `type`, `version`, `source`, `timestamp`, and `payload`.
- Contract tests reject missing required envelope fields.
- Event consumers tolerate duplicate event IDs in tests.

---

## 5. Verification Checklist

```bash
bun run test:contracts
bun test tests/contracts/events.test.ts
```

Manual checks:

- start NATS
- start Core
- subscribe to `core.lifecycle.started.v0`
- register sample service and observe service event
