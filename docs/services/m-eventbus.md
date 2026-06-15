# M-EventBus Service Definition

## 1. Identity

| Field | Value |
|-------|-------|
| name | `m-eventbus` |
| version | `0.1.0` |
| domain | `m-eventbus` |
| kind | `internal` |
| owner | Meristem event backbone maintainers |

---

## 2. Responsibility

M-EventBus owns event, command, synchronization, and interconnect-information flow. It does not own authoritative business state and must not become log storage.

What this service owns:

- NATS connection management
- event envelope validation
- event schema version enforcement
- internal loopback HTTP + Eden publish API for Core and internal services
- command / event subject conventions
- `correlationId`, `causationId`, and `traceId` propagation
- service lifecycle event routing
- node state and interconnect-information event routing

What this service must not own:

- authoritative node state
- audit evidence
- long-term log storage
- M-Net routing decisions

---

## 3. Contracts

| Contract | Path / Subject | Version | Notes |
|----------|----------------|---------|-------|
| Event envelope | `MEventEnvelope` | `v0` | defined in shared event contracts |
| NATS subjects | `docs/events/EVENT-CATALOG.md` | `v0` | all published subjects must be listed |
| Eden | `/internal/v0/publish` | `0.1.0` | loopback publish API |

---

## 4. Permissions

M-EventBus does not expose an operator-facing external permission surface. Internal callers authenticate through the internal token boundary.

| Permission | Required For | Risk |
|------------|--------------|------|
| internal token | `/internal/v0/publish` and readiness-sensitive internal routes | medium |

---

## 5. Dependencies

| Dependency | Type | Failure Behavior |
|------------|------|------------------|
| NATS | event bus | event publication and fan-out degrade explicitly |
| shared event schemas | shared package | invalid envelope or subject validation blocks publication |

---

## 6. Configuration

| Key | Type | Required | Hot Reload | Notes |
|-----|------|----------|------------|-------|
| `MERISTEM_EVENTBUS_PORT` | number | yes | no | loopback HTTP bind |
| `NATS_URL` | string | yes | yes | NATS backbone URL |
| `MERISTEM_INTERNAL_TOKEN` | string | yes | no | internal service authentication |

---

## 7. Health

| Check | Meaning | Failure Behavior |
|-------|---------|------------------|
| liveness | process is running | restart or report unavailable |
| readiness | NATS and validation pipeline are usable | event-dependent capabilities degrade or fail closed upstream |

---

## 8. Lifecycle

| Capability | Supported | Notes |
|------------|-----------|-------|
| reloadable | limited | connection settings may reload when supported |
| rollbackable | no | transport does not own business state rollback |
| degradable | yes | callers degrade explicitly when publication is unavailable |

---

## 9. Logs

| Log | When Written | Required Fields |
|-----|--------------|-----------------|
| Timeline | not written directly | — |
| Full | schema validation failures, delivery failures, transport degradation | `subject`, `source`, `level`, `message`, `correlationId`, `traceId` |
| Audit | not written directly | — |

---

## 10. Policy Requirements

- M-EventBus does not make authorization decisions.
- internal publish routes must stay behind internal authentication.
- published subjects must exist in `docs/events/EVENT-CATALOG.md`.
- envelope validation failure must block publication.

---

## 11. Done Criteria

- Core can publish an event.
- a sample internal consumer can subscribe to an event.
- events include `id`, `type`, `version`, `source`, `timestamp`, and `payload`.
- `correlationId` and `traceId` propagate where available.
- schema tests cover valid, invalid, and version-mismatch payloads.
- current loopback boundary remains `http://127.0.0.1:3103` with `/health`, `/ready`, and `/internal/v0/publish`.
