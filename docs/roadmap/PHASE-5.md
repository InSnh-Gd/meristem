# Phase 5 - M-Policy RBAC MVP

> Goal: implement minimal RBAC so protected MVP operations are gated and auditable.

---

## 1. Scope

Phase 5 includes:

- users table.
- roles table.
- permissions table.
- role-permission assignments.
- actor context for CLI/API.
- policy decision table.
- RBAC allow / deny.
- protected node registration.
- protected task submitment.
- protected audit read.
- Audit Log integration for protected operations.

Phase 5 excludes:

- confidence score.
- suspicion score.
- multi-party decision flow.
- LLM-assisted decisioning.
- MFA implementation.

---

## 2. MVP Roles

| Role | Purpose |
|------|---------|
| `viewer` | read Core status, nodes, and Timeline |
| `operator` | viewer + register nodes and assign noop tasks |
| `admin` | operator + register services and publish safe config |
| `security-admin` | admin + read Audit Log and manage policy seed data |

---

## 3. Protected Operations

| Operation | Permission | Minimum Role |
|-----------|------------|--------------|
| read status | `core:read` | viewer |
| register node | `node:register` | operator |
| assign noop task | `task:submit` | operator |
| read Timeline | `timeline:read` | viewer |
| read Audit | `audit:read` | security-admin |
| register service | `service:register` | admin |

---

## 4. Completion Criteria

- Protected REST endpoints call M-Policy.
- Protected CLI commands pass actor context.
- viewer cannot register node.
- operator can register node and assign noop task.
- operator cannot read Audit Log.
- security-admin can read Audit Log.
- policy decisions persist in PostgreSQL.
- permission denial writes Full Log and Audit entry where required.

---

## 5. Verification Checklist

```bash
meristem status
meristem node register --kind leaf --name local-leaf
meristem task submit --leaf <leaf-node-id> --type noop
meristem audit list
```

Role checks:

- run node registration as viewer and expect deny
- run audit list as operator and expect deny
- run audit list as security-admin and expect allow
