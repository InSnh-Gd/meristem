# Node Agent Service Definition

## 1. Identity

| Field | Value |
|-------|-------|
| name | `node-agent` |
| version | `0.1.0` |
| domain | `m-net` |
| kind | `node` |
| owner | Meristem node-agent maintainers |

---

## 2. Responsibility

The node-agent is the long-running agent on Stem or Leaf nodes. It joins through the M-Net public ingress, maintains a session lease, forwards logs, and executes noop task requests dispatched through M-Task via M-Net.

What this service owns:

- TLS + WebSocket join through the M-Net public join ingress
- one-time Join Ticket redemption for first join
- current session lease tracking (`sessionId`)
- runtime-token-based session resume
- heartbeat, log-forward, and task-result frame emission
- execution of `task.execute` frames and return of `task.result`

What this service must not own:

- public HTTP APIs
- DERP / TCP / UDP transport implementation
- node-to-node data-plane mesh behavior
- local privilege expansion
- M-Policy authorization decisions
- Audit Log writes

---

## 3. Contracts

| Contract | Path / Subject | Version | Notes |
|----------|----------------|---------|-------|
| WebSocket | `wss://<host>:8443/join/v0/session` | `v0` | public node-join ingress |
| client → server frames | `join.redeem`, `session.resume`, `heartbeat`, `log.forward`, `task.result` | `v0` | all frames must echo the current `sessionId` |
| server → client frames | `join.accepted`, `session.resumed`, `task.execute`, `error` | `v0` | only `join.accepted` returns the runtime token |

Frame rules:

- `join.accepted` returns the runtime token and current `sessionId`, and moves the node into `joining` / `unknown`.
- `session.resumed` returns only the refreshed `sessionId`, never a token.
- the first successful heartbeat moves the node toward `healthy` / `reachable`.
- heartbeat loss or disconnect moves the node to `offline` / `unreachable`.
- only one active session may exist per node; a successful resume supersedes the previous live socket.
- `heartbeat`, `log.forward`, and `task.result` must echo the current `sessionId`; stale leases are rejected with `session.superseded`.
- noop task execution returns `completed` with `taskId` and `nodeId`.
- forwarded logs enter M-Net first, then land in M-Log Full Log.

---

## 4. Permissions

Node-agent permissions derive from the node `capabilities` declared at registration plus the runtime token issued during join. The agent does not manage permissions itself.

| Permission | Required For | Risk |
|------------|--------------|------|
| runtime token | maintain session and resume connection | high |
| `capabilities` set | declare allowed node behavior | medium |

---

## 5. Dependencies

| Dependency | Type | Failure Behavior |
|------------|------|------------------|
| M-Net join ingress | service | agent cannot join or resume and remains offline |
| M-Task (via M-Net) | service | task execution requests are not delivered |
| M-Log (via M-Net) | service | forwarded logs are buffered locally until the session recovers |

---

## 6. Configuration

| Key | Type | Required | Hot Reload | Notes |
|-----|------|----------|------------|-------|
| `MERISTEM_JOIN_URL` | URL | no | no | defaults to `wss://localhost:8443/join/v0/session` |
| `MERISTEM_JOIN_TICKET` | string | required for first join | no | one-time Join Ticket plaintext |
| `MERISTEM_NODE_ID` | string | required for resume | no | registered node ID |
| `MERISTEM_NODE_TOKEN` | string | required for resume | no | runtime token plaintext |
| `MERISTEM_AGENT_HEARTBEAT_INTERVAL_MS` | number | yes | no | heartbeat interval |
| `MERISTEM_AGENT_VERSION` | string | yes | no | agent version string |

---

## 7. Health

Not applicable as a standalone HTTP probe. Node-agent health is expressed through M-Net session heartbeat and reachability events.

---

## 8. Lifecycle

| Capability | Supported | Notes |
|------------|-----------|-------|
| reloadable | no | config changes require agent process restart |
| rollbackable | no | recovery happens through rejoin/resume |
| degradable | limited | local log buffering is allowed while M-Net is unavailable |

---

## 9. Logs

| Log | When Written | Required Fields |
|-----|--------------|-----------------|
| Timeline | not written directly | — |
| Full | local runtime errors, connection events, task execution results | `source`, `level`, `message`, `traceId`, `correlationId` |
| Audit | not written directly | — |

Node-agent forwarded logs enter M-Net through `log.forward` and then land in M-Log Full Log. Runtime token plaintext must never appear in logs or user-facing errors.

---

## 10. Security Rules

- first-join Join Ticket plaintext must originate from Core ticket issuance.
- runtime token plaintext must originate only from `join.accepted` and be used only for `session.resume`.
- heartbeat, log-forward, and task-result frames rely on the authenticated session plus current `sessionId`; the runtime token is not repeated per payload.
- `join.accepted` is the only frame that returns the runtime token; `session.resumed` returns only the refreshed `sessionId`.
- tokens must never be printed to stdout, Timeline, Full Log, or Audit payloads.
- newly issued tokens invalidate the previous runtime token immediately.
- successful `session.resume` rotates the active session lease and supersedes the prior live socket.

---

## 11. Policy Requirements

- node-agent does not call M-Policy directly.
- node capabilities and permissions are decided by Core / M-Policy during registration and join; the agent only executes already-authorized task types.
- high-risk operations must never bypass Core / M-Policy locally.

---

## 12. Done Criteria

- the agent can join for the first time with a Join Ticket.
- the agent can resume with a runtime token.
- the agent can send heartbeats and be recognized as `healthy` / `reachable`.
- the agent can forward logs.
- the agent can execute noop tasks and return results.
- heartbeat loss or disconnect moves the node to `offline` / `unreachable`.
- runtime tokens never appear in logs, stderr, or stdout.
- session-superseded behavior is covered by tests.
