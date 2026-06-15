# M-Extension Service Definition

## 1. Identity

| Field | Value |
|-------|-------|
| name | `m-extension` |
| version | `0.1.0` |
| domain | `m-extension` |
| kind | `extension` |
| owner | M-Extension |

---

## 2. Responsibility

M-Extension owns the supplemental extension control plane. It exists to register and govern extensions that are not better expressed as first-class M-* services.

What M-Extension owns:

- extension definition registry.
- extension instance lifecycle.
- `M-Extension Manifest v0.1` validation.
- extension capability declarations.
- extension requested permission validation.
- extension enable / disable transitions.
- extension control-plane events.
- extension control-plane REST API.

What M-Extension must not own:

- Core service registry.
- M-Policy authorization decisions.
- M-Log storage.
- M-EventBus transport internals.
- M-UI or BFF display aggregation.
- secret storage or secret plaintext.
- Wasm runtime execution.
- webhook ingress execution.
- outbound HTTP callback execution.
- script or cloud-function runtime execution.

M-Extension is control-plane only. The manifest contract reserves future runtime fields, but accepted manifests reject those fields until runtime governance is implemented.

Deferred in the current baseline:

- Wasm runtime execution.
- Webhook ingress execution.
- Outbound HTTP callback execution.
- Script or cloud-function runtime execution.
- Non-`system/default` scopes (node, network, service, tenant, user).
- Dynamic permission registration or marketplace-style installation.
- M-UI / BFF surface for extension management.

---

## 3. Contracts

| Contract | Path / Subject | Version | Notes |
|----------|----------------|---------|-------|
| REST | `/api/v0/extensions` | v0 | External control-plane routes owned by M-Extension |
| Manifest | `MExtensionManifestV01` | `m-extension-manifest@0.1.0` | Governance declaration only |
| Events | `extension.definition.*.v0`, `extension.instance.*.v0` | v0 | Lifecycle events only |
| CLI | `meristem extension *` | v0 | Uses `MERISTEM_EXTENSION_URL` |

M-Extension does not expose execution, invoke, run, webhook, or callback contracts.

---

## 4. Permissions

| Permission | Required For | Risk |
|------------|--------------|------|
| `extension:read` | list and show extensions | low |
| `extension:register` | register a manifest | medium |
| `extension:enable` | enable a system-scoped instance | medium |
| `extension:disable` | disable a system-scoped instance | low |

Rules:

- extensions cannot create new permissions.
- manifest `requestedPermissions` must reference known Meristem permissions.
- unknown permissions are rejected.
- high or critical risk manifests are rejected.

---

## 5. Dependencies

| Dependency | Type | Failure Behavior |
|------------|------|------------------|
| PostgreSQL | datastore | authoritative reads / writes fail when unavailable |
| M-Policy | service | write operations fail closed when unavailable |
| M-Log | service | writes requiring Audit fail closed if Audit cannot be written |
| M-EventBus | service | lifecycle event publication failure writes Full Log and returns degraded failure for mutating operations |
| Core identity / JWT baseline | service contract | external requests fail with `401` / `403` when actor cannot be verified or authorized |

M-Extension must not read private tables from M-Policy, M-Log, Core, M-Net, or M-Task.

---

## 6. Configuration

| Key | Type | Required | Hot Reload | Notes |
|-----|------|----------|------------|-------|
| `MERISTEM_EXTENSION_HOST` | string | no | no | default `127.0.0.1` |
| `MERISTEM_EXTENSION_PORT` | number | no | no | default `3106` |
| `MERISTEM_EXTENSION_URL` | string | no | n/a | CLI external target override |
| `MERISTEM_INTERNAL_TOKEN` | string | yes | no | internal service authentication |
| `MERISTEM_JWT_SECRET` | string | yes | no | local MVP bearer token validation |

Runtime execution configuration is out of scope.

---

## 7. Health

| Check | Meaning | Failure Behavior |
|-------|---------|------------------|
| liveness | process is running | restart or report unavailable |
| readiness | PostgreSQL, M-Policy, M-Log, and M-EventBus dependencies are usable | write routes fail closed; read routes return unavailable if authoritative state cannot be read |

Readiness must not report ready when M-Policy or M-Log are unavailable for write operations that require authorization and Audit.

---

## 8. Lifecycle

| Capability | Supported | Notes |
|------------|-----------|-------|
| reloadable | no | M-Extension does not require runtime reload behavior |
| rollbackable | limited | extension instance disable is the rollback path for enabled control-plane state |
| degradable | limited | read-only degraded display may exist later; mutating operations fail closed |

M-Extension runtime failures must not affect Core startup beyond normal service readiness reporting.

---

## 9. Logs

| Log | When Written | Required Fields |
|-----|--------------|-----------------|
| Timeline | successful register / enable / disable | extensionId, actor, action, scope, correlationId |
| Full | validation failures, policy denial, lifecycle failure, event publication failure | extensionId when known, actor, errorCode, reason, correlationId |
| Audit | allowed register / enable / disable before persistence or transition; denied high-risk write when actor and resource are known | extensionId, actor, action, policyDecisionId, riskClass, scope, correlationId |

Secrets, raw webhook tokens, executable command bodies, binary payloads, and future runtime artifacts must never be logged.

---

## 10. Policy Requirements

- `register`, `enable`, and `disable` must call M-Policy before mutation.
- M-Policy denial must fail closed.
- M-Policy unavailability must fail closed.
- allowed write operations requiring Audit must write Audit before the authoritative state transition.
- M-Extension does not create approval records for extension operations.
- high and critical risk manifests are rejected as unsupported, not suspended for approval.

---

## 11. State Ownership

M-Extension owns these authoritative PostgreSQL tables:

```text
extension_definitions
extension_instances
extension_transitions
```

M-Extension supports only:

```text
scopeType = "system"
scopeId = "default"
```

Node, network, service, tenant, and user scopes are deferred.

---

## 12. Done Criteria

- Service definition is versioned.
- Manifest, REST, CLI, event, and state contracts are declared.
- M-Policy requirements are explicit and fail closed.
- Timeline, Full, and Audit behavior is declared.
- No execution runtime is introduced.
- Contract tests cover manifest validation and event subjects.
- Failure-mode tests cover policy denial, unknown permission rejection, high-risk rejection, and Audit failure.
