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
| Events (consumed) | `meventbus.publish.rejected.v0`, `meventbus.publish.failed.v0` | `v0` | consumed into Full Log for transport-failure observability |
| OpenSearch production config | `OpenSearchProductionContractV01Schema` | `opensearch@0.1.0` | secured 3-node projection cluster, templates, ISM, snapshot/restore, Dashboards auxiliary contract |
| Observability config | `ObservabilityContractV01Schema` | `observability@0.1.0` | Prometheus, Grafana, Alertmanager, OTel, Pino, alert and degradation visibility contract |

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
| OpenSearch Dashboards | auxiliary UI | operator query surface only; unauthorized access returns 401/403 and must be audited through Meristem boundaries |
| Prometheus / Grafana / Alertmanager / OTel | observability | fully degradable; unavailable monitoring must not block authoritative writes |
| M-EventBus | service | post-Audit publication degrades explicitly; EventBus operational subjects are observed best-effort into Full Log |

---

## 6. Configuration

| Key | Type | Required | Hot Reload | Notes |
|-----|------|----------|------------|-------|
| `MERISTEM_MLOG_PORT` | number | yes | no | loopback bind |
| `OPENSEARCH_URL` | string | no | yes | read-model/search backend |
| `MERISTEM_INTERNAL_TOKEN` | string | yes | no | internal service authentication |

Production OpenSearch configuration is governed by `OpenSearchProductionContractV01Schema`, not ad hoc environment variables. The contract requires three distinct-zone nodes with one `cluster_manager`, `data`, and `ingest` role, TLS on REST and transport, the security plugin, SecretRef-backed service accounts, versioned strict index templates for Timeline / Full Log / Audit projection with `correlationId` filtering, ISM retention with snapshot-before-delete, and restore followed by M-Log projection rebuild from PostgreSQL.

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

EventBus operational subjects are stored as Full Log entries rather than Audit Log facts, because they describe transport/runtime degradation rather than privileged business decisions. When available, the stored payload and message preserve `callerService`, `actor`, `eventType`, and correlation fields so transport failures can be traced back to the originating publisher and compared against the workbench's EventBus metrics summary.

Audit Log is not a category inside Full Log; it is a separate high-trust fact stream.

OpenSearch stores only query projections. Timeline, Full Log, and Audit projection indices use strict mappings and aliases, but query results are never authority for policy, control, or audit facts. When OpenSearch is unavailable, M-Log records degradation in Full Log / projection health and callers show degraded search semantics; authoritative PostgreSQL writes continue unless the operation itself requires Audit and Audit is unavailable.

Dashboards is an auxiliary private/operator-VPN ingress for viewing read-only projections and Grafana-style panels. TLS plus the OIDC/RBAC proxy are mandatory; its only actions are viewing dashboards and querying projections. It must not become the primary M-UI, must not expose authority actions, and must not bypass Meristem auth or Audit. Unauthorized Dashboards access is represented as `401` or `403` at the ingress/auth boundary and must emit an audit-visible denial through the normal Meristem path.

Observability uses Prometheus scrape targets, Grafana read-only datasources, Alertmanager rules, OTel collectors, and Pino JSONL logs. `correlationId` must propagate through logs, traces, metrics labels where applicable, and dashboard drill-down links so operators can connect degraded indicators with Timeline / Full / Audit records. Dashboard read models retain an owner, state sources, degradation indicators, and the `correlationId` field so degraded visibility is traceable and not color-only.

---

## 10. Policy Requirements

- high-risk or privileged operations must fail closed if required Audit writes cannot be completed.
- M-Log does not make authorization decisions.
- search/read surfaces must not become the authority for business-state decisions.
- OpenSearch and Dashboards are projection / auxiliary only; Dashboards cannot mutate control-plane state or write Audit facts.
- Observability outages are visible degraded states, not reasons to block authoritative writes.

---

## 11. Done Criteria

- Core start writes Timeline Log.
- node join writes Timeline Log.
- privileged placeholder actions write Audit Log.
- Full Log stores raw context with `traceId` or `correlationId`.
- Audit Log cannot be silently skipped for high-risk actions.
- the current loopback boundary remains `http://127.0.0.1:3102` with `/health`, `/ready`, `/internal/v0/timeline`, `/internal/v0/full`, `/internal/v0/audit`, and `/internal/v0/search/*`.
- OpenSearch projection remains best-effort after PostgreSQL writes and does not roll back authoritative log facts.
