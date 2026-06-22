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
| M-Net fallback relay | `443` | public WSS endpoint for pinned `wstunnel` UDP-over-WSS fallback to local WireGuard `51820` |
| M-Net join ingress | `8443` | public TLS + WebSocket join entrypoint |
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

- public deployment exposes `8443` for join ingress and `443` for the fallback relay when the relay sidecar is enabled
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
| `MERISTEM_MNET_NETWORK_MAP_STALE_TTL_MS` | node-agent stale map TTL (ms) | `900000` |
| `MERISTEM_WG_BINARY_PATH` | WireGuard binary path | `wg` (PATH lookup) |
| `MERISTEM_WSTUNNEL_BINARY_PATH` | wstunnel binary path | `wstunnel` (PATH lookup) |
| `MERISTEM_ACME_DIRECTORY` | ACME directory URL | Let's Encrypt production directory |
| `MERISTEM_ACME_ACCOUNT_KEY` | ACME account key (secret, host-local) | none |
| `MERISTEM_HOST_PRIVATE_KEY_PATH` | host WireGuard private key path (secret, host-local only) | `.local/wg/private.key` |
| `MERISTEM_RELAY_ENDPOINT` | wstunnel relay endpoint for fallback | none |
| `MERISTEM_RELAY_PUBLIC_HOSTNAME` | public fallback relay hostname | `localhost` in local development |
| `MERISTEM_RELAY_PUBLIC_PORT` | public fallback relay port | `443` |
| `MERISTEM_RELAY_PATH_PREFIX` | relay upgrade-path prefix | `meristem-fallback-relay` |
| `MERISTEM_RELAY_HEALTH_URL` | relay loopback health probe | `http://127.0.0.1:19090/health` |
| `MERISTEM_WSTUNNEL_VERSION` | pinned upstream relay release | `v10.5.5` |

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

---

## 5.1 M-Net Profile controlPlaneOnly Behavior

`m-net-cn@0.1.x` profiles carry `controlPlaneOnly: true`. This means:

- enabling the `0.1.x` CN profile changes control-plane state only (profile transitions, events, audit entries).
- no runtime transport paths are activated or mutated.
- the data-plane feature gate defaults to OFF.
- even with the gate on, no real transport is exposed (skeleton returns noop status).
- operators should not expect network routing changes when enabling `0.1.x` CN profile.

For `m-net-cn@0.2.0`, `controlPlaneOnly` is false. This activates the production data-plane (ADR-N03) using WireGuard + wstunnel relay sidecars. Operators should expect actual host-level interface orchestration and network traffic routing when enabling `0.2.0`.

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

The first topology keeps all M-* services on the local control host and isolates only the two Leaf hosts with Docker bridge networking. This proves distinct leaf networking without claiming split M-* runtime support.

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
- the latest operator proof also verified in-tunnel overlay TCP from leaf `100.96.0.1` to stem `100.96.0.2`
- this is sufficient to claim the first harness topology is **real virtual networking**, not just control-plane health

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
