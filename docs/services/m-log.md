# M-Log Service Definition

## 1. Identity

| Field | Value |
|-------|-------|
| name | `m-log` |
| version | `0.1.0` |
| domain | `m-log` |
| kind | `internal` |

---

## 2. Responsibility

M-Log owns Meristem's logging, timeline, full log, audit, and AI-analysis input layer.

Owns:

- Timeline Log
- Full Log
- Audit Log
- log schema versioning
- event-to-log correlation
- trace ID correlation
- OpenSearch projection for query and analysis

Must not own:

- OpenTelemetry collection itself
- policy decisions
- authoritative operational state
- mutable audit facts

---

## 3. Log Boundaries

| Log | Audience | Purpose | Storage Rule |
|-----|----------|---------|--------------|
| Timeline Log | most team members | human-readable key events | queryable, summarizable |
| Full Log | operations and AI analysis | complete classified logs | searchable and trace-linked |
| Audit Log | high-trust review | privileged and high-risk facts | independent, high-permission, immutable by default |

Audit Log is not a category inside Full Log. It is a separate high-trust fact stream.

---

## 4. Failure Behavior

| Failure | Behavior |
|---------|----------|
| Timeline write fails | mark Timeline degraded; Full and Audit continue |
| Full Log query fails | query path degrades; writes continue if possible |
| Audit write fails | block high-risk and privileged operations |
| OpenSearch unavailable | write model unaffected; search and analysis degrade |

---

## 5. Done Criteria

- Core start writes Timeline Log.
- Node join writes Timeline Log.
- Privileged placeholder action writes Audit Log.
- Full Log can store raw context with `traceId` or `correlationId`.
- Audit Log cannot be silently skipped for high-risk actions.
