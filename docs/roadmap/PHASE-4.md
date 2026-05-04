# Phase 4 - M-Log Minimum Timeline / Full / Audit

> Goal: implement the minimum logging layer required for MVP traceability and security review.

---

## 1. Scope

Phase 4 includes:

- Timeline Log table and write API.
- Full Log table and write API.
- Audit Log table and write API.
- CLI timeline and audit list commands.
- Core start Timeline entry.
- node registration Timeline and Audit entries.
- task assignment Timeline and Audit entries.
- permission denial Full Log / Audit behavior where applicable.
- traceId and correlationId fields.

Phase 4 excludes:

- OpenSearch.
- long-term log analytics.
- AI log summaries.
- immutable storage backend beyond database-level MVP constraints.

---

## 2. Target Files

Expected implementation areas:

```text
services/m-log/
packages/log-schema/
apps/core/
apps/m-cli/
```

---

## 3. Required CLI

```bash
meristem log timeline
meristem audit list
```

---

## 4. Required API

- `GET /api/v0/logs/timeline`
- `GET /api/v0/logs/full`
- `GET /api/v0/audit`

---

## 5. Completion Criteria

- Core startup writes Timeline entry.
- node registration writes Timeline and Audit entries.
- task assignment writes Timeline and Audit entries.
- rejected protected operation writes Full Log and Audit entry if an actor/resource are known.
- Audit Log write failure blocks protected operation.
- Timeline failure does not block protected operation if Audit succeeds.
- Full Log query failure does not block authoritative writes.

---

## 6. Verification Checklist

```bash
meristem log timeline
meristem audit list
```

Failure checks:

- simulate Audit Log write failure and confirm protected operation fails closed
- simulate Timeline write failure and confirm Full/Audit still define protected behavior
