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

M-Net owns node interconnection control-plane behavior, join/session orchestration, logical network membership, and Regional Network Profile lifecycle.

What this service owns:

- logical `network` resource creation and listing
- logical node-to-network membership
- Leaf / Stem membership rules
- public TLS + WebSocket join ingress on `8443`
- runtime token issuance during `join.accepted` and session resume handling
- node-agent heartbeat, log forward, and task result frame handling
- node reachability and runtime status updates
- offline transition on heartbeat timeout or session loss
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
- packet forwarding, DERP protocol implementation, TCP/UDP relay execution, or WireGuard protocol implementation. (M-Net orchestrates data-plane metadata: network maps, ACL renders, relay assignment, key metadata, tunnel addresses).

Current networking behavior scope:

- `m-net-cn@0.1.x` remains control-plane-only.
- `m-net-cn@0.2.0` carries production data-plane capabilities using node-agent managed WireGuard + wstunnel sidecars (superseding previous deferrals via ADR-N03).
- active reachability probing beyond control-plane heartbeat
- path selection
- regional profile data-plane rollout

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

---

## 4. Permissions

| Permission | Required For | Risk |
|------------|--------------|------|
| `network:create` | create logical networks | high |
| `network:join` | add a node to a logical network | high |
| `network-profile:read` | list or show profile definitions and state | medium |
| `network-profile:apply` | enable a profile on a network | high |
| `network-profile:disable` | disable a profile on a network | medium |

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
| Timeline | network create/join, profile transitions, reachability changes | `summary`, `subject`, `correlationId` |
| Full | join/session runtime errors, session supersede, profile apply failures | `source`, `level`, `message`, `traceId` |
| Audit | high-risk network/profile actions | `actor`, `action`, `resource`, `decision` |

---

## 10. Policy Requirements

- profile enable must use bounded M-Policy approval and resume through M-Net.
- profile disable is an immediate risk-reduction path with M-Policy allow + Audit; no approval gate by default.
- security-admin break-glass disable is allowed when M-Policy is unavailable; break-glass writes Audit before state change.
- disable is allowed from `failed` state as a recovery path.
- M-Net must not own authorization policy logic locally.
- event, Audit, Timeline, and Full Log behavior must stay aligned with `docs/events/EVENT-CATALOG.md`, `docs/services/m-log.md`, and `docs/security/SECURITY-MODEL.md`.

---

## 11. Regional Profile Runtime Notes

Default network design:

- Packet path is owned by node-agent + WireGuard + pinned external wstunnel relay sidecars over WSS/443 with ACME TLS.
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

M-Net CN is the first Regional Network Profile. `m-net-cn@0.1.x` control-plane lifecycle is implemented. `m-net-cn@0.2.0` introduces production data-plane orchestration (ADR-N03).

Data-plane orchestration adapter:

- `m-net-cn@0.1.x` profiles use a noop adapter (`services/m-net/src/data-plane/noop-adapter.ts`) since they are `controlPlaneOnly: true`.
- `m-net-cn@0.2.0` profiles use the production WireGuard+wstunnel data-plane adapter to orchestrate sidecars.

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
