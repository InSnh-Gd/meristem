# Phase 8 - Real Node-Agent Runtime Prototype

## Scope

This phase moves Leaf and Stem node runtime from Core-only simulation toward a real `node-agent` process.

Implemented in this phase:

- public agent join is ticket-driven through `wss://<host>:8443/join/v0/session`
- public `node register` is restricted to `simulated`; agent creation happens on Join Ticket redemption
- Core returns the runtime token only in `join.accepted`, and resumes only through `session.resume`
- `node-agent` sends heartbeat, forwarded logs, and task results through the M-Net session protocol with `sessionId`
- Core dispatches `noop` through M-Net internal HTTP and `task.execute`
- M-Net updates node reachability and runtime status from accepted session heartbeat frames
- M-Log stores forwarded agent logs projected from M-Net session frames

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

1. Create a Join Ticket for a Leaf node.
2. Redeem the Join Ticket through `wss://<host>:8443/join/v0/session`.
3. Observe the redeemed agent node appear as `agent`, `joining`, `unknown`.
4. Start or resume `node-agent` with the runtime token returned by `join.accepted`.
5. Observe the node move from `joining` / `unknown` to `healthy` / `reachable`.
6. Assign a `noop` task and observe synchronous completion through Core -> M-Net -> session `task.execute`.
7. Stop `node-agent` and wait past `MERISTEM_AGENT_HEARTBEAT_TIMEOUT_MS`.
8. Observe the node move to `offline` and `unreachable`.

`node register --kind leaf` without `--mode` remains the simulated-node path. Agent-mode public registration must happen through Join Ticket redemption.
