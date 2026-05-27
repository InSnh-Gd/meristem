# Phase 18 - SecretRef v0.1 Control Plane

> Goal: implement the minimum Core-owned secretRef control plane with M-Policy authorization and M-Log Audit, without creating M-Secret or introducing a production secret manager.

---

## 1. Scope

Phase 18 turns the existing secretRef placeholder into a bounded v0.1 control plane:

```text
Core-owned secretRef metadata
secret value write-once / rotate path
M-Policy authorization for secret operations
Audit before high-risk secret operations
redaction rules across logs, OpenSearch, UI, errors, and LLM prompts
CLI and REST control-plane commands
```

Phase 18 keeps ADR-021 intact: no M-Secret service is created.

---

## 2. Accepted Decisions

- Core owns secretRef entrypoints and authoritative metadata.
- M-Policy authorizes secret create, rotate, reference, read-metadata, and disable operations.
- M-Log audits secret operations.
- Secret values must never appear in Timeline, Full Log payloads, Audit payloads, OpenSearch projections, UI errors, or LLM prompts.
- Phase 18 stores only local development secret values using the accepted v0.1 storage mechanism. Production KMS / Vault integration is deferred.
- External services receive only `secretRef`, never plaintext secret values.

---

## 3. Out Of Scope

Phase 18 excludes:

- standalone M-Secret service.
- Vault / KMS / cloud secret manager integration.
- envelope encryption service.
- secret leasing.
- cross-node secret distribution.
- secret access by M-Extension runtime.
- UI secret management.
- automated rotation schedules.
- production backup / restore for secret material.

---

## 4. Target Files

Expected implementation targets:

```text
apps/core/src/routes/secrets.ts
apps/core/src/storage-adapter.ts
packages/contracts/src/secrets/**
packages/db/src/schema.ts
packages/db/src/migrate.ts
apps/m-cli/src/**
tests/contracts/secret-ref.test.ts
tests/cli/cli-secrets.test.ts
tests/failure-modes/secret-redaction.test.ts
tests/failure-modes/secret-policy.test.ts
```

Required documentation targets:

```text
docs/security/SECURITY-MODEL.md
docs/data/STATE-MODEL.md
docs/contracts/REST-API-MVP.md
docs/contracts/CLI-COMMANDS.md
docs/events/EVENT-CATALOG.md
docs/services/core.md
docs/testing/TESTING.md
```

---

## 5. SecretRef Contract

```ts
type SecretRefV01 = {
  id: string;
  version: "secret-ref@0.1.0";
  name: string;
  scope: "system" | "service" | "node";
  owner: "core";
  status: "active" | "rotated" | "disabled";
  createdBy: string;
  createdAt: string;
  rotatedAt?: string;
  disabledAt?: string;
  metadata: Record<string, string>;
};
```

Secret values are never returned after create / rotate. Metadata must be non-secret.

---

## 6. State Model

Core owns:

```text
secret_refs
secret_ref_versions
secret_ref_transitions
```

Suggested fields:

```text
secret_refs:
  id
  name
  scope
  status
  created_by
  created_at
  updated_at

secret_ref_versions:
  id
  secret_ref_id
  version
  value_ciphertext_or_local_dev_value
  created_by
  created_at
  disabled_at

secret_ref_transitions:
  id
  secret_ref_id
  from_status
  to_status
  actor
  reason
  policy_decision_id
  correlation_id
  created_at
```

Phase 18 may use local development storage only if docs and tests prove redaction. Production storage integration is deferred.

---

## 7. Permissions

```text
secret:read-metadata
secret:create
secret:rotate
secret:disable
secret:reference
```

Suggested role defaults:

```text
viewer: none
operator: none
admin: secret:read-metadata, secret:reference
security-admin: secret:read-metadata, secret:create, secret:rotate, secret:disable, secret:reference
```

All mutating operations require M-Policy and Audit.

---

## 8. REST API

Core owns:

```text
GET  /api/v0/secrets
GET  /api/v0/secrets/:id
POST /api/v0/secrets
POST /api/v0/secrets/:id/rotate
POST /api/v0/secrets/:id/disable
POST /internal/v0/secrets/:id/reference
```

Rules:

- external read routes return metadata only.
- create / rotate may return the new `secretRef` but never echo the plaintext value.
- internal reference route returns only a scoped reference result unless the caller is a trusted Core-owned operation explicitly allowed by the security model.

---

## 9. CLI Commands

```text
meristem secret list
meristem secret show <secret-ref-id>
meristem secret create --name <name> --scope system|service|node --value-stdin
meristem secret rotate <secret-ref-id> --value-stdin --reason <text>
meristem secret disable <secret-ref-id> --reason <text>
```

CLI must never print plaintext secret values.

---

## 10. Completion Criteria

- secretRef metadata and version state are authoritative in PostgreSQL.
- mutating secret operations require M-Policy and Audit.
- secret plaintext is never logged or returned after create / rotate.
- OpenSearch projections and error envelopes cannot contain secret values.
- CLI supports list / show / create / rotate / disable without leaking values.
- no M-Secret service is introduced.

---

## 11. Verification Checklist

```text
secretRef contract tests
create / rotate / disable policy allow tests
policy denial fail-closed tests
Audit unavailable fail-closed tests
secret redaction tests for Timeline / Full / Audit / errors
CLI value-stdin redaction smoke test
OpenSearch projection redaction test
```

