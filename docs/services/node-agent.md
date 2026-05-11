# Node Agent Service Definition

## 1. Identity

| Field | Value |
|-------|-------|
| name | `node-agent` |
| version | `0.1.0` |
| domain | `m-net` |
| kind | `node` |

---

## 2. Current Runtime Scope

Current implemented responsibilities:

- connect to the public `M-Net` join ingress over `wss://.../join/v0/session`
- redeem a one-time Join Ticket on first join
- resume with the runtime token returned by `join.accepted`
- keep the current session lease id returned by `join.accepted` / `session.resumed`
- send `heartbeat` and `log.forward` frames over the M-Net session protocol with that `sessionId`
- answer `task.execute` with `task.result` for `noop`, again echoing the current `sessionId`
- identify itself with one per-node opaque runtime token after join

Current non-goals:

- no public HTTP API
- no DERP / TCP / UDP transport
- no node-to-node mesh data plane
- no local privilege expansion beyond the registered node scope

## 3. Required Environment

- `MERISTEM_JOIN_URL` - defaults to `wss://localhost:8443/join/v0/session`
- either `MERISTEM_JOIN_TICKET` for first join or `MERISTEM_NODE_ID` + `MERISTEM_NODE_TOKEN` for resume
- `MERISTEM_AGENT_HEARTBEAT_INTERVAL_MS`
- `MERISTEM_AGENT_VERSION`

Deployment note:

- public remote agents now connect only through the single M-Net join ingress
- raw NATS WebSocket access is no longer the target public runtime path

## 4. Security Rules

- first-join ticket plaintext must come from Core ticket issuance
- runtime token plaintext comes from `join.accepted` and must be used for `session.resume`
- heartbeat, forwarded log, and task reply frames rely on the authenticated session plus the current `sessionId`; they do not repeat the runtime token in every payload
- token must not be printed in stdout, Timeline, Full Log, or Audit payloads
- reissued tokens immediately invalidate the previous runtime
- a successful `session.resume` rotates the active session lease and supersedes the previous live socket

## 5. Runtime Contract

- `join.accepted` creates the agent node in `joining` / `unknown`
- `join.accepted` and `session.resumed` both return the current `sessionId`
- first accepted heartbeat moves the node toward `healthy` / `reachable`
- stopping heartbeat or disconnecting the active socket allows M-Net to mark the node `offline` / `unreachable`
- `noop` task execution returns `completed` with `taskId` and `nodeId`
- forwarded logs enter M-Net first, then M-Log as Full Log entries
