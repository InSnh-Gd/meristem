# Phase 6 - Logical Node Networks and M-Net Orchestration

> Goal: implement explicit logical networks so multiple registered nodes can join the same auditable network domain before real M-Net transport exists.

---

## 1. Scope

Phase 6 includes:

- `networks` and `network_memberships` tables.
- independent `m-net` service.
- Core REST routes for network create/list/join/member list.
- CLI network commands.
- Audit and Timeline behavior for network create/join.
- NATS request/reply between Core and M-Net.
- logical leaf/stem membership rules.

Phase 6 excludes:

- real DERP / UDP / TCP connectivity.
- Headscale control-plane integration.
- node heartbeat and reachability probing.
- multi-Core federation.
- network leave, revoke, and path policy rollout.

---

## 2. Required API

- `POST /api/v0/networks`
- `GET /api/v0/networks`
- `POST /api/v0/networks/:id/members`
- `GET /api/v0/networks/:id/members`

---

## 3. Required CLI

```bash
meristem network create --name <name> [--profile <profileVersion>]
meristem network list
meristem network join --network <network-id> --node <node-id>
meristem network members --network <network-id>
```

---

## 4. Required Events

- `mnet.network.created.v0`
- `mnet.membership.joined.v0`

---

## 5. Completion Criteria

- operators can create a logical network.
- operators can join at least two stem nodes to the same network.
- leaf nodes join as restricted members only.
- leaf join without an existing stem member is rejected.
- network create and join actions are auditable.
- network membership is queryable through REST and CLI.

---

## 6. Verification Checklist

```bash
bun run meristem node register --kind stem --name stem-a
bun run meristem node register --kind stem --name stem-b
bun run meristem network create --name lab-mesh
bun run meristem network join --network <network-id> --node <stem-a-id>
bun run meristem network join --network <network-id> --node <stem-b-id>
bun run meristem network members --network <network-id>
```

Manual checks:

- verify `networks` and `network_memberships` rows in PostgreSQL
- verify Timeline and Audit entries for network actions
- observe `mnet.network.created.v0` and `mnet.membership.joined.v0`
