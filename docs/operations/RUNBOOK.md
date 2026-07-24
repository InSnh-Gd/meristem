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

OCI build/promotion validation is documented in [`OCI-PIPELINE.md`](./OCI-PIPELINE.md). The static gate validates every target without registry access:

```bash
bun run oci:preflight
bun run oci:build --target=m-ui --dry-run
```

### Docker Compose Compatibility Gate

Docker Compose is a compatibility-only renderer for the versioned M-Deploy desired-state subset. It is useful for local migration checks and manifest portability, but it is not a production deployment path or an HA/security readiness signal.

```bash
# Render and validate the generated Compose manifest. `config --quiet` needs the
# Docker Compose CLI but does not contact the Docker daemon.
bun test tests/integration/docker-compose-compat-proof.test.ts

# Opt into a local runtime smoke only when the Docker daemon and a local,
# digest-pinned alpine image are available.
MERISTEM_MDEPLOY_DOCKER_COMPOSE_PROOF=1 \
  bun test tests/integration/docker-compose-compat-proof.test.ts
```

The Compose proof must remain separate from the Podman/systemd production gate. In particular, Docker Compose does **not** provide:

- systemd supervision, user-unit ordering, or the rootless `meristem.target` lifecycle;
- Podman Quadlet generation, installation, reload, or unit-manager drift checks;
- M-Deploy-controlled rollback, signature/policy/Audit orchestration, or recovery by itself;
- production runtime-health integration or the Podman full-HA/no-gap replacement proof; or
- restart semantics equivalent to the systemd-managed production runtime.

A failed or skipped Docker compatibility proof must not block Podman production readiness; conversely, a passing Compose proof must never be used to claim Podman/systemd parity.

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

### Closed-Loop Failure and Recovery Semantics

- Join approval and explicit rejection, credential issue/rotate/revoke, relay policy, profile migration/rollback, and break-glass operations require service-side M-Policy plus M-Log Audit before authoritative mutation. UI command eligibility never substitutes for these checks.
- A policy denial returns a typed denied outcome with no authoritative state change. Explicit join rejection is a separately authorized action and leaves no credential.
- Successful mutation responses include `publication.status`. `pending` means PostgreSQL committed the fact and durable event intent but M-EventBus delivery is waiting for the startup retry sweep; do not repeat the control command solely because publication is pending.
- If PostgreSQL fact decoding fails, treat M-Net as degraded and repair the corrupt row from a trusted backup or replay source. The service does not silently treat corrupt payloads as missing.
- Credential and profile-migration failures report whether compensation completed or manual intervention is required. When manual intervention is required, inspect SecretProvider/profile runtime state before retrying; never paste secret material into logs or commands.
- Break-glass activation requires `security-admin` initiation and an independent `break-glass-reviewer`. The grant is effective only until the exact `expiresAt = initiatedAt + 30 minutes`; access checks fail closed at that instant, and the background sweep persists `auto-revoked` state.
- Tunnel health can be reported only through the node runtime-token route. Bearer-authenticated operator routes are read-only for this fact, and NetBird Management/Dashboard must not be introduced as an alternate authority.

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

## 8. Production Bootstrap and Disaster Recovery Trust Chain

> 本节定义 post-v0.1 生产轨道的 bootstrap / disaster-recovery 顺序。它是运维契约，不授权把 secret、unseal key、root token 或 live credential 写入仓库、测试夹具、日志、evidence、OpenSearch 投影或 desired-state Git 内容。

### 8.1 Bootstrap Trust Chain

生产 bootstrap 必须按以下顺序执行，不能跳过前置 trust step：

1. **Offline root CA / root-of-trust ceremony**：root key material 由两名以上 security-admin 共同保管，离线介质分离存放；仓库只记录 custody policy、key ID、ceremony evidence digest，不保存私钥、unseal key、root token 或 live credential。
2. **Internal PKI issuance**：从 offline root 签发 intermediate CA；intermediate CA 再签发 service certificate、mTLS certificate、M-Deploy controller / agent identity certificate。Root CA 不直接签发运行时服务证书。
3. **Vault HA initialization**：默认使用 Vault Integrated Storage / Raft，3 个 control/state VM 组成 HA 集群。provider-neutral libvirt validation fixture 使用人工 Shamir unseal ceremony；除非同一变更明确引入 self-hosted auto-unseal 机制，否则不得要求 cloud KMS。
4. **Vault key shard custody**：Shamir unseal shard 分给不同 security-admin 保管；任一个人不得同时持有 quorum 所需全部 shard。unseal 过程只在受控终端执行，证据记录只包含参与人、时间、key ID、result 和 correlationId。
5. **Secret-zero handoff**：Vault root token 只用于初始化 policy、AppRole / workload identity 和最小 SecretProvider bootstrap credential；完成后撤销或封存 root token。root token、AppRole secret、initial credential 不进入 env file、Git、测试夹具或 operator runbook 示例。
6. **First M-Deploy controller enrollment**：controller 使用内部 PKI 身份、签名 key 和只读 Git access enroll。controller 必须能验证 desired-state envelope，且不得拥有 M-Policy 授权决策权。
7. **First M-Deploy agent enrollment**：agent 通过 controller trust bundle、agent identity certificate 和 runtime driver config enroll；agent enrollment 写 Audit，且 agent 只接受 controller 签名的 desired-state apply 请求。
8. **Git desired-state verification**：M-Deploy 拉取 Git desired-state 后验证 signed envelope、commit digest pin 和 rollback pointer；签名或 digest 验证失败阻塞 reconcile，并写 Audit。
9. **Registry trust**：部署镜像必须通过 image signing verification 与 digest pinning；禁止只按 mutable tag 部署生产 workload。
10. **PostgreSQL restore**：灾备恢复先恢复 PostgreSQL authoritative state，包括 identity、policy、node、config、secretRef metadata、deployment metadata、audit metadata 和 evidence metadata。
11. **Vault restore**：PostgreSQL authority 可读后恢复 Vault Raft snapshot / secret values，并核对 secretRef metadata 与 Vault key path / version 对齐。
12. **OpenSearch restore**：OpenSearch 是 projection / auxiliary system，不能先于 PostgreSQL 成为事实源；优先从 snapshot 恢复，再由 PostgreSQL / M-Log / projector cursor rebuild projection。
13. **Keycloak restore**：Keycloak 恢复 OIDC provider config；client secrets、JWKS material 和 provider credentials 从 Vault 重新加载。Keycloak 不拥有 Meristem 授权根。
14. **NATS restore**：NATS / JetStream 恢复后，从 PostgreSQL event store / authoritative transition tables replay 必需 stream；事件状态不得覆盖 PostgreSQL authority。

### 8.2 Disaster-Recovery Restore Order

DR 恢复顺序固定为：

```text
root-of-trust custody check
→ internal PKI / trust bundle verification
→ Vault unseal / Raft recovery
→ PostgreSQL PITR / authority restore
→ Vault secret restore and SecretRef reconciliation
→ Keycloak OIDC restore and Vault secret reload
→ NATS / JetStream recovery and event replay
→ M-Deploy controller and agent reconnect
→ Git desired-state verification
→ registry signature / digest verification
→ OpenSearch snapshot restore and projection rebuild
→ M-UI / BFF degraded state clearance
```

Restore must not allow break-glass to bypass Audit. If Audit metadata is unavailable, high-risk control operations stay blocked until PostgreSQL authority and M-Log audit writes recover.

### 8.3 RPO / RTO Ownership

Overall production target is RPO 15m / RTO 1h, decomposed by subsystem:

| Subsystem | RPO | RTO | Responsibility | Restore Source |
|---|---:|---:|---|---|
| PostgreSQL | 15m | 30m | authoritative state, audit/evidence metadata, policy and identity records | WAL archive + PITR backup |
| Vault | 0 | 15m | secret values and SecretProvider backend | Raft integrated storage + unseal ceremony / Raft recovery |
| NATS / JetStream | 0 | 15m | event streams and replay transport | replicated JetStream + PostgreSQL event store replay |
| Redis | best-effort cache | 15m | optional cache only; no authority | cold restart or cache rebuild |
| OpenSearch | 1h | 2h | search projection and log query acceleration; degradable | snapshot + PostgreSQL / M-Log projection rebuild |
| Keycloak | 15m | 30m | OIDC authentication provider config only | DB backup + Vault secret reload |
| M-Deploy desired-state | 0 | 15m | Git desired-state source and reconcile pointer | Git re-clone + signed envelope verification + agent reconnect |
| Audit / evidence | 0 | 30m | non-bypassable audit metadata and raw evidence pointer | PostgreSQL synchronous write + immutable evidence archive |

Redis 只能承载 cache / lock / session-like ephemeral data；任何需要 RPO 语义的状态不得只保存在 Redis。

### 8.4 Minimum Viable Operating Mode

在 IdP、Vault 或 M-Net degraded 时，系统进入 minimum viable operating mode，而不是静默恢复完整功能：

| Failure Scenario | Minimum Mode | Required Guardrail |
|---|---|---|
| IdP unavailable | 使用 local IAM + M-Policy 的 break-glass token；TTL 30 分钟；双人 approval | 不能绕过 Audit；OIDC session UX degraded；Keycloak 恢复后重新验证 session |
| Vault sealed / unavailable | 所有 secret create / rotate / read / deploy-secret 操作 fail-closed；禁止新部署 | 已运行服务可使用未过期 cached secret 到 TTL；过期缓存不得复用；不得降级到本地明文存储 |
| OpenSearch degraded | writes、policy、audit 和 control operations 继续；搜索、Dashboard、历史查询显示 degraded | OpenSearch 不得成为审计或状态 authority；恢复后从 PostgreSQL / M-Log rebuild projection |
| M-Net degraded | M-UI 显示 degraded；不允许新 node join；已有 tunnel 仅在 signed map TTL 内继续 | map 过期后 fail-closed；network profile 高风险操作仍需 M-Policy + Audit |
| M-Deploy agent disconnected | 不执行新的 desired-state apply；drift reporting 暂停；保留 last-known state | agent reconnect 后必须重新验证 controller trust、desired-state envelope 和 registry digest |
| Git desired-state unavailable | M-Deploy 使用 last successful sync snapshot 做只读展示；超过 TTL 的 snapshot 拒绝 reconcile | 不允许从 operator 手写 live state 替代 Git；恢复 Git 后重新校验 signed envelope 和 rollback pointer |

### 8.5 Credential Handling Prohibitions

- 仓库、测试夹具、fixture、example config、evidence 和 runbook 示例不得包含 secret、unseal key、Vault root token、AppRole secret、registry credential、OIDC client secret、NetBird credential 或 live node credential。
- 文档只能引用 `secretRef`、key path、key ID、digest、fingerprint 或 redacted handle。
- DR 演练 evidence 只能记录 custody event、approval、hash、correlationId、restore result 和 operator identity；不得记录 plaintext credential。
- libvirt validation fixture 默认使用人工 Shamir unseal ceremony；provider-neutral 路径不得要求 cloud KMS。

---

## 9. OpenSearch Production Contract

OpenSearch is a projection / auxiliary system for M-Log search and analysis. It is not the authority for Audit, Timeline, Full Log, policy decisions, node state, secrets, desired state, or control operations.

The versioned contract is `OpenSearchProductionContractV01Schema` (`opensearch@0.1.0`) and requires:

- secured 3-node OpenSearch cluster with TLS enabled on REST and transport traffic
- exactly one `cluster_manager`, `data`, and `ingest` node in distinct zones
- OpenSearch security plugin enabled with SecretRef-backed admin, projection-writer, and read-only credentials
- strict versioned index templates for Timeline, Full Log, and Audit projection indices, each preserving `correlationId` as a keyword filter
- aliases for read/write projection access and query projection semantics marked `authoritative: false`
- ISM rollover, retention, and snapshot-before-delete policy
- snapshot repository and restore order followed by PostgreSQL / M-Log projection rebuild
- failure behavior proving authoritative writes do not depend on OpenSearch availability

Dashboards is auxiliary ingress only. It is private or operator-VPN-only, TLS-protected, and authenticated through the OIDC/RBAC proxy. It may expose only `view-dashboard` and `query-projection`; it must not become primary M-UI, mutate control-plane state, write Audit facts, approve policy, or bypass Meristem access/audit. Unauthorized access returns `401` or `403` and must be represented in Audit through the Meristem boundary.

Failure behavior:

| Scenario | Required Behavior | Operator Signal |
|---|---|---|
| OpenSearch unavailable | authoritative PostgreSQL writes, policy checks, Audit writes, and control operations continue | `opensearch_unavailable`; search returns degraded response |
| Projection queue degraded | M-Log queues / DLQs projection work and writes Full Log degradation | `projection_queue_degraded`; projection health degraded |
| Dashboards unavailable | M-UI and Core continue; Dashboards panels unavailable | `dashboards_unavailable`; dashboard links disabled/degraded |
| Restore after snapshot | restore OpenSearch, then rebuild projections from PostgreSQL via M-Log backfill | `read_model_rebuild_required` until catch-up completes |

### 9.1 Secured Deployment Pack and Restore Drill

`ops/opensearch/compose.yaml` is the secured, Podman-first deployment pack. Docker Compose is supported for compatibility validation, but it is not a production promotion path. The pack has separate `cluster_manager`, `data`, and `ingest` nodes, requires an image that contains the version-matched OpenSearch Prometheus exporter plugin, and publishes neither the OpenSearch REST endpoint nor Dashboards directly to the host.

Before starting it, M-Deploy must materialize all listed credentials and TLS files from SecretRef into the protected runtime environment. Do not create a repository, fixture, or operator-shell env file containing those values. The required material is limited to the OpenSearch admin, projection writer, monitoring, Dashboards read-only, OIDC proxy, Grafana, and alert-webhook credentials plus the internal CA/node certificates.

```bash
# Run only from an M-Deploy-initialized shell with SecretRef material already injected.
podman compose -f ops/opensearch/compose.yaml config
podman compose -f ops/opensearch/compose.yaml up -d
bun ops/opensearch/scripts/bootstrap.ts

# Docker compatibility validation only; Podman remains the production runtime.
docker compose -f ops/opensearch/compose.yaml config
```

The bootstrapper installs strict Timeline, Full Log, and Audit templates; read/write aliases; the S3 snapshot repository; the six-hour snapshot management policy; and the snapshot-before-delete ISM policy. M-Log receives `OPENSEARCH_URL`, `OPENSEARCH_USERNAME`, and `OPENSEARCH_PASSWORD` from the same runtime secret handoff. A certificate chain issued by the internal CA must be trusted by the M-Log Bun image; certificate verification must never be disabled.

Dashboards is reachable only through the loopback-bound OIDC proxy on port `8443`. Its allowlisted OIDC groups are `meristem-operator` and `meristem-security-admin`; service-account role mappings bind the projection writer, monitoring, and Dashboards readers to the least-privilege roles installed by bootstrap. The proxy emits structured allow/deny access logs, and the deployment runtime must route those events through the `dashboards-audit-policy.json` model to M-Log's internal Audit boundary. Dashboards queries remain read-model queries only; neither the proxy nor Dashboards may write authority facts.

The restore drill is fixture-only by design. It snapshots all projection patterns, restores Timeline then Full Log then Audit under renamed fixture indices, and calls M-Log backfill for each authoritative PostgreSQL projection:

```bash
bun ops/opensearch/scripts/snapshot-restore-drill.ts --fixture
```

For a live fixture-cluster drill, set `OPENSEARCH_RESTORE_TARGET=fixture` through the protected deployment runtime. The script refuses any other target. Never run it against a production authority environment; production recovery follows §8.2 and uses the same PostgreSQL/M-Log rebuild sequence.

## 10. Observability Production Contract

The versioned contract is `ObservabilityContractV01Schema` (`observability@0.1.0`). Prometheus, Grafana, Alertmanager, OpenTelemetry, and Pino are non-authoritative observability systems. Their unavailability must be visible, but must not block authoritative writes.

Minimum required contract surface:

- Prometheus scrape targets for Core, M-EventBus, M-Log, M-Policy, and M-Deploy with explicit job names, scheme, metrics path, and interval
- Grafana read-only datasources for Prometheus and OpenSearch, with dashboard ownership recorded per dashboard
- Alertmanager route owner and minimum alert rules
- OTel collector receivers/exporters with `correlationId` propagation
- Pino JSONL operational logs with `service`, `msg`, `correlationId`, and `traceId` where available
- degraded indicators for Prometheus, Grafana, Alertmanager, and OTel collector availability

Minimum alert set:

| Alert | Owner | Severity Intent |
|---|---|---|
| `control_plane_availability` | Core | critical |
| `postgresql_lag_or_failover` | Core | critical |
| `vault_sealed_or_quorum` | Core | critical |
| `nats_health` | M-EventBus | critical |
| `opensearch_degradation` | M-Log | warning |
| `failed_audit_writes` | M-Log | critical |
| `pending_approvals_backlog` | M-Policy | warning |
| `agent_drift_or_reconcile_failure` | M-Deploy | critical |

The secured OpenSearch pack additionally provisions deployment-level `OpenSearchClusterHealth` and `OpenSearchDiskWatermark` alerts. Together with `FailedAuditWrites`, these are the minimum pack acceptance alerts. The OTel collector accepts OTLP and parses production Pino JSONL from the runtime log mount; it exposes metrics to Prometheus. Grafana only receives read-only Prometheus and OpenSearch datasources. A failure in any of these paths must surface the corresponding degradation indicator but must not block PostgreSQL, policy, or Audit writes.

Every dashboard must have an owner and must expose state sources, degradation indicators, and `correlationId` drill-down ownership alongside its degraded state. This makes a degradation understandable without relying only on color. Dashboards must show unavailable OpenSearch, Dashboards, Prometheus, Alertmanager, or OTel collector components, and dashboard queries cannot be used as authority for control decisions.

---

Optional deployment pack:

- detailed profile commands and failure behavior live in `docs/operations/OPTIONAL-DEPLOYMENT-PACK.md`.
- APISIX, Redis, and OpenSearch profiles are optional and must not become test or local development prerequisites.
- `ops/compose/full-stack.example.yml` is topology documentation, not a production deployment or CI gate.
