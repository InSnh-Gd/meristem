# Phase 12 - Approval Execution Flow

> Goal: turn Phase 11 pending policy escalations into an executable, auditable approval and resume flow without introducing LLM authorization or a separate approval service.

---

## 1. Scope

Phase 12 implements **Phase 12A: Approval Execution Flow** only.

Phase 11 can return `require_manual_review` or `require_multi_approval` for M-Task control actions and block execution. Phase 12A completes that loop:

```text
M-Task operation is blocked by M-Policy
-> M-Task stores a suspended operation
-> M-Policy stores an approval record
-> security-admin approves, rejects, or the approval expires
-> M-Task resumes only approved operations through an explicit resume contract
-> M-Log records the approval and resume trail
```

Phase 12 does not implement LLM-assisted review. LLM explanation is deferred until the approval flow, read models, and formal M-UI are stable enough to present context safely.

---

## 2. Accepted Decisions

Phase 12A follows these decisions:

- Approval queue ownership stays in `M-Policy`; no `M-Approval` service is introduced.
- Source services own suspended operation payloads and resume behavior.
- Phase 12A supports only M-Task origin operations: `task.submit`, `task.cancel`, and `task.retry`.
- Approval uses source-service `resume` contracts, not HTTP request replay.
- Resume does not rerun the full M-Policy risk decision; origin services run safety, stale-state, and idempotency checks before execution.
- Approval APIs are external operator APIs owned by M-Policy, with CLI commands as the first operator surface.
- M-UI approval screens are deferred. Phase 12A may define display contracts for later M-UI / BFF work, but UI implementation is not required.
- Quorum is fixed in Phase 12A: manual review requires one `security-admin`; multi-approval requires two distinct `security-admin` actors.
- The original actor cannot approve their own pending operation.
- Approval timeout transitions to `expired`, not `rejected`.
- Phase 12A emits approval lifecycle and resume lifecycle events, but not vote-level events.
- Approval state transitions and origin resume attempts write Audit Log; list and detail reads do not.

---

## 3. Ownership

### M-Policy Owns

- pending approval records.
- approval queue read APIs.
- approve / reject APIs.
- quorum evaluation.
- approval timeout transitions.
- final approval status: `pending`, `approved`, `rejected`, `expired`, or `canceled`.
- approval lifecycle events.

M-Policy must not execute M-Task operations, hold M-Task business payloads, or call node-agent / M-Net delivery paths.

### M-Task Owns

- suspended operation records for supported task actions.
- sanitized operation payloads.
- idempotency keys.
- resume endpoint / internal handler semantics.
- stale-state and safety checks.
- task lifecycle changes after approved resume.
- task operation suspended / resumed / resume_failed events.

M-Task must not decide approval quorum or mutate approval status directly.

### M-Log Owns

- Audit facts for approval and resume actions.
- Timeline facts for operator-visible approval lifecycle changes.
- Full Log facts for denied votes, duplicate votes, stale resume failures, idempotency conflicts, and dependency degradation.

---

## 4. External Operator API

M-Policy owns the external approval REST surface:

```text
GET  /api/v0/policy/approvals
GET  /api/v0/policy/approvals/:id
POST /api/v0/policy/approvals/:id/approve
POST /api/v0/policy/approvals/:id/reject
```

Required permissions:

```text
policy:approval-read       admin + security-admin
policy:approval-approve    security-admin
policy:approval-reject     security-admin
policy:approval-manage     security-admin
```

Initial CLI commands:

```text
meristem policy approvals list
meristem policy approvals show <approval-id>
meristem policy approvals approve <approval-id> --reason <text>
meristem policy approvals reject <approval-id> --reason <text>
```

CLI is the Phase 12A acceptance surface. Formal M-UI approval screens belong to a later UI phase.

---

## 5. State Model

Phase 12A adds authoritative PostgreSQL state owned by two services.

M-Policy-owned tables:

```text
policy_approvals
policy_approval_votes
```

M-Task-owned table:

```text
task_suspended_operations
```

Suggested fields:

```text
policy_approvals:
  id
  policy_decision_id
  origin_service
  operation_id
  requested_by
  required_action
  status
  quorum_required
  expires_at
  created_at
  updated_at
  completed_at

policy_approval_votes:
  id
  approval_id
  actor
  vote
  reason
  created_at
  unique(approval_id, actor)

task_suspended_operations:
  id
  policy_decision_id
  action
  requested_by
  resource
  sanitized_payload
  correlation_id
  idempotency_key
  status
  expires_at
  created_at
  resumed_at
  terminal_reason
```

`policy_approvals.operation_id` references the origin operation by convention, not by cross-service foreign key. PostgreSQL may be shared, but service ownership remains explicit.

---

## 6. Approval State Machine

Approval statuses:

```text
pending
approved
rejected
expired
canceled
```

Suspended operation statuses:

```text
pending_approval
resumed
rejected
expired
canceled
resume_failed
```

Timeout semantics:

- Expired approvals transition to `expired`, not `rejected`.
- `rejected` means an explicit security-admin reject vote was accepted.
- Origin services may cancel suspended operations when the source operation is no longer meaningful.
- Resume accepts only `approved` approvals and `pending_approval` suspended operations.

Default expiry:

```text
manual_review: created_at + 30 minutes
multi_approval: created_at + 30 minutes
critical operation override: created_at + 10 minutes
```

---

## 7. Quorum Rules

Manual review:

```text
required_action = manual_review
quorum_required = 1
one security-admin approve -> approved
one security-admin reject -> rejected
original actor cannot approve or reject their own operation
```

Multi approval:

```text
required_action = multi_approval
quorum_required = 2
two distinct security-admin approve votes -> approved
one security-admin reject -> rejected
original actor cannot approve or reject their own operation
same actor cannot vote twice
```

Phase 12A does not include configurable quorum, approver groups, delegation, claim / lock ownership, approval policy DSL, or escalation chains.

---

## 8. Resume Contract

Phase 12A forbids automatic HTTP request replay. Source services resume approved operations through explicit contracts.

M-Task resume checks:

```text
approval.status === approved
approval.policyDecisionId matches suspendedOperation.policyDecisionId
approval.expiresAt has not expired
suspendedOperation.status === pending_approval
operationId has not already resumed
idempotencyKey has not been consumed
target resource still exists
target resource is still eligible
actor attribution can still be preserved
```

M-Task operation checks:

```text
task.submit:
  node still exists
  node is still leaf
  node is reachable or queued mode is allowed
  timeoutAt is still valid
  task request has not already been created

task.cancel:
  task still exists
  task is not terminal
  cancel has not already been requested or applied

task.retry:
  approval can succeed, but Phase 12A still returns not_implemented_for_phase unless retry execution is explicitly moved into scope later
```

Resume does not rerun full M-Policy risk scoring. If material state changed, the origin service rejects resume with a stale / invalid / idempotency error, writes Full Log, and writes the required Audit fact.

---

## 9. Events

Phase 12A adds lifecycle events only after the authoritative state change has been written.

M-Policy publishes:

```text
policy.approval.created.v0
policy.approval.approved.v0
policy.approval.rejected.v0
policy.approval.expired.v0
policy.approval.canceled.v0
```

M-Task publishes:

```text
task.operation.suspended.v0
task.operation.resumed.v0
task.operation.resume.failure.v0
```

Phase 12A does not publish vote-level events such as `policy.approval.vote.cast.v0`. Vote facts live in PostgreSQL and Audit Log.

---

## 10. Log And Audit Rules

Audit Log required:

```text
policy.approval.create
policy.approval.vote.approve
policy.approval.vote.reject
policy.approval.approve
policy.approval.reject
policy.approval.expire
policy.approval.cancel
task.operation.resume.attempt
task.operation.resume.success
task.operation.resume.failure
```

Audit Log not required:

```text
approval list
approval detail read
malformed request validation failure
```

Timeline Log required:

```text
approval created
approval approved / rejected / expired / canceled
operation resumed / resume_failed
```

Full Log required:

```text
duplicate vote attempt
non-approver vote denied
original actor self-approval denied
stale resume check failure
idempotency conflict
dependency failure
```

Approval authorization and resume execution are distinct facts. `policy.approval.approved.v0` does not imply the origin operation executed; `task.operation.resumed.v0` or `task.operation.resume.failure.v0` records the business execution result.

---

## 11. Out Of Scope

Phase 12A excludes:

- LLM-assisted review or risk explanation.
- M-UI approval queue screens.
- new `M-Approval` service.
- approval for Core node registration, M-Net profiles, projection control actions, service reload, config publish, secret rotation, or extension registration.
- configurable approval policies or approver groups.
- request replay from HTTP logs.
- retry execution semantics beyond policy-aware `not_implemented_for_phase`.
- Redis / KeyDB queues, distributed locks, leases, or general workflow engines.

---

## 12. Target Files

Expected implementation areas:

```text
services/m-policy/
services/m-task/
packages/contracts/
packages/db/
packages/policy/
apps/m-cli/
docs/services/m-policy.md
docs/services/m-task.md
docs/contracts/REST-API-MVP.md
docs/contracts/CLI-COMMANDS.md
docs/events/EVENT-CATALOG.md
docs/security/SECURITY-MODEL.md
docs/data/STATE-MODEL.md
docs/data/POSTGRES-SCHEMA-MVP.md
docs/testing/TESTING.md
tests/contracts/
tests/failure-modes/
tests/integration/
tests/cli/
tests/e2e/
```

---

## 13. Test Gates

Contract tests:

- approval REST route schemas and OpenAPI output.
- approval CLI command contract.
- approval status and vote Effect Schema decode / encode.
- approval event subjects and payload schemas.
- M-Task suspended operation schema.
- drift checks between shared literals and Elysia adapters where duplicated.

Policy tests:

- `admin` can read approval queue but cannot approve or reject.
- `security-admin` can approve and reject.
- original actor cannot approve or reject their own operation.
- duplicate vote from the same actor is rejected.
- manual review approves with one valid security-admin vote.
- multi approval approves with two distinct security-admin votes.
- one reject vote rejects both manual and multi approval.

Failure-mode tests:

- Audit Log unavailable fails approval create / vote / terminal transition closed.
- M-Policy unavailable keeps origin operation blocked.
- M-Task resume fails safely when the target node or task is stale.
- expired approval cannot be resumed.
- consumed idempotency key cannot be resumed twice.
- event publish failure is logged and does not create a false authoritative state.

Integration tests:

- M-Task creates suspended operation and M-Policy approval for `require_manual_review`.
- approval approve leads to M-Task resume and task lifecycle execution.
- approval reject marks suspended operation rejected and does not execute.
- approval expired blocks resume.
- approval approved but stale target records `resume_failed`.

CLI tests:

- `meristem policy approvals list`.
- `meristem policy approvals show <approval-id>`.
- `meristem policy approvals approve <approval-id> --reason <text>`.
- `meristem policy approvals reject <approval-id> --reason <text>`.
- non-zero exit on missing permission, self-approval, duplicate vote, expired approval, and resume failure.

E2E smoke:

```text
Start PostgreSQL, NATS, Core, M-Policy, M-Log, M-EventBus, M-Net, M-Task, node-agent.
Create or force an M-Task action that returns require_manual_review.
List pending approvals through CLI.
Approve as security-admin.
Verify M-Task resumes or records resume_failed.
Verify Audit, Timeline, events, and task state agree.
Repeat with reject and expired paths.
```

---

## 14. Completion Criteria

Phase 12A is complete when:

- M-Policy exposes the external approval REST route family and owns approval state.
- M-CLI exposes approval list / show / approve / reject commands.
- M-Task stores suspended operations for supported task actions and owns resume behavior.
- Manual review and multi approval quorum rules are enforced exactly as documented.
- Approval timeout creates `expired`, not `rejected`.
- Original actors cannot approve or reject their own operations.
- Resume uses source-service contracts and does not replay HTTP requests.
- Resume performs safety, stale-state, and idempotency checks without rerunning the full risk decision.
- Required Audit / Timeline / Full Log behavior is implemented and tested.
- Approval lifecycle and resume lifecycle events are documented, emitted, and tested.
- Full contract, failure-mode, CLI, integration, and e2e gates pass or have documented infrastructure skip conditions.

