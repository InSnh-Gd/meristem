# M-Net Service Definition

## 1. Identity

| Field | Value |
|-------|-------|
| name | `m-net` |
| version | `0.1.0` |
| domain | `m-net` |
| kind | `internal` |

---

## 2. Responsibility

M-Net owns node interconnection, path selection, network policy, DERP / UDP / TCP strategy, node reachability, Leaf Node interconnect range, and Regional Network Profile control-plane lifecycle.

M-Net owns actual networking behavior. M-EventBus carries network events, status synchronization, and strategy notifications.

Current implemented scope:

- logical `network` resource creation
- logical node-to-network membership
- leaf/stem membership rules
- logical network membership queries
- Join Ticket redemption
- public TLS + WebSocket join ingress on `8443`
- runtime token only in `join.accepted` and `session.resume`
- node-agent heartbeat, log forward, and task result frames over the M-Net session protocol
- node reachability and runtime status updates
- offline transition on heartbeat timeout
- Phase 13 Regional Network Profile control-plane lifecycle (see §4)

Still not implemented:

- DERP / UDP / TCP transport
- Headscale control plane
- active reachability probing beyond control-plane heartbeat
- path selection
- regional profile data-plane rollout

Public exposure rule:

- target shape is one public node-join ingress only on `8443`
- `m-net` internal health/ready and internal APIs stay loopback-only on `127.0.0.1:3104`
- raw NATS ports stay private; the public agent boundary is no longer expressed as NATS semantics
- exposing `3000 + 4223` for cross-machine validation is now a development exception only

---

## 3. Default Network Design

- Core runs Headscale DERP Server.
- UDP is preferred by default.
- Tailscale public DERP can be used as fallback.
- Public DERP fallback must be configurable and disableable.

---

## 4. M-Net Regional Profile (Phase 13)

M-Net owns the Regional Network Profile control-plane lifecycle:

- profile definition registration (`m-net-default@0.1.0`, `m-net-cn@0.1.0`).
- per-network applied profile state, transitions, and suspended enable operations.
- external network-profile REST API and OpenAPI (not Core-facaded).
- profile lifecycle events published through M-EventBus.

### M-Net CN

M-Net CN is the first Regional Network Profile. Phase 13 implements the control-plane lifecycle only; data-plane behavior is deferred.

Profile definition `m-net-cn@0.1.0`:

- region: `cn`.
- `controlPlaneOnly: true`. Contains no real endpoints, secrets, relay assignments, routes, or probes.
- enabling M-Net CN is per network, not global.
- enabling requires Phase 12 approval and M-Net resume.
- disabling is immediate with M-Policy allow + Audit (risk-reduction path, no approval flow).
- disable is allowed from `failed` state as a recovery path.

Rules:

- Asian Stem Nodes may act as DERP servers (placeholder only in Phase 13).
- Mainland nodes without public network access must use TCP interconnect (placeholder only).
- Asian Stem Nodes also connect to Core Node over TCP (placeholder only).
- Public DERP fallback must be configurable and disableable.
- M-Net CN changes write M-Log and Audit Log where risk requires it.
- Enabling M-Net CN does not start DERP relays, TCP tunnels, UDP path switching, or active probing.

---

## 5. Events

M-Net must publish:

- node reachability events
- path change events
- DERP fallback events
- UDP / TCP switch events
- Stem relay status events
- Leaf Node interconnect range change events
- network policy publish notifications

All subjects must be listed in `docs/events/EVENT-CATALOG.md`.

Current Core-driven logical-network events:

- `mnet.network.created.v0`
- `mnet.membership.joined.v0`
- `node.join-ticket.created.v0`

Currently published Phase 13 profile lifecycle events:

- `mnet.profile.enable.requested.v0`
- `mnet.profile.enabled.v0`
- `mnet.profile.disable.requested.v0`
- `mnet.profile.disabled.v0`
- `mnet.profile.apply_failed.v0`
- `mnet.profile.enable.canceled.v0`

Current MVP runtime boundary:

- Core -> M-Net create/list/join/member uses loopback HTTP + Eden + internal token
- M-Task -> M-Net agent task dispatch and best-effort cancellation use declared delivery operations; M-Task owns task lifecycle state
- `M-Net` exposes loopback-only `http://127.0.0.1:3104/health`, `/ready`, and `/internal/v0/*`
- `/ready` requires `x-meristem-internal-token`
- Core includes `M-Net` health in aggregated readiness
- public join ingress exposes only `GET /join/v0/health` and `GET /join/v0/session` with WebSocket upgrade
- client -> server frames: `join.redeem`, `session.resume`, `heartbeat`, `log.forward`, `task.result`
- server -> client frames: `join.accepted`, `session.resumed`, `task.execute`, `error`
- `join.accepted` and `session.resumed` return a per-session `sessionId`
- `join.accepted` is the only server frame that returns the runtime token
- `heartbeat`, `log.forward`, and `task.result` must echo the current `sessionId`; stale session ids are rejected with `session.superseded`
- only one active session may exist per node; a successful resume supersedes the previous live connection immediately
- `M-Net` publishes `mnet.reachability.changed.v0` and `node.status.changed.v0` when runtime state changes
- heartbeat timeout and active-session disconnect both recover agent nodes to `offline` / `unreachable`

---

## 6. Done Criteria

- Core can start basic DERP capability or a documented placeholder.
- Nodes can report network status.
- Network status changes enter M-EventBus and M-Log.
- Public DERP fallback is configurable.
- Leaf Node interconnect scope is explicit and auditable.

Phase 6 logical-network done criteria:

- operators can create logical networks through Core and CLI
- operators can join healthy nodes to networks
- leaf joins stay restricted and require a stem member
- logical network create/join writes Audit and Timeline entries

Phase 13 profile lifecycle done criteria:

- M-Net owns profile definitions, per-network profile state, transitions, and suspended profile-enable operations.
- `m-net-cn@0.1.0` is defined as control-plane-only and contains no real endpoint, secret, route, or probe data.
- M-Net exposes the external profile REST API and OpenAPI.
- M-CLI supports network profile list / show / enable / disable through the service URL resolver.
- M-Net CN enable requires Phase 12 approval and resumes through M-Net.
- M-Net CN disable executes immediately with M-Policy allow + Audit.
- Events, Audit, Timeline, and Full Log behavior match `docs/roadmap/PHASE-13.md`.
- Contract, failure-mode, integration, CLI, and e2e gates pass or document infrastructure skip conditions.
