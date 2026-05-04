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

Still not implemented:

- DERP / UDP / TCP transport
- Headscale control plane
- reachability probing
- path selection
- regional profile rollout

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

Current Core -> M-Net request/reply subjects:

- `mnet.network.create.v0`
- `mnet.network.list.v0`
- `mnet.network.join.v0`
- `mnet.network.members.list.v0`

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
