# M-Policy Service Definition

## 1. Identity

| Field | Value |
|-------|-------|
| name | `m-policy` |
| version | `0.1.0` |
| domain | `m-policy` |
| kind | `internal` |
| owner | Meristem policy maintainers |

---

## 2. Responsibility

M-Policy owns permissions, policy evaluation, risk classification, approval decisions, and protected-operation authorization results.

What this service owns:

- RBAC allow / deny evaluation
- user, role, permission, resource, action, node-scope, and service-scope primitives
- protected REST and CLI permission checks
- Audit integration for permission changes and denials
- internal loopback HTTP + Eden authorization API for Core
- `policy.decision.created.v0` publication through M-EventBus
- approval queue state, votes, quorum evaluation, expiration, and lifecycle events
- external approval REST API for operators and internal approval creation API for M-Task

What this service does not yet own in the current baseline:

- advanced danger-level models
- confidence / suspicion scoring beyond the current bounded baseline
- LLM-assisted explanations as a required policy path

---

## 3. Contracts

| Contract | Path / Subject | Version | Notes |
|----------|----------------|---------|-------|
| REST / internal HTTP | `/internal/v0/authorize`, `/internal/v0/decisions/:id`, `/internal/v0/policy/approvals`, `/api/v0/policy/approvals*` | `v0` | loopback auth plus external approval routes |
| Eden | `@meristem/contracts/mpolicy` | `0.1.0` | typed internal client surface |
| Events | `policy.decision.created.v0`, `policy.approval.*.v0` | `v0` | see `docs/events/EVENT-CATALOG.md` |

Decision results include:

```ts
type MPolicyDecisionResult =
  | 'allow'
  | 'deny'
  | 'require_mfa'
  | 'require_single_approval'
  | 'require_multi_approval'
  | 'require_llm_summary'
  | 'require_manual_review'
  | 'require_delay'
  | 'require_limited_scope'
  | 'require_readonly_mode'
  | 'require_core_node_only'
  | 'require_audit_lock'
```

---

## 4. Permissions

| Permission | Required For | Risk |
|------------|--------------|------|
| `policy:approval-read` | list and show approvals | medium |
| `policy:approval-approve` | approve pending requests | high |
| `policy:approval-reject` | reject pending requests | high |
| `policy:approval-manage` | administrative approval management | high |

---

## 5. Dependencies

| Dependency | Type | Failure Behavior |
|------------|------|------------------|
| PostgreSQL | datastore | approval and decision persistence fail closed |
| M-Log | service | high-risk decision paths fail closed when required Audit writes are unavailable |
| M-EventBus | service | event publication failure degrades explicitly after state handling |

---

## 6. Configuration

| Key | Type | Required | Hot Reload | Notes |
|-----|------|----------|------------|-------|
| `MERISTEM_MPOLICY_PORT` | number | yes | no | loopback bind |
| `MERISTEM_INTERNAL_TOKEN` | string | yes | no | internal service authentication |
| `DATABASE_URL` | string | yes | no | approval and decision persistence |

---

## 7. Health

| Check | Meaning | Failure Behavior |
|-------|---------|------------------|
| liveness | process is running | restart or report unavailable |
| readiness | decision, approval, and Audit-required paths are usable | protected operations fail closed |

---

## 8. Lifecycle

| Capability | Supported | Notes |
|------------|-----------|-------|
| reloadable | limited | bounded config reload only |
| rollbackable | no | policy and approval decisions are not rolled back automatically |
| degradable | limited | conservative fallback still fails closed for protected operations |

---

## 9. Logs

| Log | When Written | Required Fields |
|-----|--------------|-----------------|
| Timeline | approval lifecycle and decision summaries | `summary`, `subject`, `correlationId` |
| Full | evaluation failures, fallback decisions, service degradation | `source`, `level`, `message`, `traceId`, `correlationId` |
| Audit | permission changes, denials, approval state changes, high-risk decision paths | `actor`, `action`, `resource`, `decision` |

---

## 10. Policy Requirements

- suspicion must reference confidence but is not `1 - confidence`.
- LLM output is advisory only and must never become final authorization.
- high-risk decision processes must write Audit facts.
- if RBAC fails, protected operations fail closed.
- if risk logic fails, fallback remains RBAC + conservative policy.
- approval routes must enforce `policy:approval-read`, `policy:approval-approve`, `policy:approval-reject`, or `policy:approval-manage` before returning or mutating approval state.
- approved, rejected, or expired approval transitions must publish `policy.approval.*.v0` and write Audit + Timeline facts.

---

## 11. Done Criteria

- admin and normal-user roles are distinguishable.
- protected APIs require permission.
- CLI commands can call policy checks through Core.
- permission denials write Full Log and Audit when required.
- policy tests cover allow, deny, missing role, missing resource, and fail-closed behavior.
- approval tests cover list/detail/create, approve/reject, self-vote denial, duplicate-vote denial, expiration, event publication, and M-Task resume/reject callbacks.
- the current boundary remains `http://127.0.0.1:3101` with `/health`, `/ready`, `/internal/v0/authorize`, `/internal/v0/decisions/:id`, and the external/internal approval routes.
