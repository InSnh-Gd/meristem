# Operations Runbook

> This runbook defines the minimum operational expectations before and during v0.1 implementation.

---

## 1. Local Dependencies

| Dependency | Required In v0 | Purpose |
|------------|----------------|---------|
| Bun | yes | TypeScript runtime, package manager, script runner, and test runner |
| PostgreSQL | yes for MVP | authoritative state |
| NATS | yes for MVP | M-EventBus |
| OpenSearch | no until Phase 9 | read model and log search |
| Redis / KeyDB | no | optional cache fallback |
| APISIX | no | optional gateway |

---

## 2. Expected Commands

MVP uses Bun-only for package management, scripts, test execution, and local service processes. PostgreSQL and NATS run through Docker Compose.

```bash
bun install
docker compose up -d postgres nats
bun run db:migrate
bun run db:seed
bun run lint
bun run typecheck
bun run test
bun run test:contracts
bun run test:failure-modes
bun run dev:all
```

MVP demo command sequence:

```bash
export MERISTEM_TOKEN="$(bun run token:mint --actor operator)"
bun run meristem status
bun run meristem node register --kind stem --name local-stem
bun run meristem node register --kind leaf --name local-leaf
bun run meristem network create --name lab-mesh
bun run meristem network join --network <network-id> --node <stem-node-id>
bun run meristem network members --network <network-id>
bun run meristem node list
bun run meristem task assign --leaf <leaf-node-id> --type noop
bun run meristem log timeline
MERISTEM_TOKEN="$(bun run token:mint --actor security-admin)" bun run meristem audit list
```

---

## 3. Ports

| Service | Port | Notes |
|---------|------|-------|
| Core API | `3000` | REST + OpenAPI |
| M-Net | internal process | logical network orchestration via NATS request/reply |
| M-UI | `5173` or framework default | SvelteKit dev server |
| NATS | `4222` | local event bus |
| PostgreSQL | `55432` host -> `5432` container | local write model; avoids common host PostgreSQL conflicts |
| OpenSearch | `9200` | later phase only |

Ports are provisional until the project scaffold defines them.

---

## 4. MVP Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `MERISTEM_CORE_URL` | CLI target Core URL | `http://localhost:3000` |
| `MERISTEM_TOKEN` | CLI bearer token | none |
| `MERISTEM_JWT_SECRET` | local HS256 JWT secret | none |
| `DATABASE_URL` | PostgreSQL connection | `postgres://meristem:meristem@localhost:55432/meristem` |
| `NATS_URL` | NATS connection | `nats://localhost:4222` |
| `MERISTEM_LOG_LEVEL` | Core log level | `info` |

MVP uses locally signed HS256 JWTs. The token subject is the actor ID. Roles and permissions are never trusted from token claims; M-Policy reads them from PostgreSQL.

---

## 5. Incident Response Baseline

| Symptom | First Check | Expected Safe Behavior |
|---------|-------------|------------------------|
| Core degraded | Core health, dependency health | block high-risk operations only |
| Audit unavailable | M-Log health | block high-risk and privileged operations |
| Policy unavailable | M-Policy health | fail closed for protected operations |
| NATS unavailable | M-EventBus health | degrade event-dependent capabilities |
| OpenSearch unavailable | read model health | writes continue; queries degrade |
| Leaf Node abnormal | node status, recent Audit / Full Log | revoke or shrink permissions |

---

## 6. Observability Baseline

Each request or command should carry:

- `correlationId`
- `traceId` when OpenTelemetry is available
- actor
- action
- resource
- node scope
- service scope

OpenTelemetry is the trace / metric / log collection layer. M-Log is Meristem's timeline, full log, audit, and analysis layer.
