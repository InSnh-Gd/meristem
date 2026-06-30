# Operations Runbook

> This runbook defines the minimum operational expectations before and during v0.1 implementation.

---

## 1. Local Dependencies

| Dependency | Required In v0 | Purpose |
|------------|----------------|---------|
| Bun | yes | TypeScript runtime, package manager, script runner, and test runner |
| PostgreSQL | yes for MVP | authoritative state |
| NATS | yes for MVP | M-EventBus |
| OpenSearch | no until OpenSearch read model | read model and log search |
| Redis / KeyDB | no | optional cache fallback |
| APISIX | no | optional gateway |

---

## 2. Expected Commands

MVP uses Bun-only for package management, scripts, test execution, and local service processes. PostgreSQL and NATS run through Docker Compose.

Node.js is not part of the supported local toolchain for this repository. Local commands, service runners, and remote validation steps must execute with Bun or shell tooling.

```bash
bun install
docker compose up -d postgres nats
# optionally start OpenSearch for log search
# docker compose --profile opensearch up -d opensearch
# optional deployment pack profiles
# docker compose --profile redis up -d redis
# docker compose --profile apisix up -d apisix
bun run db:migrate
bun run db:seed
bun run lint
bun run typecheck
bun run test
bun run test:contracts
bun run test:failure-modes
bun run test:integration
bun run test:e2e
bun run workspace-hygiene
bun run skill-hygiene
bun run dev:core
bun run dev:webui
bun run dev:full
```

Development process groups:

- `bun run dev:core` - starts Docker Compose PostgreSQL + NATS, runs cert generation + migrations + seed data, then launches the full backend control-plane process group.
- `bun run dev:webui` - starts only `m-ui-bff` + `m-ui`; use it when the backend is already running elsewhere.
- `bun run dev:full` - starts infra prep + backend control plane + `m-ui-bff` + `m-ui` in one command.
- `bun run dev:backend` and `bun run dev:all` are compatibility aliases for the backend-only process group.

MVP demo command sequence:

```bash
export MERISTEM_TOKEN="$(bun run token:mint --actor operator)"
bun run scripts/certs-dev.ts
bun run meristem status
bun run meristem node register --kind stem --name local-stem
bun run meristem node register --kind leaf --name local-leaf
bun run meristem node ticket create --kind leaf --name remote-leaf
bun run meristem network create --name lab-mesh
bun run meristem network join --network <network-id> --node <stem-node-id>
bun run meristem network members --network <network-id>
bun run meristem node list
bun run meristem node-agent status
bun run meristem task submit --node <leaf-node-id> --type noop
bun run meristem task status <task-id>
bun run meristem task cancel <queued-task-id>
bun run meristem task retry <task-id>
bun run meristem log timeline
MERISTEM_TOKEN="$(bun run token:mint --actor security-admin)" bun run meristem audit list
```

---

## 3. Ports

| Service | Port | Notes |
|---------|------|-------|
| Core API | `3000` | REST + OpenAPI |
| M-Policy | `3101` | loopback HTTP + Eden + internal token |
| M-Log | `3102` | loopback HTTP + Eden + internal token |
| M-EventBus | `3103` | loopback HTTP + Eden + internal token; publishes to NATS |
| M-Net internal | `3104` | loopback HTTP health/ready + `/internal/v0/*` |
| M-Task | `3105` | canonical M-Task API `/api/v0/tasks` |
| M-Extension | `3106` | M-Extension control-plane API |
| M-Net fallback relay | `443` | public WSS endpoint for pinned `wstunnel` UDP-over-WSS fallback to local WireGuard `51820`（ADR-N03 旧版路径） |
| M-Net join ingress | `8443` | public TLS + WebSocket join entrypoint |
| NetBird Signal | managed externally | NetBird 信令服务（NixOS/systemd 管理，v0.2 基础设施依赖，ADR-N04） |
| NetBird Relay/STUN | managed externally | NetBird 中继与 NAT 穿透服务（NixOS/systemd 管理，v0.2 基础设施依赖，ADR-N04） |
| M-UI | `5173` or framework default | SvelteKit dev server |
| M-UI BFF | `3200` | UI-facing BFF dev server |
| NATS TCP | `4222` | server-side listen port; not the default Bun client transport |
| NATS WebSocket | `4223` | private Bun transport for internal services only |
| PostgreSQL | `55432` host -> `5432` container | local write model; avoids common host PostgreSQL conflicts |
| OpenSearch | `9200` | optional read-model service |
| Redis | `6379` | optional cache candidate only |
| APISIX | `9080` | optional edge gateway example |

Ports are provisional until the project scaffold defines them.

Public exposure rule:

- public deployment exposes `8443` for join ingress and `443` for the fallback relay when the relay sidecar is enabled (ADR-N03 旧版路径)
- NetBird Signal and Relay/STUN ports managed per upstream NetBird defaults by NixOS/systemd (ADR-N04 v0.2 基础设施依赖)
- `3000`, `3101`, `3102`, `3103`, `3104`, `3105`, `3106`, PostgreSQL, NATS, OpenSearch, and Redis stay private or loopback-only unless an explicit local optional profile documents otherwise
- exposing `3000 + 4223` for remote validation is now a development exception, not the target topology
- APISIX profile may expose only explicit external-route allowlists from `ops/apisix/apisix.yaml`; it must not expose `/internal/v0/*`

---

## 4. MVP Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `MERISTEM_CORE_URL` | CLI target Core URL | `http://localhost:3000` |
| `MERISTEM_TASK_URL` | BFF target M-Task URL | `http://127.0.0.1:3105` |
| `MERISTEM_EXTENSION_URL` | CLI target M-Extension URL | `http://127.0.0.1:3106` |
| `MERISTEM_TOKEN` | CLI bearer token | none |
| `MERISTEM_JOIN_PUBLIC_URL` | public join ingress base URL used by Core ticket issuance | `https://localhost:8443` |
| `MERISTEM_JOIN_INGRESS_PORT` | public M-Net join ingress port | `8443` |
| `MERISTEM_JOIN_TLS_CERT_FILE` | join ingress TLS certificate path | `.local/certs/join-ingress-cert.pem` |
| `MERISTEM_JOIN_TLS_KEY_FILE` | join ingress TLS key path | `.local/certs/join-ingress-key.pem` |
| `MERISTEM_JOIN_URL` | node-agent WebSocket join URL | `wss://localhost:8443/join/v0/session` |
| `MERISTEM_JOIN_TICKET` | node-agent first-join ticket | none |
| `MERISTEM_JWT_SECRET` | local HS256 JWT secret | none |
| `MERISTEM_INTERNAL_TOKEN` | loopback-only internal service token | none |
| `MERISTEM_OTEL_EXPORTER` | local OpenTelemetry exporter mode | `console` |
| `DATABASE_URL` | PostgreSQL connection | `postgres://meristem:meristem@localhost:55432/meristem` |
| `NATS_URL` | NATS WebSocket connection for internal services | `ws://localhost:4223` |
| `MERISTEM_LOG_LEVEL` | Core log level | `info` |
| `MERISTEM_NODE_ID` | node-agent target node ID for `session.resume` | none |
| `MERISTEM_NODE_TOKEN` | node-agent runtime token used only by `session.resume` | none |
| `MERISTEM_AGENT_VERSION` | node-agent reported version | `0.1.0` |
| `MERISTEM_AGENT_HEARTBEAT_INTERVAL_MS` | node-agent heartbeat interval | `5000` |
| `MERISTEM_AGENT_HEARTBEAT_TIMEOUT_MS` | M-Net offline timeout | `15000` |
| `MERISTEM_MNET_CONTROL_URL` | node-agent M-Net control plane URL | derived from join URL host on port `3104` |
| `MERISTEM_NODE_AGENT_FORCE_RELAY` | force node-agent WireGuard peers to the declared local wstunnel UDP sidecar endpoint when direct UDP is blocked | `false` |
| `MERISTEM_MNET_NETWORK_MAP_STALE_TTL_MS` | node-agent stale map TTL (ms) | `900000` |
| `MERISTEM_WG_BINARY_PATH` | WireGuard binary path | `wg` (PATH lookup) |
| `MERISTEM_WSTUNNEL_BINARY_PATH` | wstunnel binary path | `wstunnel` (PATH lookup) |
| `MERISTEM_WSTUNNEL_LOCAL_ENDPOINT` | node-agent local UDP sidecar endpoint used for forced relay WireGuard peers | `127.0.0.1:51821` |
| `MERISTEM_ACME_DIRECTORY` | ACME directory URL | Let's Encrypt production directory |
| `MERISTEM_ACME_ACCOUNT_KEY` | ACME account key (secret, host-local) | `/etc/meristem/node-agent/tls/account.key` in the NixOS/systemd node-agent path |
| `MERISTEM_HOST_PRIVATE_KEY_PATH` | host WireGuard private key path (secret, host-local only) | `/etc/meristem/node-agent/wg/private.key` in the NixOS/systemd node-agent path |
| `MERISTEM_RELAY_ENDPOINT` | wstunnel relay endpoint for fallback | none |
| `MERISTEM_RELAY_PUBLIC_HOSTNAME` | public fallback relay hostname | `localhost` in local development |
| `MERISTEM_RELAY_PUBLIC_PORT` | public fallback relay port | `443` |
| `MERISTEM_RELAY_PATH_PREFIX` | relay upgrade-path prefix | `meristem-fallback-relay` |
| `MERISTEM_RELAY_HEALTH_URL` | relay loopback health probe | `http://127.0.0.1:19090/health` |
| `MERISTEM_WSTUNNEL_VERSION` | pinned upstream relay release | `v10.5.5` |
| `MERISTEM_MNET_MAP_SIGNING_KEY_ID` | M-Net 网络映射签名密钥标识符 | — |
| `MERISTEM_MNET_MAP_SIGNING_PRIVATE_KEY_PEM` | M-Net PEM 格式内联签名私钥（与 FILE 二选一） | — |
| `MERISTEM_MNET_MAP_SIGNING_PRIVATE_KEY_FILE` | M-Net 文件路径方式加载签名私钥（生产推荐，避免多行 PEM 在 env 中截断） | — |
| `MERISTEM_MNET_MAP_SIGNING_PUBLIC_KEY` | M-Net 签名公钥（未设置时从私钥派生） | — |
| `MERISTEM_WG_INTERFACE_NAME` | node-agent WireGuard 接口名 | `meristem-wg0` |
| `MERISTEM_WG_LISTEN_PORT` | node-agent WireGuard 监听端口 | `51820` |
| `MERISTEM_WG_CONFIG_PATH` | node-agent WireGuard 配置文件路径 | `/run/meristem/wg0.conf` |
| `MERISTEM_WG_STATE_PATH` | node-agent WireGuard 状态文件路径 | `/run/meristem/wg0.state` |
| `MERISTEM_IP_BINARY_PATH` | node-agent ip 二进制路径 | `ip` |
| `MERISTEM_NODE_RUNTIME_STATE_PATH` | node-agent 运行时状态文件路径（nodeId + runtimeToken 持久化） | `/var/lib/meristem/node-agent/runtime.json` |
| `MERISTEM_NODE_RUNTIME_SYNC_INTERVAL_MS` | node-agent 运行时同步间隔 | `30000` |

MVP uses locally signed HS256 JWTs. The token subject is the actor ID literal from the local seed set (`viewer`, `operator`, `admin`, `security-admin`). Roles and permissions are never trusted from token claims; M-Policy reads them from PostgreSQL.

---

## 5. Incident Response Baseline

| Symptom | First Check | Expected Safe Behavior |
|---------|-------------|------------------------|
| Core degraded | Core health, dependency health | block high-risk operations only |
| Audit unavailable | M-Log health | block high-risk and privileged operations |
| Policy unavailable | M-Policy health | fail closed for protected operations |
| NATS unavailable | M-EventBus health | degrade event-dependent capabilities |
| OpenSearch unavailable | read model health | writes continue; queries degrade |
| Redis unavailable | optional cache candidate health | no current runtime impact; future adapter must define fallback or fail-closed behavior |
| APISIX unavailable | optional edge path | direct Bun dev routes remain available |
| Leaf Node abnormal | node status, recent Audit / Full Log | revoke or shrink permissions |

## 节点管理控制

操作者可通过 Core REST API 或 M-CLI 对节点执行行政控制操作。

### 禁用节点

```bash
curl -X POST -H "Authorization: Bearer $MERISTEM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"disable","reason":"maintenance window"}' \
  http://localhost:3000/api/v0/nodes/<node-id>/control
```

禁用后节点状态变为 `disabled`，heartbeat 被抑制，节点从 peer path 中排除。

### 隔离节点

```bash
curl -X POST -H "Authorization: Bearer $MERISTEM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"isolate","reason":"security incident"}' \
  http://localhost:3000/api/v0/nodes/<node-id>/control
```

隔离后节点状态变为 `isolated`，与禁用类似但用于安全事件场景。

### 恢复节点

```bash
curl -X POST -H "Authorization: Bearer $MERISTEM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"recover","reason":"issue resolved"}' \
  http://localhost:3000/api/v0/nodes/<node-id>/control
```

恢复后节点状态变为 `recovering`，等待下一次有效 heartbeat 后自动回到 `healthy` 或 `degraded`。

### 角色切换

```bash
curl -X POST -H "Authorization: Bearer $MERISTEM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"switch-role","reason":"promote to stem","targetKind":"stem"}' \
  http://localhost:3000/api/v0/nodes/<node-id>/control
```

切换节点角色（stem ↔ leaf）。最后一个 stem 节点不允许降级为 leaf。此操作需要 `admin` 或 `security-admin` 权限。

## 运行时令牌轮换

### 签发/轮换运行时令牌

```bash
curl -X POST -H "Authorization: Bearer $MERISTEM_TOKEN" \
  http://localhost:3000/api/v0/nodes/<node-id>/credentials
```

返回一次性明文令牌。重新签发会自动撤销之前的活跃令牌。

### 撤销运行时令牌

```bash
curl -X POST -H "Authorization: Bearer $MERISTEM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"credentialAction":"revoke"}' \
  http://localhost:3000/api/v0/nodes/<node-id>/credentials/revoke
```

撤销后节点 agent 需要重新注册或手动配置新令牌才能恢复通信。

## 节点代理生命周期管理

```bash
# 安装节点代理（生成本地配置和密钥）
bun run meristem node-agent install --kind stem --name my-stem

# 升级节点代理（可选轮换密钥）
bun run meristem node-agent upgrade --rotate-wireguard-key

# 卸载节点代理（默认保留密钥，--purge-secrets 清除全部）
bun run meristem node-agent uninstall --purge-secrets
```

---

## 5.1 M-Net Profile Runtime Behavior

### `controlPlaneOnly` Behavior

`m-net-cn@0.1.x` profiles carry `controlPlaneOnly: true`. This means:

- enabling the `0.1.x` CN profile changes control-plane state only (profile transitions, events, audit entries).
- no runtime transport paths are activated or mutated.
- the data-plane feature gate defaults to OFF.
- even with the gate on, no real transport is exposed (skeleton returns noop status).
- operators should not expect network routing changes when enabling `0.1.x` CN profile.

### Legacy Data-Plane Path (`m-net-cn@0.2.0`, ADR-N03)

For `m-net-cn@0.2.0`, `controlPlaneOnly` is false. This enables the incremental data-plane track (ADR-N03) using WireGuard + wstunnel relay sidecars where that path has been deployed and verified. **This is the legacy path superseded by ADR-N04 for v0.2 NetBird direction.** Operators should require current evidence for host-level interface orchestration and traffic routing before treating a deployment as production-ready.

### v0.2 NetBird Direction (`m-net@0.3.0`, `m-net-cn@0.3.0`, ADR-N04)

v0.2 data-plane direction (ADR-N04): NetBird client sidecar + NetBird Signal + NetBird Relay/STUN. NetBird Management excluded. Viability gate: `bun run mnet:v02:sidecar-proof`. No wstunnel mixed/fallback mode in v0.2. Legacy wstunnel path retained for migration window only.

---

## 6. Observability Baseline

Each request or command should carry:

- `correlationId`
- `traceId` from the active OpenTelemetry span
- actor
- action
- resource
- node scope
- service scope

OpenTelemetry is the trace / metric / log collection layer. M-Log is Meristem's timeline, full log, audit, and analysis layer.

MVP internal startup order:

1. `docker compose up -d postgres nats
# optionally start OpenSearch for log search
# docker compose --profile opensearch up -d opensearch`
2. `bun run db:migrate && bun run db:seed`
3. `export MERISTEM_INTERNAL_TOKEN=change-me-internal-shared-token`
4. `bun run dev:core` for backend-only development, or `bun run dev:full` when the Web UI should come up with the backend.
5. Real node-agent runtime through the public join ingress:

```bash
export MERISTEM_TOKEN="$(bun run token:mint --actor operator)"
bun run meristem node ticket create --kind leaf --name remote-leaf
export MERISTEM_JOIN_TICKET=<ticket-from-command-output>
bun run dev:node-agent
```

Compatibility note:

- `MERISTEM_NODE_ID` + `MERISTEM_NODE_TOKEN` remain available for `session.resume` and operator recovery flows.
- `meristem node issue-token` is no longer the primary public join flow.

---

## 6.1 First Multi-Host Harness

The first topology keeps all capability domain services on the local control host and isolates only the two Leaf hosts with Docker bridge networking. This proves distinct leaf networking without claiming split capability domain runtime support.

Local limitation summary:

- the control host still runs on the local machine because internal M-* URLs remain loopback-oriented.
- the relay uses local port `18443` instead of privileged `443` so the harness can run without `CAP_NET_BIND_SERVICE`.
- the harness refuses to start unless the host already exposes `wg`, `CAP_NET_ADMIN`, the visible WireGuard kernel module, `wstunnel`, Docker, and the cached `oven/bun:1` image.

Exact commands:

```bash
bun run mnet:harness:preflight
bun run mnet:harness:start
bun run mnet:harness:status
bun run mnet:harness:stop
bun run mnet:harness:reset
```

Expected preflight checks:

- `wg --version` succeeds.
- `/sys/module/wireguard` exists.
- the current shell carries `CAP_NET_ADMIN`.
- `wstunnel --version` succeeds.
- Docker can start a bridge-networked Bun container that reaches `host.docker.internal`.

Commands for this topology:

```bash
mnet-harness preflight
mnet-harness start
mnet-harness status
mnet-harness stop
mnet-harness reset
```

The harness writes live logs under `.local/mnet-multihost/logs/` and returns those paths through `mnet-harness status`.
`reset` now performs strong orphan cleanup, so a failed `start` should no longer require manual port cleanup before the next run.

For a Chinese operator-oriented step-by-step validation guide, see [`M-NET-THREE-NODE-VALIDATION.md`](./M-NET-THREE-NODE-VALIDATION.md).

Leaf host runtime shape:

- control host: local Bun processes for `m-eventbus`, `m-policy`, `m-log`, `m-net`, `m-task`, `m-extension`, `core`, plus the co-located relay wrapper.
- leaf hosts: `oven/bun:1` containers that run `bun run services/node-agent/src/index.ts` with Join Ticket env injected at start; the current proven topology is `1 stem + 1 leaf`.
- control-plane Join URL inside leaf containers: `wss://host.docker.internal:8443/join/v0/session`.
- relay endpoint inside leaf containers: `wss://host.docker.internal:18443`.
- harness now injects an explicit `MERISTEM_MNET_CONTROL_URL=http://host.docker.internal:3104`, host `ip/wg/wstunnel` tool mounts, and a local `wstunnel client`, so node-agent runtime sync can complete inside the leaf containers.

Current proof boundary:

- automated E2E covers signed map publication, noop management dispatch, stale-map fail-closed, and invalid target rejection
- the latest operator proof also verified in-tunnel overlay traffic for the first `1 stem + 1 leaf` topology
- this is evidence that the first harness topology can exercise a real overlay path, but it is not a blanket production-readiness claim for all relay, recovery, or N-host scenarios

---

## 7. Relay ACME Certificate Management

The wstunnel relay sidecar terminates TLS at WSS/443 using certificates provisioned through ACME (Let's Encrypt). The node-agent owns certificate lifecycle: issuance, renewal, and failure handling. See `docs/services/node-agent.md` §7 for the authoritative ACME trust specification.

The first production topology keeps a co-located relay on the control-plane host with the following pinned deployment contract:

| Concern | Value |
|--------|-------|
| systemd unit | `meristem-wstunnel-relay.service` |
| pinned version | `v10.5.5` |
| binary source | `https://github.com/erebe/wstunnel/releases/download/v10.5.5/wstunnel_10.5.5_linux_amd64.tar.gz` |
| container reference | `ghcr.io/erebe/wstunnel:v10.5.5` |
| config directory | `/etc/meristem/wstunnel/` |
| restrictions file | `/etc/meristem/wstunnel/restrictions.yaml` |
| readiness probe | `GET http://127.0.0.1:19090/health` |
| local target | `localhost:51820` |

Pinned relay command:

```bash
wstunnel server wss://[::]:443 \
  --restrict-to localhost:51820 \
  --restrict-config /etc/meristem/wstunnel/restrictions.yaml \
  --restrict-http-upgrade-path-prefix meristem-fallback-relay \
  --tls-certificate /etc/meristem/wstunnel/tls/fullchain.pem \
  --tls-private-key /etc/meristem/wstunnel/tls/key.pem \
  --log-lvl INFO \
  --no-color
```

Relay logging contract:

- write structured JSON lines to the systemd journal
- include `service`, `source`, `version`, `endpoint`, `healthUrl`, `mode`, and `message`
- do not log `MERISTEM_INTERNAL_TOKEN`, private keys, or ACME account material

### 7.1 ACME Certificate Issuance

Certificates are obtained from the Let's Encrypt production directory by default, configurable via `MERISTEM_ACME_DIRECTORY`.

| Aspect | Detail |
|--------|--------|
| ACME directory URL | Let's Encrypt production (`https://acme-v02.api.letsencrypt.org/directory`) or value of `MERISTEM_ACME_DIRECTORY` |
| Challenge type | HTTP-01 or DNS-01 (selected by configuration) |
| Account key | Stored at `MERISTEM_ACME_ACCOUNT_KEY` (PEM format, host-local, never transmitted) |
| Certificate storage | `/var/lib/meristem/certs/` on the host |
| Private key permissions | `0400` |
| Certificate file permissions | `0600` |

First-time provisioning flow:

1. The node-agent reads `MERISTEM_ACME_DIRECTORY` and `MERISTEM_ACME_ACCOUNT_KEY`.
2. If no account key exists, the agent generates one and stores it at the configured path.
3. The agent requests a certificate for the relay endpoint hostname.
4. The ACME challenge is completed (HTTP-01 or DNS-01).
5. The issued certificate and private key are written to `/var/lib/meristem/certs/`.
6. The wstunnel sidecar is started with the new certificate.

On first-time provisioning failure, wstunnel starts without TLS and the node-agent reports degraded status. See §7.3 for failure handling.

### 7.2 ACME Certificate Renewal

Renewal is automatic. The node-agent monitors certificate lifetime and renews before expiry.

| Aspect | Detail |
|--------|--------|
| Renewal window | 30 days before expiration |
| Renewal check interval | On startup and periodically thereafter |
| Renewal hook | After successful renewal, the agent reloads the wstunnel sidecar with the new certificate |
| Post-renewal behavior | Wstunnel restarts with the new certificate; existing relay connections are gracefully migrated |

Monitoring alerts for certificate expiry:

- The node-agent reports certificate lifetime in heartbeat frames (`certificateExpiresAt` field).
- Operators should configure alerting when the certificate lifetime drops below 14 days.
- A warning log entry is emitted at 30 days remaining.
- An error log entry is emitted at 7 days remaining when renewal has not succeeded.

### 7.3 ACME Certificate Failure

When ACME provisioning or renewal fails, the system follows a defined fallback path.

| Failure scenario | Behavior | Operator action |
|------------------|----------|-----------------|
| First-time issuance fails | Wstunnel starts without TLS; relay-only degraded mode; agent reports degraded through heartbeats | Check DNS resolution of the ACME directory; verify the challenge endpoint is reachable; verify `MERISTEM_ACME_ACCOUNT_KEY` path is writable |
| Renewal fails before expiry | Existing certificate continues to be used; agent logs a warning and retries with exponential backoff (1m, 2m, 4m, 8m) | Investigate ACME directory reachability; check that the challenge method is still valid |
| Certificate expires without renewal | Wstunnel relay becomes unavailable; agents fall back to direct WireGuard peering; relay-only degraded mode | Immediate manual intervention: provision a certificate manually or point to a staging ACME directory, then restart the node-agent |
| ACME directory unreachable | Agent logs an error and retries every 10 minutes | Verify outbound connectivity to the ACME directory on port 443; verify system trust store is current |

Manual certificate provisioning (emergency fallback):

```bash
# Place a manually obtained certificate and key in the cert directory
sudo mkdir -p /var/lib/meristem/certs
sudo cp <manual-cert.pem> /var/lib/meristem/certs/relay-cert.pem
sudo cp <manual-key.pem> /var/lib/meristem/certs/relay-key.pem
sudo chmod 0600 /var/lib/meristem/certs/relay-cert.pem
sudo chmod 0400 /var/lib/meristem/certs/relay-key.pem
sudo systemctl restart meristem-node-agent
```

### 7.4 Relay Health Check

The relay wstunnel sidecar is a separate process managed by the node-agent. Its health is monitored through multiple mechanisms.

**Process-level health check:**

```bash
# Verify wstunnel process is running
systemctl status meristem-node-agent
# Check wstunnel output in journal
journalctl -u meristem-node-agent -f | grep wstunnel
```

**Local HTTP health probe (when enabled):**

The node-agent may expose a local HTTP health endpoint on `127.0.0.1:9090` for systemd health checks and operator diagnostics.

```bash
# Check node-agent composite health
curl -s http://127.0.0.1:9090/health | jq .
# Expected fields: liveness, readiness, sidecar (wstunnel status), wireguard
```

**Logs to check for relay health:**

| Log pattern | Meaning | Action |
|-------------|---------|--------|
| `wstunnel started` | Sidecar started successfully | Normal operation |
| `wstunnel health check passed` | Periodic health check succeeded | Normal operation |
| `wstunnel restart attempt` | Sidecar crashed and is being restarted | Monitor restart count; if persistent, check wstunnel binary and config |
| `wstunnel restart exhausted` | Maximum retries reached, sidecar failed permanently | Check wstunnel binary path, permissions, and relay endpoint reachability |
| `relay-only degraded mode entered` | Wstunnel is running but WireGuard is not configured | Wait for fresh network map |
| `ACME renewal failed` | Certificate renewal attempt failed | Check ACME directory connectivity and challenge validity |
| `certificate expires in` | Certificate lifetime warning | Verify renewal is functioning; prepare manual intervention if expiry is imminent |

**Relay endpoint verification:**

```bash
# Test WSS connectivity from a leaf node
curl -v --http1.1 -H "Upgrade: websocket" -H "Connection: Upgrade" \
  https://<relay-endpoint>:443/
# Expected: HTTP 101 Switching Protocols or wstunnel handshake response
```

---

Optional deployment pack:

- detailed profile commands and failure behavior live in `docs/operations/OPTIONAL-DEPLOYMENT-PACK.md`.
- APISIX, Redis, and OpenSearch profiles are optional and must not become test or local development prerequisites.
- `ops/compose/full-stack.example.yml` is topology documentation, not a production deployment or CI gate.
