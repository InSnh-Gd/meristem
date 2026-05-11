# M-Policy Service Definition

## 1. Identity

| Field | Value |
|-------|-------|
| name | `m-policy` |
| version | `0.1.0` |
| domain | `m-policy` |
| kind | `internal` |

---

## 2. Responsibility

M-Policy owns permissions, policy evaluation, risk classification, confidence, suspicion, and multi-factor decision flow.

v0 owns:

- RBAC allow / deny
- user, role, permission, resource, action, node scope, service scope primitives
- protected REST and CLI permission checks
- Audit Log integration for permission changes and denials
- internal loopback HTTP + Eden authorization API for Core
- `policy.decision.created.v0` publication through M-EventBus

Later phases add:

- operation danger levels
- confidence score
- suspicion score
- multi-party decision flow
- LLM-assisted explanation

---

## 3. Decision Results

```ts
type MPolicyDecisionResult =
  | "allow"
  | "deny"
  | "require_mfa"
  | "require_single_approval"
  | "require_multi_approval"
  | "require_llm_summary"
  | "require_manual_review"
  | "require_delay"
  | "require_limited_scope"
  | "require_readonly_mode"
  | "require_core_node_only"
  | "require_audit_lock";
```

---

## 4. Non-Negotiable Rules

- Suspicion must reference confidence but is not `1 - confidence`.
- LLM output is advisory and must never be final authorization.
- High-risk decision process must be written to Audit Log.
- If RBAC fails, protected operations fail closed.
- If risk algorithm fails, fallback is RBAC + operation danger level + conservative policy.

---

## 5. Done Criteria

- Admin and normal user roles are distinguishable.
- Protected API requires permission.
- CLI command can call policy check.
- Permission denial writes Full Log and Audit Log where required.
- Policy tests cover allow, deny, missing role, missing resource, and failure-closed behavior.

Current MVP boundary:

- listens on `http://127.0.0.1:3101`
- requires `x-meristem-internal-token` for `/ready` and `/internal/v0/*`
- exposes `/health`, `/ready`, `/internal/v0/authorize`, `/internal/v0/decisions/:id`
