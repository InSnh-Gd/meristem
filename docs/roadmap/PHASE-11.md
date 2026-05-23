# Phase 11 - M-Task Draft

> Status: Draft. Phase 11 captures the future split of task orchestration into an `M-Task` domain. It is not part of the current Projection Platform hardening slice and does not change the MVP `noop` contract by itself.

---

## 1. Scope

Phase 11 drafts `M-Task` as the future owner for task lifecycle, task scheduling semantics, task execution coordination, and task observability once task behavior outgrows the current Core-owned MVP `noop` workflow.

Current state:

- Core owns the public REST and CLI task entrypoint.
- Core persists the MVP `TaskRecord` in PostgreSQL.
- M-Net owns delivery over the active node-agent session.
- node-agent owns local execution of the MVP `noop` frame.
- M-Log and M-Policy provide audit, timeline, full-log, and authorization semantics.

Future `M-Task` must not be introduced merely to make an Elysia route thinner. It becomes valid when task behavior needs its own durable domain interface.

---

## 2. Promotion Triggers

Promote from Core task workflow to `M-Task` when at least one of these becomes real:

- Task types extend beyond MVP `noop`.
- Task lifecycle needs queueing, scheduling, retry, cancellation, timeout, priority, concurrency, or lease semantics.
- Multiple M-* domains need to submit or observe tasks, not only Core control routes.
- Task execution needs an independent Service Definition with its own readiness, degradation, reload, and rollback semantics.
- Task state stops being a simple Core authoritative record and requires dedicated task lifecycle tables or projection state.
- Task policy/audit rules become more complex than a direct `task:assign` protected control action.
- Task events become numerous enough that Core-owned event publication would make Core a hidden orchestration center.

---

## 3. Responsibilities

`M-Task` should own:

- Task type registry and versioned task definitions.
- Task lifecycle state machine.
- Task request acceptance, scheduling, retry, cancellation, timeout, and completion semantics.
- Task execution coordination with M-Net / node-agent.
- Task event publication through M-EventBus.
- Task Timeline / Full / Audit log policy in cooperation with M-Log.
- Task policy requirements in cooperation with M-Policy.
- Task read models or projections when they are needed for operator views.

`M-Task` must not own:

- M-Net transport, reachability, or session authentication.
- node-agent local execution internals.
- final authorization decisions; M-Policy remains the decision source.
- Audit Log storage; M-Log remains the log fact source.
- OpenSearch as authoritative task state.
- broad workflow automation unrelated to task lifecycle.

---

## 4. Contracts

Draft contracts to define before implementation:

- `docs/services/m-task.md` Service Definition.
- REST v0 or internal REST contract for task submission, cancellation, status, and task history.
- Eden internal contract for Core / M-CLI / M-UI BFF integration.
- Event subjects and payloads in `docs/events/EVENT-CATALOG.md`.
- Effect Executable Contracts under `packages/contracts/src/schemas/tasks.ts`.
- CLI command contract updates in `docs/contracts/CLI-COMMANDS.md`.
- REST contract updates in `docs/contracts/REST-API-MVP.md` or a post-MVP task contract.

Initial candidate permissions:

```text
task:read
task:submit
task:cancel
task:retry
task:manage
```

The existing `task:assign` permission remains the MVP permission until migration is planned. Do not silently replace it without a compatibility window.

---

## 5. State Model

Before implementation, decide whether task lifecycle state remains in Core-owned PostgreSQL tables or moves to M-Task-owned tables.

Candidate state:

- `task_definitions`
- `task_requests`
- `task_attempts`
- `task_leases`
- `task_results`
- `task_cancellations`

All task lifecycle state is Authoritative State in PostgreSQL unless a later ADR states otherwise. M-EventBus task events are not authoritative state. OpenSearch task projections are read models only.

---

## 6. Migration Path

1. Keep current MVP `noop` task behavior stable.
2. Extract the current Core task assignment route into a Core task workflow only if needed before M-Task implementation.
3. Define `M-Task` service document and contracts.
4. Add M-Task internal service or package behind an explicit port.
5. Route new non-noop task types through M-Task while keeping `noop` compatibility.
6. Move `noop` to M-Task only after e2e compatibility tests cover old and new paths.
7. Deprecate direct Core task orchestration only after CLI, M-UI BFF, REST, Eden, event, audit, and Timeline contracts are migrated.

---

## 7. Out of Scope

Phase 11 draft does not include:

- implementing `services/m-task/` immediately.
- changing current MVP `POST /api/v0/tasks` behavior.
- changing node-agent session protocol.
- moving M-Net reachability or session ownership.
- adding general workflow automation, cron, Temporal, Tekton, or job orchestration platforms.
- introducing Redis / KeyDB as a required queue dependency.

---

## 8. Completion Criteria

Phase 11 can be considered ready for implementation when:

- `M-Task` Service Definition is written.
- Task lifecycle state machine is documented.
- Permissions and RBAC defaults are documented.
- REST, Eden, CLI, event, and Effect Schema contracts are drafted.
- Audit / Timeline / Full Log behavior is documented.
- Migration path preserves MVP `noop` compatibility.
- Tests are defined for old `task:assign` compatibility and new M-Task behavior.

