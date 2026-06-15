# M-Log Service Definition

## 1. Identity

| Field | Value |
|-------|-------|
| name | `m-log` |
| version | `0.1.0` |
| domain | `m-log` |
| kind | `internal` |
| owner | Meristem logging maintainers |

---

## 2. Responsibility

M-Log owns Timeline, Full Log, Audit Log, and the OpenSearch-backed query layer used for search and analysis.

What this service owns:

- Timeline Log
- Full Log
- Audit Log
- log schema versioning
- event-to-log correlation
- trace ID correlation
- internal loopback HTTP + Eden write/query APIs
- OpenSearch projection for query and analysis

What this service must not own:

- OpenTelemetry collection itself
- authorization decisions
- authoritative operational state
- mutable audit facts

---

## 3. Contracts

| Contract | Path / Subject | Version | Notes |
|----------|----------------|---------|-------|
| REST / internal HTTP | `/internal/v0/timeline`, `/internal/v0/full`, `/internal/v0/audit`, `/internal/v0/search/*` | `v0` | loopback write/query surface |
| Eden | `@meristem/contracts/mlog` | `0.1.0` | typed internal client surface |
| Events | `audit.entry.created.v0` | `v0` | published after successful Audit writes |

---

## 4. Permissions

M-Log does not expose its own external operator-facing permission surface. Core and internal services call M-Log through the internal token boundary; external read permissions are enforced before Core fan-out.

| Permission | Required For | Risk |
|------------|--------------|------|
| internal token | `/ready` and `/internal/v0/*` | medium |

---

## 5. Dependencies

| Dependency | Type | Failure Behavior |
|------------|------|------------------|
| PostgreSQL | datastore | authoritative log-fact writes fail closed when required |
| OpenSearch | read model | search and analysis degrade without affecting authoritative facts |
| M-EventBus | service | post-Audit publication degrades explicitly |

---

## 6. Configuration

| Key | Type | Required | Hot Reload | Notes |
|-----|------|----------|------------|-------|
| `MERISTEM_MLOG_PORT` | number | yes | no | loopback bind |
| `OPENSEARCH_URL` | string | no | yes | read-model/search backend |
| `MERISTEM_INTERNAL_TOKEN` | string | yes | no | internal service authentication |

---

## 7. Health

| Check | Meaning | Failure Behavior |
|-------|---------|------------------|
| liveness | process is running | restart or report unavailable |
| readiness | write path is available and required dependencies are usable | protected writes fail closed when Audit is unavailable |

---

## 8. Lifecycle

| Capability | Supported | Notes |
|------------|-----------|-------|
| reloadable | yes | current runtime prototype supports bounded reload |
| rollbackable | no | audit/log facts are not rolled back |
| degradable | yes | search/query degrades independently from authoritative writes |

---

## 9. Logs

| Log | When Written | Required Fields |
|-----|--------------|-----------------|
| Timeline | key human-readable operational events | `summary`, `subject`, `correlationId` |
| Full | raw contextual logs and degradation details | `source`, `level`, `message`, `traceId`, `correlationId` |
| Audit | privileged and high-risk facts | `actor`, `action`, `resource`, `decision` |

Audit Log is not a category inside Full Log; it is a separate high-trust fact stream.

---

## 10. Policy Requirements

- high-risk or privileged operations must fail closed if required Audit writes cannot be completed.
- M-Log does not make authorization decisions.
- search/read surfaces must not become the authority for business-state decisions.

---

## 11. Done Criteria

- Core start writes Timeline Log.
- node join writes Timeline Log.
- privileged placeholder actions write Audit Log.
- Full Log stores raw context with `traceId` or `correlationId`.
- Audit Log cannot be silently skipped for high-risk actions.
- the current loopback boundary remains `http://127.0.0.1:3102` with `/health`, `/ready`, `/internal/v0/timeline`, `/internal/v0/full`, `/internal/v0/audit`, and `/internal/v0/search/*`.
- OpenSearch projection remains best-effort after PostgreSQL writes and does not roll back authoritative log facts.
