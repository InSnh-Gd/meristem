# Phase 8 - Real Node-Agent Runtime Prototype

## Scope

This phase moves Leaf and Stem node runtime from Core-only simulation toward a real `node-agent` process.

Implemented in this phase:

- public agent join is ticket-driven through `wss://<host>:8443/join/v0/session`
- public `node register` is restricted to `simulated`; agent creation happens on Join Ticket redemption
- Core can issue one active opaque runtime token per node
- `node-agent` sends heartbeat and forwarded logs through the M-Net session protocol
- Core dispatches `noop` through M-Net internal HTTP and `task.execute`
- M-Net updates node reachability and runtime status from accepted session heartbeat frames
- M-Log ingests forwarded agent logs via M-Net

Still out of scope:

- DERP / Headscale / UDP / TCP transport
- node-to-node path selection
- per-node NATS accounts
- node-agent HTTP control plane

## Required Scripts

```bash
bun run db:migrate
bun run db:seed
bun run dev:all
bun run dev:node-agent
```

## Acceptance

1. Register a Leaf node without `--mode`; it should appear as `agent`, `joining`, `unknown`.
2. Create a Join Ticket for that Leaf.
3. Start `node-agent` with `MERISTEM_JOIN_TICKET`.
4. Observe the node move from `joining` / `unknown` to `healthy` / `reachable`.
5. Assign a `noop` task and observe synchronous completion through Core -> M-Net -> session `task.execute`.
6. Stop `node-agent` and wait past `MERISTEM_AGENT_HEARTBEAT_TIMEOUT_MS`.
7. Observe the node move to `offline` and `unreachable`.
