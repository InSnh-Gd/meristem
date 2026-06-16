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

- public deployment exposes only `8443`
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

Optional deployment pack:

- detailed profile commands and failure behavior live in `docs/operations/OPTIONAL-DEPLOYMENT-PACK.md`.
- APISIX, Redis, and OpenSearch profiles are optional and must not become test or local development prerequisites.
- `ops/compose/full-stack.example.yml` is topology documentation, not a production deployment or CI gate.
