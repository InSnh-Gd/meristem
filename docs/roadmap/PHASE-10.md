# Phase 10 - OpenSearch Read Model Projection

> Goal: establish query-oriented OpenSearch projections for Meristem logs without turning OpenSearch into the source of truth.

---

## 1. Scope

Phase 10.0 implements the first **OpenSearch Read Model Projection** for M-Log facts:

- Full Log projection and search.
- Timeline Log projection and simple query / aggregation-ready shape.
- Audit Log projection and restricted search.
- Best-effort OpenSearch indexing after PostgreSQL fact writes succeed.
- M-Log internal search APIs owned by the M-Log service.
- Core REST v0 search APIs as the external entrypoint.
- OpenSearch local dependency support as an optional Phase 10 degraded dependency.
- Contract tests proving OpenSearch failures do not block authoritative log writes.

Phase 10.1 starts the **Projection Platform Track** as a follow-on planning and implementation lane:

- projector job model.
- idempotency key.
- projector cursor / offset.
- retry and dead-letter handling.
- backfill command.
- projection health and lag.
- projection schema version handling.

The Projection Platform Track belongs to M-Log. It may later run as an internal projector process or service, but it is not a new M-* domain and not a generic all-system data platform in Phase 10.1.

---

## 2. Out of Scope

Phase 10.0 explicitly excludes:

- replacing PostgreSQL or M-Log as the log fact source.
- storing Audit facts only in OpenSearch.
- exposing OpenSearch DSL, Lucene query strings, or raw index names through public APIs.
- cursor pagination, saved searches, facets, or complex aggregations.
- event replay, durable projector offsets, DLQ, and full backfill daemon implementation.
- M-Net state projection implementation.
- M-Policy behavior analysis implementation.
- OpenSearch-backed authorization, audit, or policy decisions.
- Elasticsearch support.

M-Net state read models and M-Policy behavior analysis remain placeholders in Phase 10.0.

---

## 3. Target Files

Expected implementation areas:

```text
docker-compose.yml
package.json
services/m-log/
apps/core/
packages/contracts/
docs/services/m-log.md
docs/contracts/REST-API-MVP.md
docs/data/STATE-MODEL.md
docs/operations/RUNBOOK.md
docs/testing/TESTING.md
tests/contracts/
tests/failure-modes/
tests/integration/
```

If an OpenSearch helper package is introduced, it must stay inside a shared package with no hidden process state and no Node.js runtime dependency.

---

## 4. Required Scripts

Phase 10 keeps the existing MVP scripts and adds optional OpenSearch startup support.

```bash
docker compose up -d postgres nats
docker compose --profile opensearch up -d opensearch
bun run dev:all
bun run lint
bun run typecheck
bun run test:contracts
bun run test:failure-modes
bun run test:integration
```

OpenSearch must not be required for pre-Phase-10 MVP commands. In Phase 10, tests that verify OpenSearch projection or search may start the OpenSearch profile explicitly.

---

## 5. Projection Scope

Phase 10.0 creates only these log indexes:

```text
meristem-full-logs-v0
meristem-timeline-logs-v0
meristem-audit-logs-v0
```

Projection ownership:

| Projection | Fact Source | Owner | Query Purpose |
|------------|-------------|-------|---------------|
| `meristem-full-logs-v0` | `full_logs` PostgreSQL table | M-Log | operational search and AI-analysis input |
| `meristem-timeline-logs-v0` | `timeline_logs` PostgreSQL table | M-Log | human-readable event lookup and aggregation-ready display |
| `meristem-audit-logs-v0` | `audit_logs` PostgreSQL table | M-Log | high-permission audit lookup |

Projection write path:

```text
M-Log receives write request
-> M-Log writes PostgreSQL fact
-> M-Log best-effort indexes OpenSearch projection
-> M-Log returns fact write result
```

OpenSearch projection failure must not roll back the PostgreSQL fact.

---

## 6. Query Contracts

Phase 10.0 exposes Meristem-level query contracts, not OpenSearch DSL.

```ts
type LogSearchQuery = {
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
};

type FullLogSearchQuery = LogSearchQuery & {
  level?: "debug" | "info" | "warn" | "error";
  source?: string;
  correlationId?: string;
  traceId?: string;
};

type TimelineSearchQuery = LogSearchQuery & {
  subject?: string;
  correlationId?: string;
};

type AuditSearchQuery = LogSearchQuery & {
  actor?: string;
  action?: string;
  resource?: string;
  decisionId?: string;
  correlationId?: string;
};
```

Rules:

- `q` is Meristem-level text search.
- `from` and `to` are ISO timestamp strings.
- `limit` has a hard maximum of 100.
- unknown query fields are rejected.
- Phase 10.0 does not expose OpenSearch index names, query DSL, cursor pagination, saved search, aggregation DSL, or facets.

---

## 7. API Boundaries

M-Log owns OpenSearch query implementation through internal APIs:

```text
GET /internal/v0/search/full
GET /internal/v0/search/timeline
GET /internal/v0/search/audit
```

Core remains the external REST/OpenAPI entrypoint:

```text
GET /api/v0/logs/full/search
GET /api/v0/logs/timeline/search
GET /api/v0/audit/search
```

Permission rules:

| External API | Required Permission |
|--------------|---------------------|
| `GET /api/v0/logs/timeline/search` | `timeline:read` |
| `GET /api/v0/logs/full/search` | `log:read-full` |
| `GET /api/v0/audit/search` | `audit:read` |

Core must not implement OpenSearch query logic directly. Core forwards to M-Log and preserves error envelopes.

---

## 8. Failure Semantics

Phase 10.0 distinguishes three failure classes.

### Fact Write Failure

- Timeline / Full / Audit PostgreSQL writes fail according to existing M-Log fact write behavior.
- Audit fact write failure still blocks protected or high-risk operations.
- Fact write failure is not masked by OpenSearch state.

### Projection Write Failure

- PostgreSQL fact is already written.
- OpenSearch indexing fails.
- M-Log does not roll back the fact.
- Core operations are not blocked by projection failure.
- M-Log records or exposes projection degraded state for later retry/backfill.
- Projection Platform Track owns durable retry and backfill.

### Search Query Failure

- OpenSearch query fails or OpenSearch is unavailable.
- M-Log returns a clear `search_unavailable` / degraded error envelope.
- Core forwards the error envelope.
- PostgreSQL-backed list endpoints such as `GET /api/v0/logs/full` remain usable.
- Fact writes continue.

---

## 9. Projection Platform Track

Phase 10.1 begins the **Projection Platform Track** after Phase 10.0 search is functional.

The first platform tasks are:

- define projector job metadata.
- define idempotency keys for projected documents.
- define cursor / offset shape.
- define retry and DLQ rules.
- define backfill command shape.
- expose projection health, lag, and degraded state.
- define schema version behavior for projection indexes.

Phase 10.1 must not change the source of truth. It improves read-model operations around facts owned by M-Log and PostgreSQL.

---

## 10. Implementation Slices

Phase 10.0 should be implemented in this order:

1. **Docs and contracts**
   Update the M-Log service definition, REST contract, runbook, and testing contract with OpenSearch adapter ownership, query types, failure semantics, and optional compose profile behavior.

2. **M-Log projection adapter**
   Add a private M-Log OpenSearch adapter using Bun `fetch` for health checks, index creation, document indexing, and constrained search. The adapter must not expose raw OpenSearch DSL outside M-Log.

3. **Search APIs**
   Add M-Log internal search routes and Core external REST routes with existing permissions: `timeline:read`, `log:read-full`, and `audit:read`.

4. **Verification**
   Write failure-mode tests before happy-path search tests. The first red line is that OpenSearch unavailability must not block authoritative Timeline / Full / Audit fact writes.

---

## 11. Completion Criteria

Phase 10.0 is complete when:

- local OpenSearch can be started as an optional compose profile or equivalent Phase 10 dependency.
- M-Log writes Full, Timeline, and Audit facts to PostgreSQL as before.
- M-Log best-effort indexes all three log projections into OpenSearch.
- Full Log search works by text, level, source, correlation ID, trace ID, and time range.
- Timeline search works by text, subject, correlation ID, and time range.
- Audit search works by actor, action, resource, decision ID, correlation ID, and time range.
- Core exposes external REST search endpoints and does not implement OpenSearch query logic directly.
- M-Log exposes internal search endpoints and remains the owner of log search semantics.
- OpenSearch unavailable does not block authoritative fact writes.
- OpenSearch query failure degrades search without breaking PostgreSQL-backed list endpoints.
- Audit Log remains independent and high-permission.
- M-Net and M-Policy read models are documented placeholders only.

Phase 10.1 is ready to start when:

- Phase 10.0 search tests pass.
- projection degraded state is observable.
- a first Projection Platform Track task list exists for idempotency, offsets, retry, DLQ, and backfill.

---

## 12. Verification Checklist

```bash
bun run lint
bun run typecheck
bun run test:contracts
bun run test:failure-modes
bun run test:integration
```

Manual checks:

- Start PostgreSQL, NATS, and OpenSearch.
- Start `bun run dev:all`.
- Create representative Timeline, Full, and Audit entries.
- Query Full Log search by text, level, source, correlation ID, and trace ID.
- Query Timeline search by text, subject, and correlation ID.
- Query Audit search as `security-admin` by actor, action, resource, decision ID, and correlation ID.
- Stop OpenSearch.
- Confirm new Timeline / Full / Audit facts still write to PostgreSQL.
- Confirm search endpoints return degraded/search unavailable errors.
- Confirm PostgreSQL-backed list endpoints still work.
