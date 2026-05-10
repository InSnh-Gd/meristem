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

M-Net owns node interconnection, path selection, network policy, DERP / UDP / TCP strategy, node reachability, Leaf Node interconnect range, and regional network profiles.

M-Net owns actual networking behavior. M-EventBus carries network events, status synchronization, and strategy notifications.

Current implemented scope:

- logical `network` resource creation
- logical node-to-network membership
- leaf/stem membership rules
- logical network membership queries
- Join Ticket redemption
- public TLS + WebSocket join ingress on `8443`
- runtime token resume over the same session path
- node-agent heartbeat ingestion over the M-Net session protocol
- node reachability and runtime status updates
- offline transition on heartbeat timeout

Still not implemented:

- DERP / UDP / TCP transport
- Headscale control plane
- active reachability probing beyond control-plane heartbeat
- path selection
- regional profile rollout

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

## 4. M-Net CN

M-Net CN is the first Regional Network Profile and belongs to the M-Extension boundary.

Rules:

- Asian Stem Nodes may act as DERP servers.
- Mainland nodes without public network access must use TCP interconnect.
- Asian Stem Nodes also connect to Core Node over TCP.
- Enabling M-Net CN must be controlled by M-Policy.
- M-Net CN changes must write M-Log and Audit Log where risk requires it.

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

Current MVP runtime boundary:

- Core -> M-Net create/list/join/member and agent task dispatch use loopback HTTP + Eden + internal token
- `M-Net` exposes loopback-only `http://127.0.0.1:3104/health`, `/ready`, and `/internal/v0/*`
- `/ready` requires `x-meristem-internal-token`
- Core includes `M-Net` health in aggregated readiness
- public join ingress exposes only `GET /join/v0/health` and `GET /join/v0/session` with WebSocket upgrade
- client -> server frames: `join.redeem`, `session.resume`, `heartbeat`, `log.forward`, `task.result`
- server -> client frames: `join.accepted`, `session.resumed`, `task.execute`, `error`
- `join.accepted` and `session.resumed` return a per-session `sessionId`
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
