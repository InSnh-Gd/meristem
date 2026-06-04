# Phase 11 - M-Task and M-Policy Risk Foundation

> Status: Draft. Phase 11 closes the MVP task loop by promoting task lifecycle ownership toward `M-Task` and then uses M-Task control actions as the first concrete target for M-Policy risk foundations.

Phase 11 has two coupled goals:

1. Establish `M-Task` as the owner for task lifecycle, task definitions, execution coordination, and task observability once behavior outgrows the Core-owned MVP `noop` workflow.
2. Introduce M-Policy risk foundations against real task control actions, including operation danger levels, suspicion scoring v1, risk-factor explanations, and `require_manual_review` / `require_multi_approval` outcomes.

The implementation order is deliberate: first make M-Task boundaries explicit as a real Bun service with a canonical external task API, then attach M-Policy risk handling to task submit / cancel / retry / manage operations. This keeps risk scoring grounded in a real control surface instead of becoming an isolated policy skeleton.

Phase 11 is split into three smaller execution stages:

```text
Phase 11.1 - M-Task Service Cutover
Phase 11.2 - M-Policy Risk Foundation
Phase 11.3 - End-to-End MVP Closure
```

`Phase 11` remains the umbrella for the post-MVP foundation work. The numbered subphases are the implementation and acceptance units.

## 0.1 Subphase Map

### Phase 11.1 - M-Task Service Cutover

Scope:

- Extract a shared `packages/auth` boundary before exposing M-Task externally.
- Add `services/m-task/` as the canonical task service.
- Add `m-task` to implementation-level Service Definition domain schemas, validators, fixtures, and seed data.
- Define M-Task REST, Eden, event, CLI, permission, and Effect Schema contracts.
- Make M-Task the canonical external task REST / OpenAPI entrypoint.
- Keep resource-oriented external task paths under `/api/v0/tasks`, now exposed by M-Task instead of Core.
- Require M-Task to verify external actor authentication at its own service boundary.
- Implement the Phase 11 task lifecycle states and `submit` / `cancel` / `timeout` behavior.
- Move authoritative task state into M-Task-owned PostgreSQL tables.
- Move task lifecycle event ownership to M-Task.
- Move canonical task state and orchestration out of Core.
- Replace `task:assign` with M-Task permissions in docs, seed data, tests, and examples.
- Replace `meristem task assign` with lifecycle-oriented M-Task CLI commands.
- Connect M-Task directly to M-Net, M-EventBus, M-Log, and M-Policy through declared service boundaries.

Exit criteria:

- Core and M-Task both use `packages/auth` for JWT bearer parsing, actor shape, verification, auth error primitives, and shared auth test fixtures.
- implementation-level Service Definition domain schemas, validators, fixtures, seed service definitions, and related contract snapshots accept `m-task`.
- New task commands and APIs use M-Task as the canonical external task entrypoint and task owner.
- `/api/v0/tasks` is exposed by M-Task, and Core no longer exposes canonical task routes.
- Canonical CLI commands use `submit`, `cancel`, `status`, `list`, and `retry`; `assign` is not retained.
- M-Task handles JWT bearer actor auth, request correlation, trace propagation, policy authorization, risk decision calls, and required log/audit writes at its own boundary.
- M-Task-owned PostgreSQL tables are the canonical task state source.
- M-Task publishes canonical task lifecycle events; Core does not publish task lifecycle events after cutover.
- Core-owned task orchestration is not part of the canonical path.
- Task lifecycle writes the required Timeline / Full / Audit facts.

Test gates:

Unit tests:

- task state transition reducer.
- cancel transition rules.
- timeout transition rules.
- retry `not_implemented_yet` response builder.
- M-Task-local danger and audit behavior mapping.

Contract tests:

- REST `/api/v0/tasks` schemas.
- Eden M-Task client.
- Effect Executable Contract drift checks.
- `task.*.v0` event schemas.

API tests:

- submit success.
- cancel queued success.
- cancel running best-effort paths.
- timeout worker transition.
- retry policy-aware `not_implemented_yet`.
- missing / invalid auth.
- RBAC deny.
- `require_manual_review` and `require_multi_approval` block execution.

Integration tests:

- M-Task -> M-Net delivery.
- M-Task -> M-Policy decision.
- M-Task -> M-Log Timeline / Full / Audit.
- M-Task -> M-EventBus task events.

CLI tests:

- `meristem task submit`.
- `meristem task cancel`.
- `meristem task status`.
- `meristem task list`.
- `meristem task retry`.
- non-zero exit on policy deny, auth failure, and not-implemented retry.

Regression tests:

- Core no longer exposes canonical task routes.
- Core no longer writes task lifecycle state.
- Core no longer publishes canonical task lifecycle events.
- Core no longer writes task log facts as task owner.

Execution slices:

```text
11.1-a Foundation Contracts
11.1-b M-Task Service Skeleton
11.1-c Task State + Lifecycle
11.1-d Delivery + Cancel
11.1-e Logs / Events / Policy
11.1-f Cutover + CLI + Regression
```

11.1-a Foundation Contracts:

- Extract `packages/auth`.
- Add `m-task` domain enum / schema / fixtures.
- Add or finalize `docs/services/m-task.md`.
- Define task Effect schemas.
- Define task event schemas.

11.1-b M-Task Service Skeleton:

- Add `services/m-task/` app.
- Add health, readiness, and OpenAPI endpoints.
- Add external JWT auth at M-Task boundary.
- Add config and dependency assembly.
- Add service definition registration fixture.

11.1-c Task State + Lifecycle:

- Add M-Task PostgreSQL tables.
- Add task state transition reducer.
- Implement submit, status, and list.
- Implement lightweight timeout worker.

11.1-d Delivery + Cancel:

- Add M-Task -> M-Net delivery port.
- Implement dispatch through M-Net.
- Implement best-effort cancel through M-Net.
- Keep node-agent behind M-Net.

11.1-e Logs / Events / Policy:

- Add M-Policy checks.
- Publish task lifecycle events.
- Implement Timeline / Full / Audit behavior.
- Implement retry `not_implemented_yet`.

11.1-f Cutover + CLI + Regression:

- Add CLI submit, cancel, status, list, and retry commands.
- Remove Core canonical task path.
- Update docs/contracts for M-Task ownership.
- Run the full Phase 11.1 test matrix.

### Phase 11.2 - M-Policy Risk Foundation

Scope:

- Add operation danger levels for task control actions.
- Add suspicion scoring v1.
- Add risk-factor explanations.
- Add `require_manual_review` and `require_multi_approval` outcomes for high-risk task operations.
- Document retry risk behavior without implementing real retry execution.

Exit criteria:

- M-Task submit / cancel / retry / manage operations have documented risk semantics.
- M-Policy decisions expose danger level, suspicion score, and risk factors where applicable.
- High-risk task operations can return require_* decisions rather than only allow / deny.

Risk model:

Phase 11.2 uses a two-layer risk model:

```text
operationDangerLevel:
  low | medium | high | critical
  static baseline derived from action, resource kind, task type, and task definition

suspicionScore:
  0..100
  dynamic request-time score derived from request context and explicit risk factors
```

`operationDangerLevel` is documented and contract-tested. `suspicionScore` may trigger `require_manual_review` or `require_multi_approval`, but it does not replace RBAC. RBAC denial still fails closed before risk escalation can allow anything.

Initial task danger-level examples:

```text
task.submit(noop): medium
task.cancel: high
task.retry: high
task.manage: critical
```

Initial suspicion risk factors:

```text
actor_permission_level
operation_danger_level
target_node_kind
target_node_reachability
task_type_risk
recent_failure_count
outside_expected_scope
audit_visibility
```

Out of scope for Phase 11.2:

- LLM risk scoring.
- long-term behavioral profiling.
- complex anomaly detection.
- cross-user historical risk modeling.

`require_manual_review` and `require_multi_approval` semantics:

```text
allow:
  M-Task executes the operation.

deny:
  M-Task does not execute the operation and writes Full / Audit logs as required.

require_manual_review:
  M-Task does not execute the operation.
  M-Policy creates a pending decision record.
  M-Log writes the required Audit fact.
  The response returns decisionId and requiredAction.

require_multi_approval:
  M-Task does not execute the operation.
  M-Policy creates a pending decision record.
  M-Log writes the required Audit fact.
  The response returns decisionId and requiredAction.
```

Phase 11.2 does not implement approval queue UI, approval claim / approve / reject APIs, multi-approver quorum, approval timeout, operation resume after approval, or LLM summary gates. Those belong to a later multi-decision workflow phase.

Execution slices:

```text
11.2-a Policy Contract Extension
11.2-b Risk Engine v1
11.2-c M-Task Policy Integration
11.2-d Risk Tests + Docs
```

11.2-a Policy Contract Extension:

- Extend policy decision schemas.
- Add `operationDangerLevel`.
- Add `suspicionScore`.
- Add `riskFactors`.
- Add `requiredAction` response shape.

11.2-b Risk Engine v1:

- Add static danger mapping.
- Add dynamic suspicion scoring.
- Add risk-factor explainers.
- Add conservative fallback when scoring fails.

11.2-c M-Task Policy Integration:

- Integrate submit, cancel, retry, and manage operations with risk model.
- Block execution on `require_manual_review` and `require_multi_approval`.
- Create pending decision records.
- Write Audit only by explicit M-Task behavior.

11.2-d Risk Tests + Docs:

- Add policy contract tests.
- Add risk scoring tests.
- Add M-Task `require_*` API tests.
- Update security, contracts, and M-Policy service docs.

### Phase 11.3 - End-to-End MVP Closure

Scope:

- Update MVP demo scripts and docs to target M-Task as the v0.1 baseline task owner.
- Update `docs/mvp/MVP-SPEC.md` with a post-MVP closure section that replaces the Core-owned task assignment loop with M-Task-owned task submission.
- Align REST, Eden, CLI, event, security, data, runbook, and testing docs.
- Add e2e, contract, API, CLI, event, RBAC, audit, and failure-path tests.
- Run a full local post-MVP demo / smoke that proves the M-Task-owned loop works.
- Verify the old Core task ownership does not remain as a hidden fact source.

Exit criteria:

- The post-MVP demo loop calls M-Task as the task API entrypoint and task fact source.
- MVP closure docs describe M-Task-owned task submission as the current v0.1 baseline instead of preserving the old Core-owned MVP task assignment loop.
- A local smoke proves M-Task task submission, task state, task events, explicit log behavior, and policy risk behavior end to end.
- Documentation and tests agree on the new task owner.
- The system has no accidental second task implementation in Core.

Required local smoke shape:

```text
Start:
- PostgreSQL
- NATS
- Core
- M-Policy
- M-Log
- M-EventBus
- M-Net
- M-Task
- node-agent

Run:
meristem status
meristem node ticket create --kind leaf --name remote-leaf
node-agent redeem/resume
meristem node list
meristem task submit --type noop --node <leaf>
meristem task status <task-id>
meristem task cancel <queued-task-id>
meristem task retry <task-id>
meristem log timeline
meristem audit list
```

Expected proof:

- M-Task owns task state.
- M-Task publishes task events.
- M-Task writes Timeline / Full / Audit according to explicit rules.
- M-Policy risk output appears on protected task actions.
- Core does not own canonical task routes, state, events, or log facts.

If a part of the smoke cannot be fully automated in the first implementation pass, Phase 11.3 must at minimum provide a documented manual runbook and smoke evidence. Automated smoke remains the target.

Final smoke environment:

Phase 11.3 final smoke must use real service and infrastructure boundaries. Mock, stub, fake, and in-memory adapters are allowed in unit, contract, and API tests, but they are not sufficient for MVP closure.

Required for final smoke:

- real independent Bun process for Core.
- real independent Bun process for M-Task.
- real independent Bun process for M-Net.
- real independent Bun process for M-Policy.
- real independent Bun process for M-Log.
- real independent Bun process for M-EventBus.
- real node-agent process.
- real PostgreSQL.
- real NATS.
- real HTTP / WebSocket service boundaries.
- no direct in-process shortcut for task delivery.

OpenTelemetry exporter unavailability may degrade according to MVP failure rules, but trace and correlation context must remain visible locally.

---

## 1. Scope

Phase 11 defines `M-Task` as the owner for task lifecycle, task scheduling semantics, task execution coordination, and task observability after the Core-owned MVP `noop` workflow is retired.

Phase 11 is allowed to expand beyond a thin extraction and introduce a new `services/m-task/` Bun service. The scope increase is intentional because M-Task and M-Policy risk foundations are the bridge from MVP completion into fuller baseline functionality.

Phase 11 directly migrates task ownership and the canonical external task API to M-Task instead of keeping Core as the task facade, fact source, or orchestration owner. M-Task becomes a first-class REST / OpenAPI service for task operations while still honoring Meristem policy, log, audit, and contract-versioning rules. This is a breaking migration for the MVP task contract: the old Core task entrypoint and `task:assign` CLI shape are not preserved as compatibility surfaces.

M-Task must not depend on Core forwarding internal service tokens for external task requests. It verifies external actor JWT bearer credentials itself, then calls M-Policy and M-Log directly for authorization, risk decisions, Timeline / Full / Audit behavior, and fail-closed handling.

M-Task keeps Meristem's resource-oriented external REST shape. The canonical task routes remain under `/api/v0/tasks`, but Phase 11.1 changes the service owner from Core to M-Task:

```text
Before Phase 11:
Core exposes /api/v0/tasks

After Phase 11:
M-Task exposes /api/v0/tasks
Core no longer exposes canonical /api/v0/tasks
```

Initial M-Task REST route shape:

```text
GET  /api/v0/tasks
POST /api/v0/tasks
GET  /api/v0/tasks/:id
POST /api/v0/tasks/:id/cancel
POST /api/v0/tasks/:id/retry
GET  /api/v0/task-definitions
```

The route path must not use service-name prefixes such as `/m-task/v0/*` or `/task/v0/*` for canonical external REST. Service ownership is expressed through Service Definition, OpenAPI tags, deployment, and contracts rather than leaking service names into resource paths.

Canonical M-Task CLI shape:

```text
meristem task submit --type noop --node <leaf-node-id>
meristem task cancel <task-id>
meristem task status <task-id>
meristem task list
meristem task retry <task-id>
```

CLI permissions:

```text
task:read    -> status/list
task:submit  -> submit
task:cancel  -> cancel
task:retry   -> retry
task:manage  -> task definition and administrative task operations
```

`meristem task assign` is not retained as a compatibility command after the Phase 11.1 cutover.

M-Task log behavior for Phase 11.1:

Audit Log is required only for explicitly defined M-Task actions and outcomes. High risk by itself does not create a generic Audit write rule.

Audit required:

- `task.submit` when accepted for execution.
- `task.cancel` when accepted or rejected by policy.
- `task.retry` when policy denies or returns `require_*`.
- `task.manage` and task definition changes.
- any task operation where M-Policy returns `require_manual_review` or `require_multi_approval`.
- any task operation where the M-Task Service Definition explicitly requires an Audit fact for that action and outcome.

Full Log required:

- `retry` allowed by policy but rejected with `not_implemented_yet`.
- `cancelRejected` or `notDeliverable` delivery outcomes.
- timeout worker errors, races, and skipped transitions.
- validation errors and dependency degradation.

Timeline required:

- `accepted`.
- `queued`.
- `dispatched`.
- `running`.
- `completed`.
- `failed`.
- `canceled`.
- `timed_out`.

`timeout` is a system-driven state transition and does not write Audit by default unless the M-Task Service Definition explicitly requires an Audit fact for the relevant task type or outcome.

Phase 11.1 must extract a shared `packages/auth` boundary before wiring M-Task as an external service. Core and M-Task may share JWT bearer parsing, actor identity shape, verification primitives, auth error mapping primitives, and fixtures through this package. M-Task must not copy Core-private middleware or depend on Core at runtime for actor verification.

Pre-migration state:

- Core owns the public REST and CLI task entrypoint.
- Core persists the MVP `TaskRecord` in PostgreSQL.
- M-Net owns delivery over the active node-agent session.
- node-agent owns local execution of the MVP `noop` frame.
- M-Log and M-Policy provide audit, timeline, full-log, and authorization semantics.

M-Task must not exist merely to make an Elysia route thinner. It is justified by task behavior needing its own durable domain interface.

Phase 11 now treats that promotion trigger as active: task behavior needs cancellation, timeout, risk-aware control actions, and an independent service boundary.

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

## 3.0.1 M-Task / M-Net / node-agent Boundary

M-Task must interact with node-agent only through M-Net. It must not directly hold, inspect, or call node-agent sessions.

M-Task owns:

- task lifecycle state.
- scheduling decision for a task request.
- cancel and timeout semantics.
- task events and task log policy.

M-Net owns:

- node reachability.
- active session lookup.
- delivery to node-agent.
- delivery acknowledgement and delivery failure reasons.
- transport-level timeout.

node-agent owns:

- local task frame execution.
- local `noop` execution result.
- heartbeat and session behavior.

M-Task should call M-Net through explicit delivery operations such as:

```text
submitDelivery(taskDispatchFrame) -> deliveryAccepted | deliveryRejected
cancelDelivery(taskId) -> cancelAccepted | cancelRejected | notDeliverable
```

M-Task advances its task lifecycle from M-Net delivery results, but M-Net must not become the owner of task lifecycle semantics.

## 3.1 Phase 11 Lifecycle Scope

Phase 11 implements enough task lifecycle to justify a real M-Task boundary without turning the phase into a general scheduler.

Implemented lifecycle states:

```text
accepted
-> queued
-> dispatched
-> running
-> completed | failed | canceled | timed_out
```

Phase 11 must implement:

- `submit` as the canonical task entrypoint in M-Task.
- `cancel` as a best-effort control action that passes through M-Policy risk handling.
- `timeout` as a real system-driven state transition with Timeline / Full Log behavior.

Phase 11.1 cancel semantics:

```text
queued:
cancel -> canceled

dispatched / running:
cancel -> cancel_requested
M-Task calls M-Net cancelDelivery(taskId)
  -> cancelAccepted: canceled
  -> notDeliverable: failed or timed_out, depending current delivery state
  -> cancelRejected: remains running with Full Log explanation

completed / failed / timed_out / canceled:
cancel -> rejected terminal-state no-op
```

Phase 11.1 does not require node-agent to force-interrupt an already running task. Agent interrupt frames, running-task registries, idempotent cancellation, and execution race handling are deferred until a later task execution hardening phase.

Phase 11.1 timeout semantics:

- M-Task runs a lightweight timeout worker inside the M-Task service.
- The worker periodically scans non-terminal `task_requests`.
- The worker uses task definition or request-level `timeoutAt` values to detect expired tasks.
- The worker advances expired tasks to `timed_out` with transaction / compare-and-set protection.
- The worker publishes `task.timed_out.v0` and writes required Timeline entries.
- Timeout worker errors, races, and skipped transitions write Full Log entries.

Phase 11.1 must not introduce distributed locks, leader election, lease-based multi-worker coordination, Redis / KeyDB queues, or general retry/backoff infrastructure for timeout handling. Multi-instance timeout coordination is deferred until a later M-Task hardening phase.

Phase 11 must define but not execute real retry semantics:

- REST, Eden, CLI, event, and policy contracts for `retry` are drafted.
- `retry` danger level and risk-factor behavior are documented.
- `retry` API and CLI calls return a policy-aware `not_implemented_yet` response when policy allows the request.
- attempt, lease, idempotency, duplicate execution, worker coordination, and backoff semantics are deferred until a later M-Task hardening phase.

Phase 11.1 retry response semantics:

```text
POST /api/v0/tasks/:id/retry
meristem task retry <task-id>
```

Execution order:

```text
1. Verify actor auth.
2. Check `task:retry` permission.
3. Ask M-Policy for danger level, suspicion score, and required decision.
4. If RBAC denies or policy returns require_*, return the policy decision without entering retry execution.
5. If policy allows, return a structured `not_implemented_yet` error.
6. Write Full Log for the rejected execution attempt.
7. Write Audit only when the M-Task audit behavior explicitly requires an Audit fact for this action and outcome.
```

The structured response should include `code: "not_implemented_yet"`, `decisionId`, and a risk summary. The final HTTP status should follow the route error-mapping convention when implemented; `501 Not Implemented` is the default planning assumption unless the contract chooses a more specific Meristem business error.

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

The existing `task:assign` permission is replaced by M-Task permissions during this phase. Phase 11 must update permission docs and seed data rather than keeping a compatibility window.

Phase 11.1 event ownership:

```text
M-Task publishes:
task.requested.v0
task.queued.v0
task.dispatched.v0
task.running.v0
task.completed.v0
task.failed.v0
task.cancel.requested.v0
task.canceled.v0
task.timed_out.v0

M-Task defines but does not actively execute real retry semantics yet:
task.retry.requested.v0
task.retry.rejected.v0
```

Event boundaries:

- M-Task owns task event payload semantics.
- M-EventBus owns event envelope, delivery, and transport infrastructure.
- M-Net may publish delivery, session, and network events, but not canonical task lifecycle events.
- node-agent may return execution result frames, but does not publish authoritative Meristem task events directly.
- Core must not publish canonical task lifecycle events after the Phase 11.1 cutover.

---

## 5. State Model

Phase 11.1 moves canonical task lifecycle state into M-Task-owned PostgreSQL tables. The old Core-owned `tasks` table must not remain the canonical task state source after the cutover.

Phase 11.1 authoritative state:

- `task_definitions`
- `task_requests`
- `task_transitions`
- `task_results`
- `task_cancellations`

Deferred until real retry / lease semantics are implemented:

- `task_attempts`
- `task_leases`

All task lifecycle state is Authoritative State in PostgreSQL unless a later ADR states otherwise. M-EventBus task events are not authoritative state. OpenSearch task projections are read models only.

This is a breaking data-model migration for the MVP task path. Phase 11 may require local development resets or explicit migrations; production-grade historical task row compatibility is not part of v0.1 unless a later migration plan adds it.

---

## 6. Breaking Migration Path

1. Define `M-Task` service document and contracts.
2. Add `services/m-task/` as the canonical task service.
3. Move canonical task state, permissions, contracts, CLI commands, REST routes, events, audit, and Timeline behavior to M-Task.
4. Remove Core-owned task orchestration from the canonical path.
5. Replace `task:assign` with M-Task permissions in docs, seed data, tests, and examples.
6. Update MVP and roadmap docs so the demo loop targets M-Task rather than Core-owned task assignment.

---

## 7. Out of Scope

Phase 11 draft does not include:

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
- Core-owned task orchestration is removed from the canonical task path.
- Tests are defined for the new M-Task behavior and for absence of accidental Core task ownership.
