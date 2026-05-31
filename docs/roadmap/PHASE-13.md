# Phase 13 - M-Net CN Regional Profile Control Plane

> **Status: Complete** — ADR-024 accepted. M-Net owns profile definitions, per-network state, transitions, and suspended operations. External REST API, CLI, events, Audit, and Timeline behavior match this spec.

> Goal: implement M-Net CN as the first auditable Regional Network Profile control plane without implementing real DERP, TCP, UDP, Headscale, or path-selection data-plane behavior.

---

## 1. Scope

Phase 13 implements the M-Net CN profile lifecycle as a control-plane feature:

```text
define regional profile contract
-> register m-net-cn@0.1.0 as an available profile
-> enable profile per network through M-Net-owned external REST
-> require Phase 12 approval for enable
-> resume approved enable in M-Net
-> disable profile immediately with M-Policy allow + Audit
-> write events, Timeline, Full, and Audit facts
```

Phase 13 does not implement real network transport changes. Enabling `m-net-cn@0.1.0` changes the authoritative control-plane profile state and records the intended regional strategy; it does not start DERP relays, TCP tunnels, UDP path switching, Headscale control, or active probing.

---

## 2. Accepted Decisions

- Phase 13 implements M-Net CN control plane and audit lifecycle only.
- M-Net owns Regional Profile definitions, per-network applied state, and profile transitions.
- The generic Config Lifecycle is not implemented in Phase 13, but profile terminology must remain compatible with future validate / publish / apply / ack / rollback semantics.
- M-Net CN is enabled per network, not globally.
- `m-net-cn@0.1.0` contains strategy intent and `controlPlaneOnly` capability metadata; it contains no real endpoints, secrets, relay assignments, routes, or probes.
- M-Net directly owns the external network-profile REST API. Core does not facade these routes.
- M-CLI uses a unified external service URL resolver instead of one-off service URL handling.
- Enabling M-Net CN requires Phase 12 approval and M-Net resume.
- Disabling M-Net CN is an immediate risk-reduction path guarded by M-Policy allow + Audit Log, not an approval flow.
- M-Net owns `mnet_suspended_operations` for profile enable; M-Policy owns only approval records and quorum.
- ADR-024 is accepted only for control-plane Regional Profile lifecycle. Real data-plane behavior remains deferred.

---

## 3. Out Of Scope

Phase 13 excludes:

- real DERP relay.
- real TCP interconnect.
- real UDP path switching.
- Headscale control plane integration.
- active network probing beyond existing session heartbeat.
- latency measurement or automatic path optimization.
- endpoint URL management.
- TLS private material, STUN / TURN credentials, Headscale keys, regional IP ranges, route tables, or node-specific relay assignment.
- global profile enable / disable.
- generic config draft / validate / commit / hash / sign / publish / apply / ack subsystem.
- M-UI profile management screens.

---

## 4. Profile Contract

Initial profile definition:

```ts
type MNetRegionalProfile = {
  profileVersion: "m-net-cn@0.1.0";
  region: "cn";
  displayName: "M-Net CN";
  schemaVersion: "mnet-profile@0.1.0";
  status: "available";
  rules: {
    mainlandNodeWithoutPublicAccess: {
      interconnect: "tcp_required";
    };
    asianStemToCore: {
      interconnect: "tcp_required";
    };
    asianStemDerp: {
      allowed: true;
      mode: "placeholder";
    };
    publicDerpFallback: {
      configurable: true;
      defaultEnabled: false;
    };
  };
  capabilities: {
    realDerpRelay: false;
    realTcpInterconnect: false;
    realUdpPathSwitching: false;
    controlPlaneOnly: true;
  };
};
```

Required default profiles:

```text
m-net-default@0.1.0
m-net-cn@0.1.0
```

`m-net-cn@0.1.0` must be displayed and logged as a control-plane profile. The profile must not imply that runtime transport changed.

---

## 5. State Model

M-Net owns these PostgreSQL tables:

```text
mnet_profile_definitions
mnet_network_profile_states
mnet_profile_transitions
mnet_suspended_operations
```

Suggested fields:

```text
mnet_profile_definitions:
  id
  profile_version
  region
  schema_version
  definition
  status
  created_at
  updated_at

mnet_network_profile_states:
  network_id
  profile_version
  status
  enabled_by
  policy_decision_id
  correlation_id
  applied_at
  disabled_at
  last_error
  updated_at

mnet_profile_transitions:
  id
  network_id
  from_profile_version
  to_profile_version
  from_status
  to_status
  actor
  reason
  policy_decision_id
  correlation_id
  created_at

mnet_suspended_operations:
  id
  policy_decision_id
  action
  network_id
  from_profile_version
  to_profile_version
  requested_by
  reason
  correlation_id
  idempotency_key
  status
  expires_at
  created_at
  resumed_at
  terminal_reason
```

`networks.profile_version` remains the operator-visible current profile for a network. The M-Net profile state table records lifecycle metadata around that profile assignment.

---

## 6. State Machine

Network profile state:

```text
disabled
-> enabling
-> enabled
-> disabling
-> disabled

any transition failure -> failed
failed -> disabling -> disabled
failed -> enabling -> enabled
```

Profile enable:

```text
network profile is m-net-default@0.1.0
-> request m-net-cn@0.1.0
-> create M-Net suspended operation
-> create M-Policy approval
-> approval approved
-> M-Net resume checks current profile is unchanged
-> set networks.profile_version = m-net-cn@0.1.0
-> state enabled
```

Profile disable:

```text
network profile is m-net-cn@0.1.0
-> M-Policy allow
-> Audit before execution
-> set networks.profile_version = m-net-default@0.1.0
-> state disabled
```

Disable is allowed as a recovery path from `failed` state.

---

## 7. External REST API

M-Net owns the external REST routes:

```text
GET  /api/v0/network-profiles
GET  /api/v0/network-profiles/:profileVersion
POST /api/v0/networks/:id/profile
```

Set profile request:

```ts
type SetNetworkProfileRequest = {
  profileVersion: "m-net-default@0.1.0" | "m-net-cn@0.1.0";
  reason: string;
};
```

Permissions:

```text
network:profile-read
network:profile-enable
network:profile-disable
```

Suggested defaults:

```text
operator: network:profile-read
admin: network:profile-read, network:profile-enable, network:profile-disable
security-admin: network:profile-read, network:profile-enable, network:profile-disable
```

External route rules:

- M-Net verifies external JWT bearer auth at its own boundary.
- M-Net calls M-Policy for profile enable / disable authorization.
- M-Net calls M-Log for Timeline / Full / Audit facts.
- M-Net calls M-EventBus for profile lifecycle events.
- M-Net exposes OpenAPI for these external routes.
- Core may aggregate readiness but must not own or facade profile routes.

---

## 8. CLI And Service URL Resolution

Phase 13 adds network profile commands:

```text
meristem network profile list
meristem network profile show <profile-version>
meristem network profile enable --network <network-id> --profile m-net-cn@0.1.0 --reason <text>
meristem network profile disable --network <network-id> --reason <text>
```

Phase 13 should introduce a unified external service URL resolver used by M-CLI:

```ts
type ExternalServiceName = "core" | "m-task" | "m-policy" | "m-net";

type ExternalServiceUrls = {
  core: string;
  "m-task": string;
  "m-policy": string;
  "m-net": string;
};
```

Environment variables:

```text
MERISTEM_CORE_URL=http://localhost:3000
MERISTEM_TASK_URL=http://localhost:3105
MERISTEM_POLICY_URL=http://localhost:3101
MERISTEM_MNET_URL=http://localhost:3104
```

Command ownership:

```text
status/node/service/log/audit/projection -> core
task -> m-task
policy approvals -> m-policy
network profile -> m-net
```

---

## 9. Approval Integration

Enable flow:

```text
POST /api/v0/networks/:id/profile { profileVersion: "m-net-cn@0.1.0" }
-> M-Net validates network and profile
-> M-Net calls M-Policy
-> M-Policy returns require_manual_review
-> M-Net creates mnet_suspended_operations row
-> M-Policy creates approval record
-> M-Net returns pending approval with approvalId and operationId
```

Resume flow:

```text
security-admin approves in M-Policy
-> M-Net resume endpoint / worker checks approval and suspended operation
-> verifies network still exists
-> verifies current profile still equals from_profile_version
-> verifies idempotency key unused
-> applies profileVersion m-net-cn@0.1.0
-> writes Audit + Timeline
-> emits mnet.profile.enabled.v0
```

Disable flow:

```text
POST /api/v0/networks/:id/profile { profileVersion: "m-net-default@0.1.0" }
-> M-Net validates current profile is m-net-cn@0.1.0 or failed
-> M-Net calls M-Policy and requires allow
-> M-Net writes Audit before execution
-> M-Net applies default profile immediately
-> M-Net emits mnet.profile.disabled.v0
```

Disable must not be blocked by an approval flow because it is the risk-reduction and rollback path.

---

## 10. Events

Phase 13 adds M-Net profile lifecycle subjects:

```text
mnet.profile.enable.requested.v0
mnet.profile.enabled.v0
mnet.profile.disable.requested.v0
mnet.profile.disabled.v0
mnet.profile.apply_failed.v0
mnet.profile.enable.canceled.v0
```

Event payloads must include:

```text
networkId
fromProfileVersion
toProfileVersion
actor
policyDecisionId
approvalId?        # for approval-gated enable
operationId?       # for suspended operation
correlationId
reason
controlPlaneOnly
```

Events are not the source of truth. They are emitted after PostgreSQL state changes.

---

## 11. Log And Audit Rules

Audit required:

```text
mnet.profile.enable.request
mnet.profile.enable.resume.attempt
mnet.profile.enable.success
mnet.profile.enable.failure
mnet.profile.disable.request
mnet.profile.disable.success
mnet.profile.disable.failure
mnet.profile.enable.cancel
```

Timeline required:

```text
profile enable requested
profile enabled
profile disable requested
profile disabled
profile apply failed
profile enable canceled
```

Full Log required:

```text
profile validation failure
policy unavailable
audit unavailable
approval creation failure
resume stale state
idempotency conflict
event publish failure
```

Audit must distinguish approval authorization from profile application. An approved M-Policy approval does not imply M-Net successfully applied the profile.

---

## 12. Target Files

Expected implementation areas:

```text
services/m-net/
services/m-policy/
packages/contracts/
packages/db/
packages/policy/
apps/m-cli/
docs/adr/ADR-024-m-net-cn-profile.md
docs/services/m-net.md
docs/contracts/REST-API-MVP.md
docs/contracts/CLI-COMMANDS.md
docs/events/EVENT-CATALOG.md
docs/security/SECURITY-MODEL.md
docs/config/CONFIG-LIFECYCLE.md
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

- M-Net profile Effect Schema decode / encode.
- M-Net external REST route schemas and OpenAPI output.
- CLI network profile command contract.
- M-Net profile event subject and payload schemas.
- ADR-024 accepted control-plane scope is reflected in Phase 13 docs.

Policy tests:

- operator can read profiles but cannot enable / disable.
- admin or security-admin can request enable, but enable returns pending approval.
- enable requires manual review.
- disable requires M-Policy allow and Audit but not approval.
- disable in default state returns `409 profile.not_enabled`.

Failure-mode tests:

- Audit unavailable blocks disable and enable request.
- M-Policy unavailable fails closed.
- approval creation failure leaves network profile unchanged.
- resume stale current profile fails without applying CN.
- duplicate resume is rejected by idempotency.
- event publish failure writes Full Log and does not create false state.

Integration tests:

- list profile definitions.
- show `m-net-cn@0.1.0` with `controlPlaneOnly: true`.
- request enable on one network creates suspended operation and approval.
- approved enable resumes and updates only that network to `m-net-cn@0.1.0`.
- another network remains `m-net-default@0.1.0`.
- disable rolls the network back to default.
- failed enable can be disabled as recovery.

CLI tests:

- `meristem network profile list`.
- `meristem network profile show m-net-cn@0.1.0`.
- `meristem network profile enable --network <id> --profile m-net-cn@0.1.0 --reason <text>`.
- `meristem network profile disable --network <id> --reason <text>`.
- service URL resolver routes network profile commands to M-Net.

E2E smoke:

```text
Start PostgreSQL, NATS, Core, M-Policy, M-Log, M-EventBus, M-Net, M-Task.
Create two logical networks.
Request M-Net CN enable for network A.
Approve as security-admin through Phase 12 approval flow.
Resume/apply profile in M-Net.
Verify network A profileVersion is m-net-cn@0.1.0.
Verify network B remains m-net-default@0.1.0.
Disable M-Net CN on network A.
Verify Audit, Timeline, events, and profile state agree.
```

---

## 14. Completion Criteria

Phase 13 is complete when:

- ADR-024 is accepted for control-plane Regional Profile lifecycle and explicitly defers data-plane behavior.
- M-Net owns profile definitions, per-network profile state, transitions, and suspended profile-enable operations.
- `m-net-cn@0.1.0` is defined as control-plane-only and contains no real endpoint, secret, route, or probe data.
- M-Net exposes the external profile REST API and OpenAPI.
- M-CLI supports network profile list / show / enable / disable through the service URL resolver.
- M-Net CN enable requires Phase 12 approval and resumes through M-Net.
- M-Net CN disable executes immediately with M-Policy allow + Audit.
- Profile enable is per network, not global.
- Events, Audit, Timeline, and Full Log behavior match this document.
- Contract, failure-mode, integration, CLI, and e2e gates pass or document infrastructure skip conditions.

