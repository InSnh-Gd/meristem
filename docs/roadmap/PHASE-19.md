# Phase 19 - Config Lifecycle v0.1

> Goal: implement the minimum authoritative configuration lifecycle for v0.1 control-plane changes without building a broad configuration platform or UI authoring system.

---

## 1. Scope

Phase 19 turns `docs/config/CONFIG-LIFECYCLE.md` into the first executable v0.1 control-plane lifecycle:

```text
config draft records
schema validation
version and hash generation
publish state transition
apply / ack records for central services
rollback to known version
M-Policy and Audit for high-risk config
REST and CLI control-plane commands
```

The first supported config domains are deliberately narrow:

```text
service runtime config metadata
OpenTelemetry config
M-Net profile config metadata handoff
M-Extension config schema metadata handoff
```

---

## 2. Accepted Decisions

- Core owns the generic Config Lifecycle v0.1 control plane.
- Domain services own domain-specific interpretation and apply behavior.
- M-Policy authorizes publish / rollback for protected config domains.
- M-Log writes Timeline / Full / Audit facts.
- Config records are versioned and hash-addressed.
- Config lifecycle is not a UI authoring system in Phase 19.
- Phase 19 does not replace Phase 13 M-Net profile lifecycle; it only creates the generic lifecycle that M-Net can later absorb.

---

## 3. Out Of Scope

Phase 19 excludes:

- collaborative config editing.
- M-UI config authoring.
- node-level broad config distribution.
- production rollout waves.
- feature flag platform.
- secret value storage in config.
- full policy DSL editor.
- automatic config drift remediation.
- cross-cluster config federation.

---

## 4. Target Files

Expected implementation targets:

```text
apps/core/src/routes/config.ts
apps/core/src/storage-adapter.ts
packages/contracts/src/config/**
packages/db/src/schema.ts
packages/db/src/migrate.ts
apps/m-cli/src/**
tests/contracts/config-lifecycle.test.ts
tests/cli/cli-config.test.ts
tests/failure-modes/config-lifecycle.test.ts
tests/integration/config-apply.test.ts
```

Required documentation targets:

```text
docs/config/CONFIG-LIFECYCLE.md
docs/contracts/REST-API-MVP.md
docs/contracts/CLI-COMMANDS.md
docs/data/STATE-MODEL.md
docs/events/EVENT-CATALOG.md
docs/security/SECURITY-MODEL.md
docs/testing/TESTING.md
```

---

## 5. Config Contract

```ts
type ConfigRecordV01 = {
  id: string;
  configVersion: string;
  schemaVersion: string;
  configHash: string;
  domain: "core" | "m-net" | "m-policy" | "m-log" | "m-extension" | "m-ui";
  targetScope: string[];
  status: "draft" | "validated" | "published" | "applied" | "failed" | "rolled_back";
  createdBy: string;
  createdAt: string;
  publishedBy?: string;
  publishedAt?: string;
  rollbackVersion?: string;
};
```

Config payloads must be schema validated and deterministic-hashable. Secret values are prohibited; use `secretRef` only.

---

## 6. State Model

Core owns:

```text
config_records
config_versions
config_apply_acks
config_transitions
```

Rules:

- PostgreSQL is authoritative.
- events notify apply and Audit flows but are not authoritative config state.
- OpenSearch may project config lifecycle facts later but must not become source of truth.

---

## 7. State Machine

Phase 19 implements:

```text
draft
-> validated
-> published
-> applied
```

Failure / rollback:

```text
validated -> failed
published -> failed
applied -> rolled_back
failed -> rolled_back
```

No implementation may skip validation, versioning, hash generation, publish, and apply acknowledgement.

---

## 8. Permissions

```text
config:read
config:draft
config:validate
config:publish
config:rollback
```

Suggested role defaults:

```text
viewer: config:read
operator: config:read, config:validate
admin: config:read, config:draft, config:validate, config:publish, config:rollback
security-admin: admin permissions
```

High-risk config domains require M-Policy and Audit before publish / rollback.

---

## 9. REST API

Core owns:

```text
GET  /api/v0/configs
GET  /api/v0/configs/:id
POST /api/v0/configs/drafts
POST /api/v0/configs/:id/validate
POST /api/v0/configs/:id/publish
POST /api/v0/configs/:id/rollback
POST /internal/v0/configs/:id/apply-ack
```

Domain services must use declared internal apply / ack contracts. They must not mutate Core config tables directly.

---

## 10. CLI Commands

```text
meristem config list
meristem config show <config-id>
meristem config draft --domain <domain> --file <path>
meristem config validate <config-id>
meristem config publish <config-id> --reason <text>
meristem config rollback <config-id> --to <version> --reason <text>
```

---

## 11. Events

```text
config.validated.v0
config.publish.requested.v0
config.published.v0
config.apply.acked.v0
config.apply.failed.v0
config.rollback.requested.v0
config.rolled_back.v0
```

Existing config subjects should be reused where compatible. New subjects must be added to `docs/events/EVENT-CATALOG.md` before implementation.

---

## 12. Completion Criteria

- Config lifecycle has authoritative PostgreSQL state.
- Config versions and hashes are deterministic and test-covered.
- publish / rollback for protected domains require M-Policy and Audit.
- domain apply acknowledgements are recorded.
- secret values are rejected from config payloads.
- CLI and REST contracts match docs.
- Phase 13 M-Net profile state remains compatible but is not silently migrated.

---

## 13. Verification Checklist

```text
schema validation tests
deterministic hash tests
publish policy allow / deny tests
Audit unavailable fail-closed tests
apply ack integration tests
rollback tests
secretRef-only config tests
CLI config smoke test
event contract tests
```

