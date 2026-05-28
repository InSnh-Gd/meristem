# Phase 15 - M-Extension Control Plane

> Goal: establish M-Extension as a low-permission supplemental extension control plane without introducing Wasm, webhook, HTTP callback, or cloud-function execution runtime.

---

## 1. Scope

Phase 15 implements the first M-Extension governance surface:

```text
define M-Extension service boundary
define M-Extension Manifest v0.1
validate low-risk extension manifests
register extension definitions
enable / disable system-scoped extension instances
enforce M-Policy allow / deny decisions
write Timeline, Full, and Audit facts
publish extension control-plane lifecycle events
expose REST and CLI control-plane commands
```

Phase 15 is control-plane only. It proves registry, manifest versioning, policy, lifecycle, logging, events, and CLI acceptance before any extension runtime exists.

---

## 2. Accepted Decisions

- M-Extension remains a supplemental mechanism, not the primary feature layer.
- Phase 15 does not implement Wasm, webhook, HTTP callback, script, or cloud-function execution.
- `m-extension` is an independent service owner. Core does not own extension state, and M-Policy does not own extension registry state.
- Phase 15 supports only declaration-oriented extension kinds.
- `M-Extension Manifest v0.1` is a governance declaration, not an executable package format.
- Phase 15 uses a two-layer state model: extension definitions plus scoped extension instances.
- Phase 15 only supports `system/default` scope. Node, network, service, and tenant scopes are deferred.
- `register`, `enable`, and `disable` use M-Policy allow / deny plus Audit Log. They do not create Phase 12 approval records.
- High or critical risk manifests are rejected in Phase 15 instead of being routed to approval.
- Phase 15 introduces four fixed permissions and does not allow extensions to create dynamic permissions.
- Phase 15 publishes only control-plane lifecycle events, not execution events.
- M-Extension UI is out of scope.

---

## 3. Out Of Scope

Phase 15 excludes:

- Wasm3, Wasmtime, WasmGC, WASI, WIT, or Zig runtime integration.
- loading `.wasm` modules.
- webhook ingress or webhook payload execution.
- outbound HTTP callback execution.
- script execution.
- arbitrary command execution.
- cloud-function runtime behavior.
- marketplace install / upgrade flows.
- extension secrets binding.
- extension config editor.
- extension approval queue integration.
- node, network, service, tenant, or user-scoped extension instances.
- M-Extension UI or BFF routes.
- extension execution events, retries, leases, or runtime metrics.

---

## 4. Target Files

Expected implementation targets:

```text
services/m-extension/**
packages/contracts/src/extension/**
packages/cli/**
tests/contracts/m-extension-manifest.test.ts
tests/contracts/m-extension-service.test.ts
tests/cli/cli-extension.test.ts
tests/failure-modes/m-extension-policy.test.ts
tests/failure-modes/m-extension-logs.test.ts
```

Required documentation targets:

```text
docs/services/m-extension.md
docs/contracts/REST-API-MVP.md
docs/contracts/CLI-COMMANDS.md
docs/events/EVENT-CATALOG.md
docs/data/STATE-MODEL.md
docs/security/SECURITY-MODEL.md
docs/testing/TESTING.md
docs/roadmap/DEFERRED-WORK.md
```

---

## 5. Service Boundary

`m-extension` owns:

- extension definition registry.
- extension instance lifecycle.
- manifest validation.
- extension capability and permission declarations.
- extension control-plane REST API.
- extension lifecycle events.
- extension Timeline / Full / Audit write requests.

`m-extension` must not own:

- Core service registry.
- M-Policy authorization decisions.
- M-Log storage.
- M-EventBus transport internals.
- Wasm, webhook, HTTP callback, script, or cloud-function execution.
- secret storage or secret plaintext.
- M-UI / BFF display aggregation.

The service definition is `docs/services/m-extension.md`.

---

## 6. Manifest v0.1 Contract

Phase 15 defines `MExtensionManifestV01`:

```ts
type MExtensionManifestV01 = {
  id: string;
  manifestVersion: "m-extension-manifest@0.1.0";
  displayName: string;
  description?: string;
  kind:
    | "metadata-only"
    | "webhook-declared"
    | "wasm-placeholder"
    | "http-callback-placeholder";
  owner: string;
  license: string;
  declaredCapabilities: string[];
  requestedPermissions: string[];
  configSchemaRef?: string;
  requestedEvents?: string[];
  emittedEvents?: string[];
  riskClass: "low" | "medium";
  lifecycleStatus: "draft" | "active" | "deprecated";
  controlPlaneOnly: true;
  futureEntrypoint?: string;
  futureRuntime?: string;
  futureWebhookVerification?: string;
  futureResourceLimits?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
};
```

Validation rules:

- `manifestVersion` is required and versioned under contract versioning rules.
- `controlPlaneOnly` must be `true`.
- `riskClass` may only be `low` or `medium`.
- `requestedPermissions` must reference known Meristem permissions.
- unknown permissions are rejected.
- `high` and `critical` risk manifests are rejected.
- `configSchemaRef` may reference only schema metadata, not secret values.

Manifest v0.1 must not contain:

- inline code.
- script bodies.
- executable command strings.
- secret values.
- raw webhook tokens.
- a Wasm binary path used for loading.
- unversioned config blobs.

---

## 7. Supported Extension Kinds

Phase 15 supports declaration kinds only:

| Kind | Meaning | Execution Behavior |
|------|---------|--------------------|
| `metadata-only` | registry-only extension metadata | none |
| `webhook-declared` | future webhook extension declaration | no ingress, no execution |
| `wasm-placeholder` | future Wasm extension declaration | no runtime dependency, no module loading |
| `http-callback-placeholder` | future outbound callback declaration | no outbound request |

Phase 15 rejects these execution kinds if submitted:

```text
wasm-runtime
webhook-handler
cloud-function
script
arbitrary-http-executor
```

---

## 8. State Model

M-Extension owns these PostgreSQL authoritative tables:

```text
extension_definitions
extension_instances
extension_transitions
```

Suggested fields:

```text
extension_definitions:
  id
  manifest_version
  kind
  display_name
  owner
  license
  manifest
  declared_capabilities
  requested_permissions
  risk_class
  status
  registered_by
  policy_decision_id
  correlation_id
  created_at
  updated_at

extension_instances:
  id
  extension_id
  scope_type
  scope_id
  status
  enabled_by
  disabled_by
  policy_decision_id
  correlation_id
  last_error
  created_at
  updated_at
  enabled_at
  disabled_at

extension_transitions:
  id
  extension_id
  instance_id
  from_status
  to_status
  actor
  reason
  policy_decision_id
  correlation_id
  created_at
```

Definition statuses:

```text
registered
rejected
deprecated
```

Instance statuses:

```text
disabled
enabled
enable_failed
disable_failed
```

Phase 15 supports only:

```text
scopeType = "system"
scopeId = "default"
```

---

## 9. Permissions And Policy

Phase 15 introduces fixed permissions:

```text
extension:read
extension:register
extension:enable
extension:disable
```

Suggested role defaults:

```text
viewer: extension:read
operator: extension:read
admin: extension:read, extension:register, extension:enable, extension:disable
security-admin: extension:read, extension:register, extension:enable, extension:disable, audit:read
```

Rules:

- all write operations call M-Policy.
- M-Policy denial fails closed and writes the expected denied decision evidence.
- `register`, `enable`, and `disable` write Audit Log when allowed.
- unknown manifest permissions reject registration.
- extensions cannot create new permissions.
- requested high or critical risk capabilities reject registration.
- Phase 15 does not create approval records for extension operations.

---

## 10. External REST API

M-Extension owns these external REST routes:

```text
GET  /api/v0/extensions
GET  /api/v0/extensions/:id
POST /api/v0/extensions/register
POST /api/v0/extensions/:id/enable
POST /api/v0/extensions/:id/disable
```

Route permissions:

| Route | Permission | Audit |
|-------|------------|-------|
| `GET /api/v0/extensions` | `extension:read` | no |
| `GET /api/v0/extensions/:id` | `extension:read` | no |
| `POST /api/v0/extensions/register` | `extension:register` | yes when allowed |
| `POST /api/v0/extensions/:id/enable` | `extension:enable` | yes when allowed |
| `POST /api/v0/extensions/:id/disable` | `extension:disable` | yes when allowed |

M-Extension verifies external JWT bearer auth at its own boundary and calls M-Policy for authorization. Core is not a facade for these routes.

---

## 11. CLI Commands

M-CLI adds:

```text
meristem extension list
meristem extension show <id>
meristem extension register <manifest-file>
meristem extension enable <id>
meristem extension disable <id>
```

The CLI uses the unified external service URL resolver and adds:

```text
target: m-extension
env: MERISTEM_EXTENSION_URL
default: http://localhost:3106
```

The CLI must not expose:

```text
extension run
extension invoke
extension webhook create
extension secret bind
extension approval approve
extension marketplace install
```

---

## 12. Events

Phase 15 publishes only control-plane lifecycle events:

```text
extension.definition.registered.v0
extension.definition.rejected.v0
extension.instance.enabled.v0
extension.instance.disabled.v0
extension.instance.enable_failed.v0
extension.instance.disable_failed.v0
```

Publisher: `M-Extension`.

Subscribers: `M-Log`, `M-UI BFF`.

Delivery: at-least-once.

Payloads must include:

```text
extensionId
manifestVersion
kind
actor
decisionId
scopeType
scopeId
reason?
correlationId?
```

Phase 15 must not publish:

```text
extension.execution.started.v0
extension.webhook.received.v0
extension.wasm.loaded.v0
extension.callback.sent.v0
```

---

## 13. Logs

Timeline:

- successful definition registration.
- successful instance enable.
- successful instance disable.

Full Log:

- manifest validation failures.
- M-Policy denials.
- unknown permission rejections.
- high / critical risk rejections.
- enable / disable failures.

Audit Log:

- allowed registration before persistence.
- allowed enable before state transition.
- allowed disable before state transition.
- rejected high / critical risk manifest when actor and resource are known.
- denied write operation when policy decision is available.

Secrets, raw webhook tokens, executable command bodies, and binary payloads must never be logged.

---

## 14. Failure And Degraded Behavior

M-Extension fails closed when:

- PostgreSQL is unavailable for writes.
- M-Policy is unavailable for write authorization.
- M-Log Audit write fails for write operations requiring Audit.
- manifest validation fails.
- requested permissions are unknown.
- risk class is high or critical.

Read behavior may degrade only when clearly labeled and only for non-authoritative display summaries. Authoritative read routes must return unavailable rather than returning stale cache as fact.

---

## 15. Required Scripts

Phase 15 implementation must run or justify:

```text
bun run typecheck
bun run nodejs-ban
bun run test:contracts
bun run test:cli
bun run test:failure-modes
```

If Phase 15 introduces a service package, also run its targeted test command and the relevant integration test command once the service is wired.

---

## 16. Completion Criteria

Phase 15 is complete when:

- `docs/services/m-extension.md` is implemented as the service boundary.
- `MExtensionManifestV01` is versioned and covered by contract tests.
- low and medium risk manifests can be registered.
- unknown permissions reject registration.
- high and critical risk manifests reject registration.
- extension definitions and system-scoped instances are persisted in M-Extension-owned authoritative tables.
- `enable` and `disable` work only for `system/default` instances.
- all write operations call M-Policy.
- policy denial fails closed.
- required Timeline, Full, and Audit facts are written.
- extension lifecycle events are published and listed in the event catalog.
- REST routes and CLI commands match the documented contracts.
- Core does not own extension registry state.
- no Wasm, webhook, HTTP callback, script, or cloud-function execution runtime is introduced.

---

## 17. Verification Checklist

Implementation verification must include:

```text
manifest schema decode / encode test
manifest version compatibility test
unknown permission rejection test
high / critical risk rejection test
register M-Policy allow test
register M-Policy deny test
enable M-Policy allow test
enable M-Policy deny test
disable M-Policy allow test
disable M-Policy deny test
Audit written for register / enable / disable test
Full Log written for validation failure test
event subject contract test
CLI list / show / register / enable / disable smoke test
Core does not expose or persist extension authoritative state test
nodejs-ban passes
```

---

## 18. Deferred Work

Deferred Phase 15 follow-up items are recorded in `docs/roadmap/DEFERRED-WORK.md`:

- real Wasm runtime.
- webhook ingress and execution.
- outbound HTTP callback execution.
- cloud-function runtime.
- extension secrets and runtime config binding.
- non-system extension scopes.
- extension approval origins.
- extension UI / BFF surfaces.
- dynamic extension permission registry.
- marketplace and package distribution.
