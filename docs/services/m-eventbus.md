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

M-EventBus owns the current MVP internal publish gateway: envelope validation, internal authentication, runtime subject allowlist, JetStream-backed durable publish handoff, rejected-event capture, and failure-side observability into dedicated EventBus operational subjects. It does not own authoritative business state and must not become log storage.

What this service owns:

- NATS connection management
- JetStream stream bootstrap for active event subjects and EventBus operational DLQ subjects
- event envelope validation
- event schema version enforcement
- internal loopback HTTP + Eden publish API for Core and internal services
- command / event subject conventions
- active published-subject allowlist enforcement
- `correlationId`, `causationId`, and `traceId` propagation
- caller service / actor attribution on rejected and failed publish events
- validated durable handoff of events into JetStream-captured NATS subjects
- rejected-event and publish-failure emission on `meventbus.publish.rejected.v0` / `meventbus.publish.failed.v0`

Deferred from the current MVP boundary:

- centralized subscriber orchestration and fan-out policies
- node-state-specific event routing logic beyond subject naming discipline
- making every service depend on EventBus as the sole transport owner for readiness/subscription concerns

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
| Internal metrics | `/internal/v0/metrics/publish-summary` | `0.1.0` | loopback publish-outcome summary for BFF / dashboard use |

---

## 4. Permissions

M-EventBus does not expose an operator-facing external permission surface. Internal callers authenticate through the internal token boundary.

| Permission | Required For | Risk |
|------------|--------------|------|
| internal token | `/internal/v0/publish`, `/internal/v0/metrics/publish-summary`, and readiness-sensitive internal routes | medium |

---

## 5. Dependencies

| Dependency | Type | Failure Behavior |
|------------|------|------------------|
| NATS | event bus | validated publication degrades explicitly |
| JetStream | durable publish plane | stream bootstrap failure marks readiness false and publish path fails closed |
| shared event schemas | shared package | invalid envelope or subject validation blocks publication |

---

## 6. Configuration

| Key | Type | Required | Hot Reload | Notes |
|-----|------|----------|------------|-------|
| `MERISTEM_EVENTBUS_PORT` | number | yes | no | loopback HTTP bind |
| `NATS_URL` | string | yes | yes | NATS backbone URL |
| `MERISTEM_INTERNAL_TOKEN` | string | yes | no | internal service authentication |
| `MERISTEM_EVENTBUS_STREAM` | string | no | no | defaults to `MERISTEM_EVENTS` |
| `MERISTEM_EVENTBUS_DLQ_STREAM` | string | no | no | defaults to `MERISTEM_EVENTBUS_DLQ` |
| `MERISTEM_EVENTBUS_PUBLISH_RETRIES` | number | no | no | Meristem-owned retry count after the first publish attempt; defaults to `2` |
| `MERISTEM_EVENTBUS_PUBLISH_TIMEOUT_MS` | number | no | no | per-attempt JetStream publish timeout; defaults to `1000` |
| `MERISTEM_EVENTBUS_RETRY_BASE_MS` | number | no | no | exponential backoff base delay; defaults to `100` |
| `MERISTEM_EVENTBUS_RETRY_MAX_MS` | number | no | no | exponential backoff max delay; defaults to `2000` |

---

## 7. Health

| Check | Meaning | Failure Behavior |
|-------|---------|------------------|
| liveness | process is running | restart or report unavailable |
| readiness | NATS, JetStream bootstrap, and publish pipeline are usable | event-dependent capabilities degrade or fail closed upstream |

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
| EventBus operational event | rejected envelopes / allowlist failures / publish failures | `meventbus.publish.rejected.v0`, `meventbus.publish.failed.v0` with original event context |
| Metrics | publish outcomes and retry attempts | `eventbus.publish.outcomes_total`, `eventbus.publish.retry_attempts_total` |
| Audit | not written directly | — |

---

## 10. Policy Requirements

- M-EventBus does not make authorization decisions.
- internal publish routes must stay behind internal authentication.
- published subjects must exist in `docs/events/EVENT-CATALOG.md`.
- envelope validation failure must block publication.
- subjects outside the active EventBus allowlist must be rejected and emitted on `meventbus.publish.rejected.v0`.
- publish failures must emit `meventbus.publish.failed.v0` best-effort before returning 503.
- publish retries and backoff are owned by M-EventBus policy, not left implicit inside JetStream immediate retries.
- rejected / failed operational events must preserve caller service identity and actor when the original event payload exposes them.
- M-EventBus must expose a queryable internal publish summary so the workbench can read current counters without scraping raw OTel exporter output.

---

## 11. Done Criteria

- Core and internal services can publish an event through `/internal/v0/publish`.
- a sample internal consumer can subscribe to the NATS subject written by M-EventBus.
- EventBus bootstraps JetStream streams for active event subjects and EventBus operational failure subjects.
- events include `id`, `type`, `version`, `source`, `timestamp`, and `payload`.
- `correlationId` and `traceId` propagate where available.
- schema tests cover valid, invalid, allowlist-rejected, and publish-failure payloads.
- current loopback boundary remains `http://127.0.0.1:3103` with `/health`, `/ready`, `/internal/v0/publish`, and `/internal/v0/metrics/publish-summary`.
