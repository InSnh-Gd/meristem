# Meristem MVP Specification

> This document defines the first implementation target for Meristem. It turns the product intent in `MERISTEM.md` and the engineering baseline in `MERISTEM-DEV.md` into a bounded, testable MVP.

---

## 1. MVP Goal

The MVP proves the smallest secure M network control loop:

```text
Core starts
-> CLI queries Core status
-> operator registers Stem / Leaf nodes
-> operator assigns a noop task to a Leaf node
-> Core persists state in PostgreSQL
-> Core publishes events through NATS
-> Timeline / Full / Audit logs record the flow
-> M-Policy RBAC gates protected operations
```

MVP success means a developer can run Core locally with PostgreSQL and NATS, use CLI commands to perform the loop, and verify resulting API responses, database records, events, logs, and audit entries.

---

## 2. In Scope

- Core bootstrap and health/readiness endpoints.
- REST + OpenAPI v0.
- One internal Eden contract sample for Core.
- M-CLI commands for status, node registration/listing, task assignment, timeline logs, and audit logs using JWT bearer auth.
- PostgreSQL authoritative state for users, roles, permissions, nodes, service definitions, tasks, policy decisions, timeline logs, full logs, and audit logs.
- NATS event publishing for Core lifecycle, node registration/status, task assignment/completion, policy decisions, and audit entries.
- Minimal RBAC with `viewer`, `operator`, `admin`, and `security-admin`.
- Timeline Log, Full Log, and Audit Log minimal implementations.
- OpenTelemetry minimal trace/correlation fields where available.
- Service Definition registration for Core and a sample service.
- Independent Bun processes for Core, M-Policy, M-Log, and M-EventBus.
- NATS request/reply for Core -> M-Policy, Core -> M-Log, and Core -> M-EventBus internal calls.

---

## 3. Out of Scope

- M-UI implementation.
- Real DERP / UDP / TCP M-Net networking.
- M-Net CN.
- OpenSearch read models.
- Redis / KeyDB.
- APISIX.
- M-Extension runtime.
- Wasm / Zig execution.
- LLM analysis.
- confidence, suspicion, and multi-party decisioning beyond RBAC placeholders.
- production-grade identity provider integration.

---

## 4. MVP Personas

| Persona | Uses | Must Be Able To |
|---------|------|-----------------|
| local developer | CLI + REST | start Core, run tests, inspect MVP loop |
| operator | CLI | register nodes, assign noop task, inspect status |
| security reviewer | CLI + DB/API | verify RBAC denial and Audit Log entries |

---

## 5. Required User Stories

1. As a local developer, I can start Core and see health/readiness status.
2. As an operator, I can register one Stem node and one Leaf node.
3. As an operator, I can list registered nodes and see their statuses.
4. As an operator, I can assign a noop task to a Leaf node.
5. As an operator, I can see the task completion event and Timeline entry.
6. As a security reviewer, I can verify protected operations require RBAC permission.
7. As a security reviewer, I can verify node registration, task assignment, and permission denial produce Audit or Full Log entries according to risk.

---

## 6. MVP Demo Script

Target CLI sequence:

```bash
meristem status
meristem node register --kind stem --name local-stem
meristem node register --kind leaf --name local-leaf
meristem node list
meristem task assign --leaf <leaf-node-id> --type noop
meristem log timeline
meristem audit list
```

Expected result:

- `status` reports Core healthy and dependencies ready.
- node commands create and list Stem / Leaf records.
- noop task moves to completed.
- NATS events are published for lifecycle, registration, status, assignment, completion, policy decision, and audit entry.
- Timeline shows human-readable Core/node/task events.
- Audit shows protected operation decisions.

---

## 7. MVP Acceptance Criteria

| Area | Acceptance Criteria |
|------|---------------------|
| Core | starts locally, exposes health/readiness/status, generates OpenAPI |
| CLI | supports required MVP commands with non-zero exit on failure |
| REST | implements v0 endpoints in `docs/contracts/REST-API-MVP.md` |
| Eden | exposes one typed Core status call |
| PostgreSQL | stores authoritative MVP entities listed in `docs/data/POSTGRES-SCHEMA-MVP.md` |
| NATS | publishes MVP subjects listed in `docs/events/EVENT-CATALOG.md` |
| RBAC | blocks protected operations without permission |
| Audit | records protected node/task/security operations |
| Timeline | records Core start, node registration, task assignment/completion |
| Full Log | records errors, rejected requests, dependency degradation |
| Tests | typecheck, unit, contract, API, CLI, event, RBAC, audit fail-closed tests pass |

---

## 8. MVP Failure Rules

- If PostgreSQL is unavailable, Core readiness fails.
- If NATS is unavailable, event-dependent commands fail or degrade explicitly; state must not be silently considered propagated.
- If Audit Log write fails for protected operations, the operation fails closed.
- If M-Policy is unavailable, protected operations fail closed.
- If OpenTelemetry is unavailable, operations continue and trace fields are omitted or marked unavailable.

---

## 9. MVP Completion Definition

MVP is complete only when:

- all required CLI commands work against a locally running Core
- REST/OpenAPI and Eden contracts match documented behavior
- PostgreSQL and NATS are real local dependencies
- protected operations are permission-gated
- required Timeline / Full / Audit entries are written
- required tests pass
- all MVP docs are updated to match implementation
