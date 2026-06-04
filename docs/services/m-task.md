# M-Task Service Definition

## 1. Identity

| Field | Value |
|-------|-------|
| name | `m-task` |
| version | `0.1.0` |
| domain | `m-task` |
| kind | `task` |
| owner | Meristem task lifecycle maintainers |

---

## 2. Responsibility

M-Task owns Meristem task lifecycle behavior after the Phase 11 cutover.

Owns:

- task type registry and versioned task definitions
- task lifecycle state machine
- task submission, cancellation, timeout, completion, and failure semantics
- M-Task-owned PostgreSQL authoritative task state
- canonical task lifecycle event payload semantics
- task delivery coordination through M-Net
- task Timeline / Full / Audit behavior defined by action and outcome
- task policy and risk requirements in cooperation with M-Policy
- Phase 12 suspended operation state for task operations blocked by `require_manual_review` or `require_multi_approval`
- internal resume/reject execution for approved or rejected policy approvals

Must not own:

- M-Net transport, reachability, active session lookup, or session authentication
- node-agent local execution internals
- final authorization decisions; M-Policy remains the decision source
- Audit Log storage; M-Log remains the log fact source
- OpenSearch as authoritative task state
- general workflow automation, cron, Temporal, Tekton, or job orchestration platforms

---

## 3. Contracts

| Contract | Path / Subject | Version | Notes |
|----------|----------------|---------|-------|
| REST | `/api/v0/tasks`, `/api/v0/task-definitions` | `v0` | Canonical external task API after Phase 11.1 |
| Internal REST | `/internal/v0/task-operations/:id/resume`, `/internal/v0/task-operations/:id/reject` | `v0` | M-Policy approval callbacks; requires `x-meristem-internal-token` |
| OpenAPI | M-Task OpenAPI document | `v0` | Task routes must be tagged as M-Task owned |
| Eden | `@meristem/contracts/m-task` | `0.1.0` | Internal TypeScript contract for M-CLI / M-UI / service clients |
| Effect Schema | `packages/contracts/src/schemas/tasks.ts` | `0.1.0` | Executable task contracts and drift checks |
| Events | `task.*.v0` | `v0` | See `docs/events/EVENT-CATALOG.md` |

Initial REST shape:

```text
GET  /api/v0/tasks
POST /api/v0/tasks
GET  /api/v0/tasks/:id
POST /api/v0/tasks/:id/cancel
POST /api/v0/tasks/:id/retry
GET  /api/v0/task-definitions
POST /internal/v0/task-operations/:id/resume
POST /internal/v0/task-operations/:id/reject
```

---

## 4. Permissions

| Permission | Required For | Risk |
|------------|--------------|------|
| `task:read` | task list, status, history, and task definitions | low |
| `task:submit` | submit a task request | medium |
| `task:cancel` | request task cancellation | high |
| `task:retry` | request retry contract path | high |
| `task:manage` | manage task definitions and administrative task behavior | critical |

The MVP-era `task:assign` permission is replaced during Phase 11.1. It is not a compatibility permission after the cutover.

---

## 5. Dependencies

| Dependency | Type | Failure Behavior |
|------------|------|------------------|
| PostgreSQL | datastore | task writes and lifecycle transitions fail closed when authoritative state is unavailable |
| M-Net | service | dispatch and cancellation delivery fail or degrade explicitly; M-Task does not call node-agent directly |
| M-Policy | service | protected task operations fail closed |
| M-Log | service | operations that require Audit fail closed if Audit write fails; Timeline / Full degradation follows explicit log behavior |
| M-EventBus | service | event publication failures degrade explicitly and write Full Log; authoritative state remains PostgreSQL |
| `packages/auth` | shared package | M-Task cannot expose external task routes without shared actor auth primitives |
| OpenTelemetry | telemetry | operation continues when exporter is unavailable; trace context remains locally correlated |

---

## 6. Configuration

| Key | Type | Required | Hot Reload | Notes |
|-----|------|----------|------------|-------|
| `M_TASK_PORT` | number | yes | no | external REST / OpenAPI port for M-Task |
| `DATABASE_URL` | string | yes | no | PostgreSQL authoritative task state |
| `MERISTEM_JWT_SECRET` or key reference | string | yes | yes | actor JWT verification through `packages/auth` |
| `M_POLICY_URL` | URL | yes | yes | policy and risk decision service |
| `M_LOG_URL` | URL | yes | yes | Timeline / Full / Audit writes |
| `M_EVENTBUS_URL` | URL | yes | yes | task lifecycle event publication |
| `M_NET_URL` | URL | yes | yes | delivery and cancellation coordination |
| `M_TASK_TIMEOUT_SCAN_INTERVAL_MS` | number | yes | yes | lightweight timeout worker interval |

---

## 7. Health

| Check | Meaning | Failure Behavior |
|-------|---------|------------------|
| liveness | process and event loop are alive | restart M-Task |
| readiness | REST, auth config, PostgreSQL, M-Policy, M-Log, M-Net, and M-EventBus minimums are ready | remove M-Task from serving pool |
| timeout-worker | lightweight timeout worker is active | mark M-Task degraded and write Full Log |

---

## 8. Lifecycle

| Capability | Supported | Notes |
|------------|-----------|-------|
| reloadable | yes | dependency URLs, auth key references, and timeout scan interval may reload when supported |
| rollbackable | no | task state migrations are not rolled back automatically in Phase 11 |
| degradable | yes | read/status paths may degrade; protected writes fail closed when policy, audit, or state dependencies are unavailable |

---

## 9. Logs

| Log | When Written | Required Fields |
|-----|--------------|-----------------|
| Timeline | accepted, queued, dispatched, running, completed, failed, canceled, timed_out | `taskId`, `taskType`, `state`, `correlationId`, `traceId` |
| Full | validation errors, dependency degradation, retry not implemented, cancel delivery failures, timeout worker errors/races/skips | `taskId`, `source`, `level`, `message`, `correlationId`, `traceId` |
| Audit | explicitly defined task actions/outcomes such as accepted submit, policy-rejected cancel, policy escalation, retry deny/require_*, and task definition changes | `actor`, `action`, `resource`, `decisionId`, `correlationId`, `traceId` |

Audit is defined by M-Task action and outcome rules. High risk alone does not create a generic Audit write rule. System-driven timeout does not write Audit by default unless a task definition or service rule explicitly requires it.

---

## 10. Policy Requirements

- Every external M-Task route verifies actor JWT bearer credentials at the M-Task boundary.
- Protected operations call M-Policy before execution.
- RBAC denial fails closed.
- M-Policy risk output may return `allow`, `deny`, `require_manual_review`, or `require_multi_approval` for Phase 11 task actions.
- `require_manual_review` and `require_multi_approval` create an M-Task suspended operation plus an M-Policy approval record, then block execution until M-Policy calls the internal resume or reject endpoint.
- Internal approval callbacks do not rerun risk decision; they validate internal auth, suspended operation state, expiration, idempotency, and target task freshness.
- Audit writes are required only for explicitly defined M-Task actions and outcomes.

---

## 11. Done Criteria

- M-Task exposes the canonical `/api/v0/tasks` and `/api/v0/task-definitions` routes.
- Core no longer owns canonical task routes, task state, task lifecycle events, or task log facts.
- M-Task uses `packages/auth` for actor auth primitives.
- M-Task persists task lifecycle state in M-Task-owned PostgreSQL tables.
- M-Task publishes canonical `task.*.v0` lifecycle events through M-EventBus.
- M-Task coordinates delivery through M-Net and never calls node-agent sessions directly.
- `submit`, best-effort `cancel`, and timeout worker behavior are implemented.
- `retry` returns a policy-aware `not_implemented_yet` response without executing retry.
- Approval-required operations create `task_suspended_operations`, call M-Policy approval creation, and publish `task.operation.suspended.v0`.
- Approved callbacks transition suspended operations to `resumed` or `resume_failed`; rejected callbacks transition to `rejected` without executing the original operation.
- Timeline / Full / Audit behavior follows this Service Definition.
- Tests cover auth, RBAC, risk escalation, state transitions, event publication, logging, timeout worker, cancellation, retry not implemented, and dependency failure paths.
