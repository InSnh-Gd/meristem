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

## 1.1 Post-MVP v0.1 Baseline Update

Phase 11 closes the MVP task loop by promoting task ownership from Core to M-Task. The original MVP loop proved that Core could assign a noop task through the minimal control path. The v0.1 baseline after Phase 11 treats M-Task as the canonical task service, task API entrypoint, task state owner, and task lifecycle event owner.

Updated task loop:

```text
M-Task receives task submit
-> M-Task verifies actor auth through shared auth primitives
-> M-Task asks M-Policy for RBAC and risk decision
-> M-Task persists authoritative task state in PostgreSQL
-> M-Task coordinates delivery through M-Net
-> M-Net delivers to node-agent
-> node-agent completes the noop frame
-> M-Task records completion, timeout, cancellation, or failure
-> M-Task publishes task lifecycle events through M-EventBus
-> M-Log records Timeline / Full / Audit facts according to outcome
```

The old Core-owned task assignment path is historical MVP context, not the current v0.1 baseline after Phase 11.

---

## 2. In Scope

- Core bootstrap and health/readiness endpoints.
- REST + OpenAPI v0.
- Eden typed clients for CLI -> Core and Core -> M-Policy / M-Log / M-EventBus.
- M-CLI commands for status, node registration/listing, task submission, timeline logs, and audit logs using JWT bearer auth.
- per-node token issuance and agent-mode node runtime through `node-agent`.
- PostgreSQL authoritative state for users, roles, permissions, nodes, service definitions, tasks, policy decisions, timeline logs, full logs, and audit logs.
- NATS event publishing for Core lifecycle, node registration/status, task submission/completion, policy decisions, and audit entries.
- Minimal RBAC with `viewer`, `operator`, `admin`, and `security-admin`.
- Timeline Log, Full Log, and Audit Log minimal implementations.
- OpenTelemetry SDK with real trace/correlation propagation across HTTP, internal loopback HTTP, logs, and events.
- Service Definition registration for Core and a sample service.
- Independent Bun processes for Core, M-Policy, M-Log, and M-EventBus.
- Internal loopback HTTP + Eden + shared token for Core -> M-Policy, Core -> M-Log, and Core -> M-EventBus sync calls.
- Internal loopback HTTP + Eden + shared token for Core -> M-Net sync network and agent-task calls.
- public TLS + WebSocket join ingress on `8443` for Join Ticket redemption, session resume, heartbeat, and noop task delivery.

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
| operator | CLI | register nodes, submit noop task, inspect status |
| security reviewer | CLI + DB/API | verify RBAC denial and Audit Log entries |

---

## 5. Required User Stories

1. As a local developer, I can start Core and see health/readiness status.
2. As an operator, I can register one Stem node and one Leaf node.
3. As an operator, I can issue one active token for an agent node.
4. As an operator, I can list registered nodes and see their statuses.
5. As an operator, I can submit a noop task to a Leaf node.
6. As an operator, I can see the task completion event and Timeline entry.
7. As a security reviewer, I can verify protected operations require RBAC permission.
8. As a security reviewer, I can verify node registration, task submission, and permission denial produce Audit or Full Log entries according to explicit log behavior.

---

## 6. MVP Demo Script

Target CLI sequence:

```bash
meristem status
meristem node register --kind stem --name local-stem
meristem node register --kind leaf --name local-leaf
meristem node ticket create --kind leaf --name remote-leaf
meristem node list
meristem task submit --type noop --node <leaf-node-id>
meristem log timeline
meristem audit list
```

Expected result:

- `status` reports Core healthy and dependencies ready.
- node commands create and list simulated Stem / Leaf records.
- Join Ticket issuance succeeds and points agents at the M-Net join ingress.
- a real `node-agent` can redeem that ticket, become `healthy` / `reachable`, complete `noop`, and transition back to `offline` after shutdown.
- noop task moves to completed.
- NATS events are published for lifecycle, registration, status, task submission, task completion, policy decision, and audit entry.
- Timeline shows human-readable Core/node/task events.
- Audit shows protected operation decisions.

---

## 7. MVP Acceptance Criteria

| Area | Acceptance Criteria |
|------|---------------------|
| Core | starts locally, exposes health/readiness/status, generates OpenAPI |
| CLI | supports required MVP commands with non-zero exit on failure |
| REST | implements v0 endpoints in `docs/contracts/REST-API-MVP.md` |
| Eden | exposes typed Core and internal-service clients over HTTP/HTTPS |
| PostgreSQL | stores authoritative MVP entities listed in `docs/data/POSTGRES-SCHEMA-MVP.md` |
| NATS | publishes MVP subjects listed in `docs/events/EVENT-CATALOG.md` |
| RBAC | blocks protected operations without permission |
| Audit | records protected node/task/security operations |
| Timeline | records Core start, node registration, task submission/completion |
| Full Log | records errors, rejected requests, dependency degradation |
| Tests | typecheck, unit, contract, API, CLI, event, RBAC, audit fail-closed tests pass |

---

## 8. MVP Failure Rules

- If PostgreSQL is unavailable, Core readiness fails.
- If NATS is unavailable, event-dependent commands fail or degrade explicitly; state must not be silently considered propagated.
- If Audit Log write fails for protected operations, the operation fails closed.
- If M-Policy is unavailable, protected operations fail closed.
- If the OpenTelemetry exporter is unavailable, operations continue and traces fall back to local SDK output instead of disappearing.

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
