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

The node-agent is the long-running agent on Stem or Leaf nodes. It joins through the M-Net public ingress, maintains a session lease, forwards logs, executes task requests dispatched through M-Task via M-Net, pulls and enforces signed network maps, and manages host-local data-plane sidecar lifecycle.

v0.2 data-plane direction (ADR-N04): target sidecar is NetBird client. Proof gate: `bun run mnet:v02:sidecar-proof`. NetBird Management excluded. Current legacy path (ADR-N03): node-agent manages host-local WireGuard + wstunnel sidecars with ACME certificate provisioning for relay TLS.

What this service owns:

- TLS + WebSocket join through the M-Net public join ingress
- one-time Join Ticket redemption for first join
- current session lease tracking (`sessionId`)
- runtime-token-based session resume
- heartbeat, log-forward, and task-result frame emission
- execution of `task.execute` frames and return of `task.result`
- signed network-map pull, TTL enforcement, and local ACL render
- host-local WireGuard interface lifecycle (create, configure, tear down)
- NetBird client sidecar lifecycle (v0.2 target per ADR-N04, pending viability proof `bun run mnet:v02:sidecar-proof`)
- host-local wstunnel relay sidecar lifecycle (ADR-N03 legacy path: start, health-check, restart, stop)
- ACME certificate provisioning for wstunnel relay TLS (ADR-N03 legacy path)
- WireGuard key generation boundary on the host (private key never leaves host)
- partition state machine (connected, stale, partitioned, offline)
- local log buffering when M-Net is unreachable

What this service must not own:

- public HTTP APIs
- protocol implementation of WireGuard, wstunnel relay, TCP, UDP, DERP, or NetBird Management (node-agent coordinates host-local configuration, lifecycle, health, and drift reporting for these tools, but does not implement transport protocols directly)
- node-to-node data-plane mesh forwarding (forwarding is performed by the WireGuard kernel module and wstunnel/NetBird client processes)
- NetBird Dashboard, ACL/policy, auth/SSO, audit/logging, or account model (excluded per ADR-N04)
- NetBird Signal / Relay / STUN service lifecycle or configuration (infrastructure dependencies managed by NixOS/systemd; node-agent only manages the local client sidecar)
- local privilege expansion beyond declared systemd capabilities
- M-Policy authorization decisions
- Audit Log writes
- M-Log storage or query
- M-Task canonical task lifecycle state
- private key storage or export outside the host-local secure path

---

## 3. Contracts

| Contract | Path / Subject | Version | Notes |
|----------|----------------|---------|-------|
| WebSocket | `wss://<host>:8443/join/v0/session` | `v0` | public node-join ingress |
| client → server frames | `join.redeem`, `session.resume`, `heartbeat`, `log.forward`, `task.result` | `v0` | all frames must echo the current `sessionId` |
| server → client frames | `join.accepted`, `session.resumed`, `task.execute`, `error` | `v0` | only `join.accepted` returns the runtime token |
| network-map pull | signed network map via M-Net session | `v0` | node-agent verifies signature before applying map |
| key metadata report | WireGuard public key + fingerprint to M-Net | `v0` | private key never leaves host |

Frame rules:

- `join.accepted` returns the runtime token and current `sessionId`, and moves the node into `joining` / `unknown`.
- `session.resumed` returns only the refreshed `sessionId`, never a token.
- the first successful heartbeat moves the node toward `healthy` / `reachable`.
- heartbeat loss or disconnect moves the node to `offline` / `unreachable`.
- only one active session may exist per node; a successful resume supersedes the previous live socket.
- `heartbeat`, `log.forward`, and `task.result` must echo the current `sessionId`; stale leases are rejected with `session.superseded`.
- noop task execution returns `completed` with `taskId` and `nodeId`.
- forwarded logs enter M-Net first, then land in M-Log Full Log.
- signed network maps carry a TTL. Node-agent tears down all Meristem-managed tunnels when the map is stale past `MERISTEM_MNET_NETWORK_MAP_STALE_TTL_MS` (default 900000 ms / 15 minutes).
- operator/API runtime token rotation revokes the prior active token before returning a replacement token once.
- operator/API runtime token revoke removes the current active token without issuing a replacement.
- until a future automation slice exists, node-agent does not auto-refresh runtime tokens; operators must restart or reconfigure it with the new token after rotation.
- once a token has been rotated or revoked, later `session.resume` attempts with the old token must fail closed.

---

## 4. Permissions

Node-agent permissions derive from the node `capabilities` declared at registration plus the runtime token issued during join. The agent does not manage permissions itself.

| Permission | Required For | Risk |
|------------|--------------|------|
| runtime token | maintain session and resume connection | high |
| `capabilities` set | declare allowed node behavior | medium |

Systemd capabilities required on the host:

| Capability | Required For | Justification |
|------------|--------------|---------------|
| `CAP_NET_ADMIN` | WireGuard interface creation, configuration, and tear-down | kernel-level network interface management |
| file system access | reading `MERISTEM_HOST_PRIVATE_KEY_PATH` and `MERISTEM_WG_BINARY_PATH` | host-local secret and binary access |
| network access | outbound WebSocket to M-Net join ingress on `8443`; outbound to wstunnel relay endpoint via WSS/443 | control-plane and data-plane connectivity |

The node-agent process must run with the minimum set of Linux capabilities. It must not request capabilities it does not need (e.g., `CAP_SYS_BOOT`, `CAP_SYS_ADMIN`, `CAP_SYS_PTRACE`).

---

## 5. Dependencies

| Dependency | Type | Failure Behavior |
|------------|------|------------------|
| M-Net join ingress | service | agent cannot join or resume and remains offline |
| M-Net control plane | service | network-map pull fails; agent enters stale-map fail-closed after TTL |
| M-Task (via M-Net) | service | task execution requests are not delivered |
| M-Log (via M-Net) | service | forwarded logs are buffered locally until the session recovers |
| WireGuard (`wg` binary) | host tool | tunnel configuration cannot be applied; agent reports degraded |
| NetBird client binary | host tool (v0.2 target) | NetBird sidecar cannot start; agent enters degraded mode pending viability proof (`bun run mnet:v02:sidecar-proof`) |
| wstunnel binary | host tool (ADR-N03 legacy path) | relay sidecar cannot start; agent enters relay-only degraded mode |
| NetBird Signal | infrastructure service (v0.2 target) | managed externally by NixOS/systemd; not a node-agent runtime dependency |
| NetBird Relay/STUN | infrastructure service (v0.2 target) | managed externally by NixOS/systemd; not a node-agent runtime dependency |
| ACME directory | external service | TLS certificate renewal for wstunnel may fail; existing certs continue until expiry |
| systemd / init system | host service | agent process management (start, stop, restart) depends on host init |

---

## 6. Configuration

### 6.1 Environment Variables

| Key | Type | Required | Hot Reload | Secret | Default | Notes |
|-----|------|----------|------------|--------|---------|-------|
| `MERISTEM_JOIN_URL` | URL | no | no | no | `wss://localhost:8443/join/v0/session` | join ticket redemption endpoint |
| `MERISTEM_JOIN_TICKET` | string | required for first join | no | yes | none | one-time Join Ticket plaintext; consumed and discarded after first successful join |
| `MERISTEM_NODE_ID` | string | required for resume | no | no | none | registered node ID; obtained from `join.accepted` |
| `MERISTEM_NODE_TOKEN` | string | required for resume | no | yes | none | runtime token plaintext; obtained from `join.accepted`, used only for `session.resume` |
| `MERISTEM_AGENT_HEARTBEAT_INTERVAL_MS` | number | no | no | no | `5000` | heartbeat interval in milliseconds |
| `MERISTEM_AGENT_VERSION` | string | no | no | no | `0.1.0` | agent version string reported in heartbeats |
| `MERISTEM_MNET_CONTROL_URL` | URL | no | no | no | derived from join URL host on port `3104` | M-Net control plane URL for network-map pull and key metadata reporting |
| `MERISTEM_NODE_AGENT_FORCE_RELAY` | boolean | no | no | no | `false` | when `true` or `1`, node-agent renders every WireGuard peer `Endpoint` as the declared local wstunnel UDP sidecar endpoint, ignoring API-visible member `endpoint` values; used for cloud topologies where direct leaf-to-leaf UDP is blocked, while committed node-agent apply logic still avoids host firewall/netfilter redirect commands |
| `MERISTEM_MNET_NETWORK_MAP_STALE_TTL_MS` | number | no | yes | no | `900000` | stale map TTL in milliseconds (15 minutes); after this duration without a fresh signed map, node-agent enters fail-closed by tearing down tunnels |
| `MERISTEM_WG_BINARY_PATH` | string | no | no | no | `wg` (PATH lookup) | WireGuard binary path for interface configuration |
| `MERISTEM_WG_INTERFACE_NAME` | string | no | no | no | `meristem-wg0` | WireGuard 接口名 |
| `MERISTEM_WSTUNNEL_BINARY_PATH` | string | no | no | no | `wstunnel` (PATH lookup) | wstunnel binary path for relay sidecar |
| `MERISTEM_WSTUNNEL_LOCAL_ENDPOINT` | host:port | no | no | no | `127.0.0.1:51821` | local UDP listener exposed by the wstunnel sidecar; used as the rendered WireGuard peer endpoint when `MERISTEM_NODE_AGENT_FORCE_RELAY=true` |
| `MERISTEM_ACME_DIRECTORY` | URL | no | no | no | Let's Encrypt production directory | ACME directory URL for TLS certificate provisioning |
| `MERISTEM_ACME_ACCOUNT_KEY` | string | no | no | yes | none | ACME account private key (PEM); used to sign certificate requests |
| `MERISTEM_HOST_PRIVATE_KEY_PATH` | string | no | no | yes | none | path to host WireGuard private key file; must be host-local only, never transmitted |
| `MERISTEM_RELAY_ENDPOINT` | URL | no | yes | no | none | wstunnel relay endpoint (WSS URL); used for relay fallback |
| `MERISTEM_LOG_LEVEL` | string | no | yes | no | `info` | log level: `debug`, `info`, `warn`, or `error` |

### 6.2 Host File Layout

The NixOS / systemd packaging for the first topology keeps all mutable node-agent inputs under `/etc/meristem/node-agent/`.

| Path | Purpose |
|------|---------|
| `/etc/meristem/node-agent/node-agent.env` | non-secret runtime defaults consumed by `EnvironmentFile=` |
| `/etc/meristem/node-agent/join-ticket` | one-time join ticket plaintext written by install automation |
| `/etc/meristem/node-agent/node-id` | node ID used for resume flows |
| `/etc/meristem/node-agent/runtime-token` | runtime token used for `session.resume` |
| `/etc/meristem/node-agent/wg/private.key` | host-local WireGuard private key |
| `/etc/meristem/node-agent/tls/account.key` | ACME account key for relay certificate issuance |
| `/var/lib/meristem/node-agent/runtime.json` | 运行时状态（nodeId + runtimeToken + savedAt），跨重启持久化 |

The launcher script reads these files only when the corresponding `MERISTEM_*` environment variable is absent.

### 6.3 Secret Rules

- `MERISTEM_JOIN_TICKET` plaintext must originate from Core ticket issuance.
- `MERISTEM_NODE_TOKEN` plaintext must originate only from `join.accepted` and be used only for `session.resume`.
- `MERISTEM_ACME_ACCOUNT_KEY` must never leave the host and must never be logged.
- `MERISTEM_HOST_PRIVATE_KEY_PATH` points to a file whose contents must never be transmitted, logged, or exposed through any API.
- token plaintext and private keys must never appear in stdout, stderr, Timeline, Full Log, or Audit payloads.

### 6.4 Hot Reload Behavior

The following configuration keys support hot reload without process restart:

- `MERISTEM_MNET_NETWORK_MAP_STALE_TTL_MS`: new TTL takes effect on the next network-map pull cycle.
- `MERISTEM_RELAY_ENDPOINT`: the active relay connection is re-established with the new endpoint.
- `MERISTEM_LOG_LEVEL`: log level changes immediately for subsequent log entries.

All other configuration keys require agent process restart to take effect.

### 6.5 Deployment Target

The node-agent deploys as a systemd service unit on each Stem or Leaf host. The first topology packages it through the exported NixOS module `nixosModules.meristem-node-agent` and the profile `ops/nixos/profiles/meristem-node-agent.nix`.

The service unit file must declare:

- the required Linux capability (`CAP_NET_ADMIN`) and no broader capability set.
- read access to `MERISTEM_HOST_PRIVATE_KEY_PATH`.
- network access for outbound WebSocket connections.
- an `ExecStartPre` WireGuard preflight that verifies `wg --version`, the visible `/sys/module/wireguard` kernel module, and interface creation with `ip link add ... type wireguard`.
- a launcher boundary that can source `/etc/meristem/node-agent/{join-ticket,node-id,runtime-token}` before `bun run services/node-agent/src/index.ts`.

---

## 7. ACME Trust

The node-agent provisions TLS certificates for the wstunnel relay sidecar through ACME (Automatic Certificate Management Environment).

| Concern | Behavior |
|---------|----------|
| certificate authority | Let's Encrypt (production) by default; configurable via `MERISTEM_ACME_DIRECTORY` |
| trust store | system trust store is used for ACME directory TLS verification |
| account key | stored at `MERISTEM_ACME_ACCOUNT_KEY` (host-local, never transmitted) |
| renewal | automatic renewal before expiry; agent checks certificate lifetime on startup and periodically |
| renewal failure | existing certificate continues to be used until expiry; agent logs a warning and retries with exponential backoff |
| first-time provisioning | agent performs ACME HTTP-01 or DNS-01 challenge (challenge type selected by configuration); on failure, wstunnel starts without TLS and agent reports degraded |

ACME certificate details:

- the provisioned certificate is used by the wstunnel sidecar for WSS/443 relay connections.
- certificate and private key are stored in a host-local directory (`/var/lib/meristem/certs/`).
- certificate file permissions must be `0600`; private key file permissions must be `0400`.
- agent monitors certificate expiry and renews 30 days before expiration.

---

## 8. WireGuard Tooling Checks

The node-agent validates the WireGuard host tooling before attempting tunnel configuration.

| Check | Method | Failure Behavior |
|-------|--------|------------------|
| binary presence | stat `MERISTEM_WG_BINARY_PATH` (default: `wg` from PATH) | agent starts in degraded mode; WireGuard tunnels are not configured |
| version check | `wg --version` output parsing | agent logs version for diagnostics; incompatible versions trigger a warning |
| kernel module | check `/sys/module/wireguard` or attempt `modprobe wireguard` | agent logs the module status; if module is absent and cannot be loaded, WireGuard operations fail |
| key generation | `wg genkey` for private key, `wg pubkey` for public key derivation | private key is generated once, stored at `MERISTEM_HOST_PRIVATE_KEY_PATH`, and never leaves the host; public key is reported to M-Net |

Key generation boundary:

- private key generation occurs on the host using `wg genkey`.
- the generated private key is written to `MERISTEM_HOST_PRIVATE_KEY_PATH` with `0600` permissions.
- public key is derived from the private key using `wg pubkey` and reported upstream.
- private key rotation is triggered by M-Net key rotation policy; the new public key is reported before the old key is retired.
- the private key file must never be read by any process other than the node-agent and the WireGuard kernel interface.

WireGuard 配置通过 `wg setconf` 应用，不使用 `wg-quick`。配置文件不包含 `Address=` 指令（由 `ip address replace` 单独处理），私钥以 base64 内容内联（不是文件路径）。

---

## 9. Sidecar Boundary

The wstunnel relay sidecar is a separate process managed by the node-agent. The node-agent owns the sidecar lifecycle but does not implement the relay protocol.

| Concern | Behavior |
|---------|----------|
| process start | node-agent spawns wstunnel as a child process with the configured relay endpoint and ACME certificate |
| process stop | node-agent sends SIGTERM, waits for graceful shutdown, then sends SIGKILL after a timeout |
| process restart | on crash or unexpected exit, node-agent restarts wstunnel with exponential backoff (1s, 2s, 4s, 8s, max 60s) |
| health check | node-agent periodically checks wstunnel process liveness via PID and optionally a local health endpoint |
| configuration | node-agent writes wstunnel configuration (relay endpoint, certificate paths, log level) before starting the sidecar |
| lifecycle coupling | wstunnel lifecycle is independent of the M-Net session; the sidecar can start before join and can survive session interruptions |
| stdout/stderr | wstunnel stdout and stderr are captured and forwarded as `log.forward` frames when the M-Net session is active |

Sidecar boundary rules:

- the node-agent must not embed or reimplement wstunnel protocol logic.
- the node-agent must not share its runtime token or session credentials with the wstunnel process.
- wstunnel configuration must not contain plaintext secrets beyond the ACME certificate paths.
- force-relay support is limited to the declared local UDP sidecar endpoint (`MERISTEM_WSTUNNEL_LOCAL_ENDPOINT`, default `127.0.0.1:51821`) that WireGuard peers reference directly.
- unsupported workaround patterns include ad hoc host firewall or netfilter redirect rules (for example `iptables`, `nft`, `OUTPUT`, `SNAT`, or `MASQUERADE`) that try to rewrite WireGuard traffic outside the node-agent-owned sidecar and `ip`/WireGuard command boundary.
- if wstunnel fails to start after maximum retries, the node-agent enters relay-only degraded mode and reports the failure upstream.

---

## 10. Health

Node-agent health is expressed through two mechanisms: M-Net session heartbeat for control-plane reachability, and local sidecar health for data-plane readiness.

| Check | Meaning | Failure Behavior |
|-------|---------|------------------|
| liveness | node-agent process is running and the M-Net session loop is active | restart node-agent process |
| readiness | M-Net session is established, WireGuard interface is configured, and wstunnel sidecar is running | remove node from active serving pool; continue to retry |
| sidecar readiness | wstunnel process is alive and responsive | report degraded; continue to retry sidecar restart |
| WireGuard readiness | WireGuard interface exists and has at least one configured peer | report degraded; wait for fresh network map |

Probe behavior:

- liveness is reported through the M-Net session heartbeat (`heartbeat` frame with `reportedStatus`).
- readiness is a composite of session state, sidecar health, and WireGuard interface state.
- the node-agent may expose a local HTTP health endpoint on `127.0.0.1:9090` for systemd health checks and operator diagnostics.

---

## 11. Lifecycle

| Capability | Supported | Notes |
|------------|-----------|-------|
| reloadable | limited | hot-reloadable config keys as listed in §6.3; full config changes require process restart |
| rollbackable | yes | version downgrade restores previous config; sidecar state is torn down and re-created |
| degradable | yes | relay-only, stale-map fail-closed, and partition states are explicit degraded modes |
| restart | yes | on SIGTERM, agent drains the active session, stops sidecars, and exits cleanly; on SIGINT, agent performs graceful shutdown |
| upgrade | yes | agent binary upgrade is orchestrated by systemd; config migration is handled during the new version's first start |

Start sequence:

1. validate all required environment variables.
2. verify WireGuard tooling (binary, kernel module).
3. start wstunnel relay sidecar.
4. connect to M-Net join ingress; redeem Join Ticket or resume session.
5. once session is established, pull the latest signed network map.
6. configure WireGuard interfaces and peers based on the network map.
7. start heartbeat loop.
8. report readiness.

Stop sequence:

1. stop heartbeat loop.
2. send final `log.forward` with shutdown reason.
3. close M-Net WebSocket session.
4. tear down WireGuard interfaces.
5. stop wstunnel relay sidecar.
6. exit process.

---

## 12. Degraded Modes

The node-agent enters explicit degraded modes when dependencies or conditions degrade. Degraded behavior is reported through heartbeats and log-forward frames.

| Mode | Trigger | Behavior | Recovery |
|------|---------|----------|----------|
| relay-only | wstunnel is running but WireGuard interface is not configured or has no peers | control-plane traffic flows through M-Net WebSocket; data-plane is unavailable | wait for fresh network map with valid peer configuration |
| stale-map fail-closed | current signed network map has been stale for longer than `MERISTEM_MNET_NETWORK_MAP_STALE_TTL_MS` | all Meristem-managed WireGuard tunnels are torn down; node-agent refuses to forward traffic | pull fresh network map; if successful, re-apply tunnels |
| partition | M-Net session is active but the network map reports the node as partitioned from peers | data-plane traffic is blocked; control-plane continues | wait for network map to clear partition; re-apply tunnel configuration |
| session-offline | M-Net WebSocket session is disconnected | heartbeats stop; existing tunnels remain configured until stale-map TTL expires; logs are buffered locally | reconnect and resume session |
| sidecar-failure | wstunnel process has crashed and restart retries are exhausted | relay path is unavailable; agent reports degraded; WireGuard direct peering may still function if peers are reachable | manual intervention or process restart |
| WireGuard-unavailable | WireGuard binary or kernel module is absent | all tunnel operations fail; agent starts in degraded mode and reports status upstream | install WireGuard and restart agent |

---

## 13. Rollback

| Scenario | Behavior |
|----------|----------|
| version downgrade | agent binary is replaced by systemd; on next start, agent reads the existing config and state; WireGuard interfaces are torn down and re-created from the current network map |
| config revert | operator sets previous config values and issues `systemctl restart meristem-node-agent`; agent re-reads all environment variables on start |
| network-map rollback | M-Net issues a new signed network map reverting to a previous topology; node-agent pulls and applies the new map normally |
| sidecar rollback | wstunnel binary is replaced; node-agent restarts the sidecar on next health check failure or process restart |

Rollback must not leave stale WireGuard interfaces or wstunnel processes running. The agent's stop sequence (§11) always performs a full teardown before exit.

---

## 14. Logs

| Log | When Written | Required Fields |
|-----|--------------|-----------------|
| Timeline | not written directly | — |
| Full | local runtime errors, connection events, task execution results, WireGuard configuration changes, sidecar lifecycle events, network-map application events | `source`, `level`, `message`, `traceId`, `correlationId` |
| Audit | not written directly | — |

Node-agent forwarded logs enter M-Net through `log.forward` and then land in M-Log Full Log. Runtime token plaintext, private keys, and ACME account keys must never appear in logs or user-facing errors.

Structured log fields for forwarded logs:

| Field | Required | Description |
|-------|----------|-------------|
| `type` | yes | always `log.forward` |
| `sessionId` | yes | current session ID |
| `level` | yes | `debug`, `info`, `warn`, or `error` |
| `message` | yes | human-readable log message |
| `timestamp` | yes | ISO 8601 timestamp |
| `traceId` | no | OpenTelemetry trace ID |
| `correlationId` | no | correlation ID for request tracing |
| `payload` | no | structured context (must not contain secrets) |

Local log buffering:

- when the M-Net session is disconnected, logs are buffered in a local ring buffer (maximum 1000 entries).
- on session resume, buffered logs are forwarded in FIFO order.
- if the buffer is full, the oldest entries are dropped and a single `log.forward` with `level: warn` and `message: "log buffer overflow, oldest entries dropped"` is emitted when the session resumes.

---

## 15. Audit Facts

The node-agent does not write Audit Log entries directly. Audit facts are generated by M-Net and Core for node-agent-related events.

Events that produce audit facts (emitted by M-Net, not node-agent):

| Event Subject | Trigger | Audit Fields |
|---------------|---------|--------------|
| `node.join.redeemed` | node-agent redeems a Join Ticket | `nodeId`, `ticketId`, `timestamp` |
| `node.session.resumed` | node-agent resumes a session | `nodeId`, `sessionId`, `timestamp` |
| `node.session.superseded` | a new session supersedes an existing one | `nodeId`, `oldSessionId`, `newSessionId`, `timestamp` |
| `node.offline` | heartbeat timeout or disconnect | `nodeId`, `lastSeenAt`, `reason` |
| `node.map.applied` | node-agent applies a new network map | `nodeId`, `networkId`, `mapVersion`, `timestamp` |
| `node.map.stale` | node-agent enters stale-map fail-closed | `nodeId`, `networkId`, `staleForMs`, `timestamp` |
| `node.key.rotated` | WireGuard key rotation | `nodeId`, `keyId`, `fingerprint`, `timestamp` |

The node-agent reports these state changes to M-Net, which then publishes the corresponding events and writes Audit Log entries. The node-agent must not publish events directly or write audit records.

---

## 16. Policy Requirements

- node-agent does not call M-Policy directly.
- node capabilities and permissions are decided by Core / M-Policy during registration and join; the agent only executes already-authorized task types.
- network-map enforcement (ACL render, tunnel configuration) follows the signed map; the agent does not make independent policy decisions.
- high-risk operations must never bypass Core / M-Policy locally.
- stale-map fail-closed is mandatory; the agent must not continue forwarding traffic with a stale map under any circumstance.

---

## 17. Done Criteria

- the agent can join for the first time with a Join Ticket.
- the agent can resume with a runtime token.
- the agent can send heartbeats and be recognized as `healthy` / `reachable`.
- the agent can forward logs.
- the agent can execute noop tasks and return results.
- the agent can pull and apply a signed network map.
- the agent can configure WireGuard interfaces and peers from a network map.
- the agent can start, health-check, and stop the wstunnel relay sidecar.
- the agent can provision and renew ACME TLS certificates.
- the agent enters stale-map fail-closed when the map TTL expires.
- the agent handles partition state correctly (block data-plane, continue control-plane).
- heartbeat loss or disconnect moves the node to `offline` / `unreachable`.
- runtime tokens and private keys never appear in logs, stderr, or stdout.
- session-superseded behavior is covered by tests.
- service definition is versioned.
- contracts, permissions, dependencies, health, lifecycle, and logs are declared.
- failure behavior is documented and tested.
