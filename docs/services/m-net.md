# M-Net Service Definition

## 1. Identity

| Field | Value |
|-------|-------|
| name | `m-net` |
| version | `0.1.0` |
| domain | `m-net` |
| kind | `internal` |
| owner | Meristem networking maintainers |

---

## 2. Responsibility

M-Net owns node interconnection control-plane behavior, join/session orchestration, logical network membership, Regional Network Profile lifecycle, and operator-initiated node administrative state control.

What this service owns:

- logical `network` resource creation and listing
- logical node-to-network membership
- Leaf / Stem membership rules
- public TLS + WebSocket join ingress on `8443`
- runtime token issuance during `join.accepted` and session resume handling
- node-agent heartbeat, log forward, and task result frame handling
- node reachability and runtime status updates
- offline transition on heartbeat timeout or session loss
- operator-initiated node administrative state changes: disable, isolate, and recover
- network-map exclusion: disabled and isolated nodes must not appear in rendered network maps
- heartbeat / offline scanner guard: heartbeat restorations and timeout-driven offline transitions must not override operator-set `disabled` or `isolated` state
- Regional Network Profile control-plane state and transitions
- global profile defaults for newly created networks
- batched fleet-wide profile migration with per-network progress tracking
- resumable rollback: resume from last successful network or roll back all applied profiles
- immediate profile disable with M-Policy allow + Audit (no approval gate by default)
- security-admin break-glass disable when M-Policy is unavailable

What this service must not own:

- Core-owned authorization decisions
- M-Task-owned canonical task lifecycle state
- public NATS semantics for the agent boundary
- packet forwarding, DERP protocol implementation, TCP/UDP relay execution, WireGuard protocol implementation, or NetBird Management (Dashboard, ACL/policy, auth/SSO, audit/logging, account model). (M-Net orchestrates data-plane metadata: network maps, ACL renders, relay assignment, key metadata, tunnel addresses).
- NetBird Signal / Relay / STUN service lifecycle or configuration (these are infrastructure dependencies managed by NixOS/systemd; Meristem deploys them as unmodified upstream binaries per ADR-N04 licence boundary).

Current networking behavior scope:

- `m-net-cn@0.1.x` remains control-plane-only.
- `m-net-cn@0.2.0` carries the incremental data-plane track using node-agent managed WireGuard + wstunnel sidecars (ADR-N03 legacy path; superseded by ADR-N04 for v0.2 NetBird direction).
- `m-net@0.3.0` and `m-net-cn@0.3.0` carry NetBird data-plane semantics per ADR-N04; production readiness remains evidence-bound per scenario.
- v0.2 is NetBird-only at runtime; no wstunnel mixed/fallback mode.
- NetBird Management (Dashboard, ACL/policy, auth/SSO, audit/logging, account model) excluded per ADR-N04 guardrail.
- NetBird Signal, Relay, and STUN are infrastructure dependencies only, managed by NixOS/systemd.
- NetBird client sidecar viability remains unproven pending `bun run mnet:v02:sidecar-proof` (ADR-N04 §3).
- active reachability probing beyond control-plane heartbeat
- path selection
- regional profile data-plane rollout

### 2.1 Node Administrative State Control

M-Net owns the node administrative lifecycle: **disable**, **isolate**, **recover**, and the bounded **switch-role** slice. These are M-Policy guarded, Audit Log protected, operator-visible control actions that override runtime-derived status or change the authoritative stem/leaf role through the approved Core facade.

**Node disable**:
- Admin/security-admin action, requires `node:disable` permission, writes Audit Log before state change.
- Disabled nodes are excluded from rendered network maps and must not appear in join/network-member listings visible to non-admin actors.
- Disabled state outranks runtime status: a disabled node must not transition to `healthy` or `degraded` through heartbeat restoration.
- Disabled nodes retain their database records, membership bindings, and key material; the action suspends control-plane participation, it does not unregister or revoke the node.

**Node isolate**:
- Admin/security-admin action, requires `node:isolate` permission, writes Audit Log before state change.
- Isolated nodes are excluded from rendered network maps and peer-to-peer ACL rules (same map exclusion as disable).
- Isolate is stronger than disable: the node's WireGuard peer entries are stripped from rendered network maps and its public key is temporarily disallowed from re-registration while isolated.
- Isolate does not revoke the node's join ticket or credentials; those persist through the isolated window.

**Node recover**:
- Admin/security-admin action, requires `node:recover` permission, writes Audit Log before state change.
- Transitions a disabled or isolated node into `recovering`, an intermediate administrative state used by the current control loop.
- While `recovering`, the node remains visible for operator follow-up and excluded from peer paths until M-Net receives a valid heartbeat.
- The next valid node-agent heartbeat closes `recovering` to the reported runtime state (`healthy` or `degraded`) and writes recovery-completion Timeline/Audit evidence; this does not imply relay failover, key rotation, or physical host fencing.

**Node switch-role**:
- Operator action, requires `node:switch-role` permission, writes Audit Log before the authoritative role change.
- Allowed transitions are bounded to `stem <-> leaf` for an existing node already registered in Core/M-Net.
- The role switch updates `nodes.kind` and rewrites joined `network_memberships.membership_mode` rows through the existing node-control/materialization seams.
- Demoting the last stem member in a joined network fails closed with a conflict instead of silently reintroducing a leaf-only topology.
- Disabled, isolated, recovering, and revoked nodes stay excluded from peer paths and rendered maps through the existing exclusion seam; role switching does not reintroduce them.

**Heartbeat and offline guard**:
- Heartbeat-driven status transitions (joining → healthy, healthy → degraded → offline, recovering → healthy/degraded) must not alter an operator-set `disabled` or `isolated` state.
- Offline timeout scanners must skip nodes whose administrative state is `disabled`, `isolated`, or `recovering`, preventing false `offline` transitions that would later conflict with a recover action.
- When a disabled/isolated node sends a heartbeat, M-Net records the heartbeat fact in Full Log but does not promote the node out of its administrative state.

**Network-map exclusion**:
- Disabled, isolated, and recovering nodes are excluded from the member list in rendered network maps.
- ACL rules referencing a disabled, isolated, or recovering node are omitted from the rendered ACL set.
- Relay assignments that only serve disabled/isolated/recovering nodes are pruned before map publication.

**Recovery semantics**:
- Recover is the sole implemented control action from `disabled` or `isolated` into `recovering`.
- The verified slice covers the public Core facade, policy/audit/log chain, immediate `recovering` transition, heartbeat-driven closure to `healthy`/`degraded`, and recovery-completion Timeline/Audit evidence.
- Map reinclusion follows the existing member-list filter on the next map materialization after the node leaves `recovering`; this document does not claim autonomous relay failover or physical network repair.

Public exposure rules:

- target shape is one public node-join ingress only on `8443`
- internal health, readiness, and `/internal/v0/*` APIs stay loopback-only on `127.0.0.1:3104`
- raw NATS ports stay private; the agent boundary is no longer expressed as NATS semantics
- exposing `3000 + 4223` for cross-machine validation remains a development-only exception

---

## 3. Contracts

| Contract | Path / Subject | Version | Notes |
|----------|----------------|---------|-------|
| Eden | `@meristem/contracts/mnet` | `0.1.0` | Core uses loopback HTTP + Eden for control-plane calls |
| REST | `/api/v0/networks*`, `/api/v0/network-profiles*`, `GET /join/v0/health`, `GET /join/v0/session` | `v0` | external profile API is owned by M-Net |
| Events | `mnet.*`, `node.*`, `network-profile.*` subjects listed in `docs/events/EVENT-CATALOG.md` | `v0` | event naming stays catalog-driven |

Current runtime boundary:

- Core → M-Net create/list/join/member uses loopback HTTP + Eden + internal token.
- M-Task → M-Net agent dispatch and best-effort cancellation use declared delivery operations; M-Task owns task lifecycle state.
- public join ingress exposes only `GET /join/v0/health` and `GET /join/v0/session` with WebSocket upgrade.
- client → server frames: `join.redeem`, `session.resume`, `heartbeat`, `log.forward`, `task.result`.
- server → client frames: `join.accepted`, `session.resumed`, `task.execute`, `error`.
- `join.accepted` is the only frame that returns the runtime token.
- `join.accepted` and `session.resumed` return the active `sessionId`.
- `heartbeat`, `log.forward`, and `task.result` must echo the current `sessionId`; stale session IDs are rejected with `session.superseded`.
- only one active session may exist per node; a successful resume supersedes the previous live connection immediately.
- Core operator/API token rotation (`POST /api/v0/nodes/:id/credentials`) revokes the prior active runtime token before returning a replacement token.
- Core operator/API token revoke (`POST /api/v0/nodes/:id/credentials/revoke`) revokes the active runtime token without returning a replacement token.
- runtime token validation accepts only the current `active` credential hash in PostgreSQL; rotated or revoked tokens fail closed for later runtime authentication and `session.resume`.
- this slice does not claim automatic node-agent token refresh; operators must restart or reconfigure the node-agent after issuing a replacement token.

---

## 4. Permissions

| Permission | Required For | Risk |
|------------|--------------|------|
| `network:create` | create logical networks | high |
| `network:join` | add a node to a logical network | high |
| `network-profile:read` | list or show profile definitions and state | medium |
| `network-profile:apply` | enable a profile on a network | high |
| `network-profile:disable` | disable a profile on a network | medium |
| `node:switch-role` | switch an existing node between stem and leaf while preserving the one-stem minimum | medium |
| `node:disable` | place a node into administrative disabled state | high |
| `node:isolate` | place a node into administrative isolated state | high |
| `node:recover` | transition a disabled or isolated node back to runtime-derived status | high |

---

## 5. Dependencies

| Dependency | Type | Failure Behavior |
|------------|------|------------------|
| Core | service | external orchestration requests fail closed |
| M-Task | service | task delivery orchestration degrades; task lifecycle ownership remains external |
| M-Policy | service | protected profile and membership operations fail closed |
| M-Log | service | required Timeline / Audit writes block high-risk operations |
| PostgreSQL | datastore | authoritative network and profile state writes fail closed |

---

## 6. Configuration

| Key | Type | Required | Hot Reload | Notes |
|-----|------|----------|------------|-------|
| `MERISTEM_MNET_BIND` | string | yes | no | loopback control-plane bind |
| `MERISTEM_MNET_PUBLIC_JOIN_BIND` | string | yes | no | public join ingress bind on `8443` |
| `MERISTEM_MNET_HEARTBEAT_TIMEOUT_MS` | number | yes | yes | heartbeat timeout for offline transition |
| `MERISTEM_MNET_PUBLIC_DERP_FALLBACK` | boolean | no | yes | fallback remains configurable and disableable |

---

## 7. Health

| Check | Meaning | Failure Behavior |
|-------|---------|------------------|
| liveness | process and session loop are alive | restart M-Net |
| readiness | control-plane APIs, session admission, and authoritative storage are ready | remove M-Net from the serving pool |

---

## 8. Lifecycle

| Capability | Supported | Notes |
|------------|-----------|-------|
| reloadable | limited | bounded configuration reload only |
| rollbackable | limited | profile-enable recovery uses suspended operations and explicit disable paths |
| degradable | yes | agent runtime can fall back to control-plane heartbeat only |

---

## 9. Logs

| Log | When Written | Required Fields |
|-----|--------------|-----------------|
| Timeline | network create/join, profile transitions, route apply summaries, relay assignment/path changes, tunnel lifecycle summaries, node disable/isolate/recover actions | `summary`, `subject`, `correlationId`, `networkId`, `nodeId?` |
| Full | join/session runtime errors, session supersede, route apply diagnostics, relay fallback/path degradation, tunnel lifecycle failures, node-agent `log.forward` lifecycle facts, profile apply failures, node-control operation diagnostics (heartbeat suppressed, map exclusion applied, state guard rejection) | `source`, `level`, `message`, `traceId`, `correlationId` |
| Audit | high-risk network/profile actions, operator-triggered route-affecting control actions, key lifecycle mutations, node disable/isolate/recover actions | `actor`, `action`, `resource`, `decision`, `correlationId` |

### 9.1 M-Net Data-Plane Observability Boundary

- Route apply observability proves control-plane intent and agent acknowledgement only. Timeline / Full Log / evidence surfaces may carry `networkId`, `nodeId`, `profileVersion`, `mapVersion`, rendered route counts, selected `pathType`, tunnel address references, and typed fail-closed reasons. Host-local netfilter rules, raw route-table dumps, packet captures, and sidecar command lines stay outside M-Net payloads.
- Relay assignment and path-change facts on event surfaces must stay within the active `mnet.relay.assigned.v0` and `mnet.path.changed.v0` contracts. Full Log / evidence summaries may add typed fallback state or reasons when needed, but must not contain runtime tokens, ACME account keys, sidecar credentials, or host-local file paths.
- Tunnel lifecycle event facts must stay within the active `mnet.dataplane.tunnel.changed.v0` contract. Full Log / evidence summaries may add check timestamps or node-agent forwarded lifecycle summaries, but must not claim packet forwarding health beyond the reported sidecar / handshake state.
- Key lifecycle facts may expose public-key fingerprints, rotation reason, actor, audit linkage, and correlation IDs only. Event payloads must be backed by active schemas before publication. Plaintext WireGuard private keys, pre-shared secrets, or replacement credential material are forbidden in Timeline, Full, Audit, event, UI, and evidence payloads.
- Node-agent `log.forward` lifecycle facts may carry sidecar restart/teardown summaries plus `sessionId` correlation in Full Log surfaces, but the runtime token itself remains confined to `join.accepted` and must never be replayed into M-Net observability surfaces.
- Redaction applies uniformly to Timeline, Full, Audit, event, UI, and test-evidence payloads. Safe payloads use metadata, fingerprints, typed reasons, and `secretRef` references only.

---

## 10. Policy Requirements

- node disable, isolate, and recover are high-risk operations that require M-Policy authorization and Audit Log writes before state change.
- node disable and isolate must fail closed when M-Policy is unavailable or Audit cannot be written.
- node recover must fail closed when M-Policy is unavailable or Audit cannot be written.
- a disabled or isolated node must not be recoverable through any path other than an explicit `node:recover` action; runtime transitions (heartbeat, offline timeout, profile change) must not implicitly recover administrative state.
- profile enable must use bounded M-Policy approval and resume through M-Net.
- profile disable is an immediate risk-reduction path with M-Policy allow + Audit; no approval gate by default.
- security-admin break-glass disable is allowed when M-Policy is unavailable; break-glass writes Audit before state change.
- disable is allowed from `failed` state as a recovery path.
- M-Net must not own authorization policy logic locally.
- event, Audit, Timeline, and Full Log behavior must stay aligned with `docs/events/EVENT-CATALOG.md`, `docs/services/m-log.md`, and `docs/security/SECURITY-MODEL.md`.

---

## 11. Regional Profile Runtime Notes

Default network design:

- Packet path is owned by node-agent + NetBird client sidecar + NetBird Signal + NetBird Relay/STUN (v0.2 direction, ADR-N04).
- Legacy wstunnel path (`m-net-cn@0.2.0`, ADR-N03) retained for migration window only; not the v0.2 target.
- NetBird Management excluded (Dashboard, ACL/policy, auth/SSO, audit/logging, account model).
- The first supported topology is 1 control-plane+relay host + 2 Leaf hosts.
- Default overlay CIDR is `100.96.0.0/12`.
- Single active data-plane network per node for `m-net-cn@0.2.0`.
- Signed network-map TTL fail-closed: node-agent tears down tunnels after `MERISTEM_MNET_NETWORK_MAP_STALE_TTL_MS` (default 15m) without a fresh signed map.
- No DNS, TURN, multi-region relay pool, or mobile roaming in the first production slice.
- No Kubernetes/service mesh requirement.

Regional Network Profile ownership:

- profile definition registration (`m-net-default@0.1.0`, `m-net-cn@0.1.x`, `m-net-cn@0.2.0`)
- per-network applied profile state, transitions, and suspended enable operations
- external network-profile REST API and OpenAPI
- profile lifecycle events published through M-EventBus

M-Net CN is the first Regional Network Profile. `m-net-cn@0.1.x` control-plane lifecycle is implemented. `m-net-cn@0.2.0` introduces the WireGuard+wstunnel data-plane orchestration track (ADR-N03 legacy path). `m-net@0.3.0` and `m-net-cn@0.3.0` carry the NetBird data-plane track per ADR-N04. Each production claim must be backed by current acceptance evidence.

Data-plane orchestration adapter:

- `m-net-cn@0.1.x` profiles use a noop adapter (`services/m-net/src/data-plane/noop-adapter.ts`) since they are `controlPlaneOnly: true`.
- `m-net-cn@0.2.0` profiles use the WireGuard+wstunnel data-plane adapter (ADR-N03 legacy path; superseded by ADR-N04 for v0.2 NetBird direction).
- `m-net@0.3.0` and `m-net-cn@0.3.0` profiles use the NetBird data-plane adapter boundary in `services/m-net/src/netbird-adapter.ts`. The viability gate is `bun run mnet:v02:sidecar-proof`; it may succeed only after sidecar start, config acquisition, peer/session establishment, and clean stop all complete. If the client path requires excluded NetBird Management behavior, the command exits nonzero with `unsupported_management_dependency` and the ADR-N04 fallback decision: Meristem-owned WireGuard rendering plus NetBird Signal/Relay/STUN infrastructure.

Profile definition `m-net-cn@0.1.x`:

- region: `cn`
- `controlPlaneOnly: true`; no real endpoints, secrets, relay assignments, routes, or probes
- enabling is per network, not global
- enabling requires approval-flow integration and M-Net resume
- disabling is immediate with M-Policy allow + Audit
- disable is allowed from `failed` state as a recovery path

Placeholder-only rules:

- Asian Stem Nodes may act as DERP servers.
- Mainland nodes without public network access may use TCP interconnect.
- Asian Stem Nodes may connect to the Core Node over TCP.

---

## 12. Done Criteria

- operators can create logical networks through Core and CLI.
- operators can join healthy nodes to networks.
- Leaf joins remain restricted and require a Stem member.
- logical network create/join writes Audit and Timeline entries.
- operators can disable, isolate, and recover nodes through M-Net, with each action writing Audit and Timeline entries before state change.
- disabled and isolated nodes are excluded from rendered network maps and ACL rules.
- heartbeat and offline scanners do not override administrative `disabled` or `isolated` states.
- M-Net owns profile definitions, per-network profile state, transitions, and suspended profile-enable operations.
- `m-net-cn@0.1.x` stays control-plane-only and contains no real endpoint, secret, route, or probe data.
- M-Net exposes the external profile REST API and OpenAPI.
- M-CLI supports profile list / show / enable / disable through the service URL resolver.
- M-Net CN enable requires bounded M-Policy approval and resumes through M-Net.
- M-Net CN disable executes immediately with M-Policy allow + Audit (no approval gate by default).
- security-admin break-glass disable writes Audit before state change when M-Policy is unavailable.
- global profile defaults apply to newly created networks.
- batched fleet-wide profile migration supports per-network progress tracking.
- resumable rollback supports resume from last successful network or roll back all applied profiles.
- agent join/session events and runtime state changes match `docs/events/EVENT-CATALOG.md`.
- contract, failure-mode, integration, CLI, and e2e gates pass or document infrastructure skip conditions.
