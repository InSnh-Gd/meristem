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

What this service must not own:

- Core-owned authorization decisions
- M-Task-owned canonical task lifecycle state
- public NATS semantics for the agent boundary
- real DERP / UDP / TCP data-plane rollout in the current baseline

Current deferred networking behavior:

- DERP / UDP / TCP transport implementation
- Headscale control plane integration
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
- profile disable is an immediate risk-reduction path with M-Policy allow + Audit.
- M-Net must not own authorization policy logic locally.
- event, Audit, Timeline, and Full Log behavior must stay aligned with `docs/events/EVENT-CATALOG.md`, `docs/services/m-log.md`, and `docs/security/SECURITY-MODEL.md`.

---

## 11. Regional Profile Runtime Notes

Default network design:

- Core runs Headscale DERP Server.
- UDP is preferred by default.
- Tailscale public DERP can be used as a fallback.
- public DERP fallback must remain configurable and disableable.

Regional Network Profile ownership:

- profile definition registration (`m-net-default@0.1.0`, `m-net-cn@0.1.0`)
- per-network applied profile state, transitions, and suspended enable operations
- external network-profile REST API and OpenAPI
- profile lifecycle events published through M-EventBus

M-Net CN is the first Regional Network Profile. Its control-plane lifecycle is implemented; data-plane behavior remains deferred.

Profile definition `m-net-cn@0.1.0`:

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
- `m-net-cn@0.1.0` stays control-plane-only and contains no real endpoint, secret, route, or probe data.
- M-Net exposes the external profile REST API and OpenAPI.
- M-CLI supports profile list / show / enable / disable through the service URL resolver.
- M-Net CN enable requires bounded M-Policy approval and resumes through M-Net.
- M-Net CN disable executes immediately with M-Policy allow + Audit.
- agent join/session events and runtime state changes match `docs/events/EVENT-CATALOG.md`.
- contract, failure-mode, integration, CLI, and e2e gates pass or document infrastructure skip conditions.
