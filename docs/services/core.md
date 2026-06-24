# Core Service Definition

## 1. Identity

| Field | Value |
|-------|-------|
| name | `meristem-core` |
| version | `0.1.0` |
| domain | `core` |
| kind | `core` |
| owner | Meristem Core maintainers |

---

## 2. Responsibility

Core owns the microkernel boundary.

What this service owns:

- bootstrap
- base configuration loading
- base identity entrypoint
- service lifecycle entrypoint
- Elysia app composition
- REST + OpenAPI
- internal Eden contract aggregation
- M-CLI entrypoint
- safety mode
- minimal log entrypoint
- minimal policy entrypoint
- secretRef management entrypoint
- node registration entrypoint
- Core health checks

What this service must not own:

- complete M-Net routing algorithms
- complete log analysis
- complete audit query systems
- complete risk or suspicion algorithms
- complete LLM analysis flows
- OpenSearch read-model implementation
- complex business microservice logic
- full cloud-function platforms
- production identity-provider behavior
- standalone M-Secret responsibilities

Implementation notes:

- Core source lives under `apps/core/src/`.
- Route files are split by resource boundary.
- adapters are split by downstream service boundary.
- middleware is shared across route files.
- `app.ts` remains an assembly entrypoint only and does not carry route business logic.

---

## 3. Contracts

| Contract | Path / Subject | Version | Notes |
|----------|----------------|---------|-------|
| REST | `/api/v0/*` | `v0` | external stable entrypoint |
| OpenAPI | `/openapi.json` | `v0` | must update with REST changes |
| Eden | `@meristem/contracts/core` | `0.1.0` | internal TS-first contract |
| Events | `core.lifecycle.*`, `node.registration.*` | `v0` | see `docs/events/EVENT-CATALOG.md` |

---

## 4. Permissions

| Permission | Required For | Risk |
|------------|--------------|------|
| `core:read` | read Core status | low |
| `node:register` | register simulated nodes or create agent Join Tickets | high |
| `node:issue-token` | issue, rotate, or revoke per-node runtime token | high |
| `service:register` | register service definition | high |
| `service:reload` | request reload for a reloadable internal service | high |
| `identity:token-issue` | issue local actor token | high |
| `identity:token-revoke` | revoke local actor token | high |
| `secret:create` | create secretRef | high |
| `secret:rotate` | rotate secretRef value | high |
| `secret:disable` | disable secretRef | high |
| `config:publish` | publish config version | high |
| `config:rollback` | rollback config version | high |

---

## 5. Dependencies

| Dependency | Type | Failure Behavior |
|------------|------|------------------|
| PostgreSQL | datastore | Core starts degraded if non-critical tables are unavailable; critical writes fail closed |
| NATS | event bus | event-dependent capabilities degrade; critical state must not rely only on events |
| M-Log | service | high-risk operations block if Audit Log is required but unavailable |
| M-Policy | service | protected operations fail closed |
| OpenTelemetry | telemetry | Core continues; traces record degraded telemetry |

---

## 6. Health

| Check | Meaning | Failure Behavior |
|-------|---------|------------------|
| liveness | process and event loop are alive | restart Core |
| readiness | REST, config, identity, and datastore minimums are ready | remove from serving pool |
| safety | high-risk guardrails are active | block privileged operations |

---

## 7. Logs

| Log | When Written | Required Fields |
|-----|--------------|-----------------|
| Timeline | Core start/stop, degraded mode, node registration | `summary`, `subject`, `correlationId` |
| Full | API errors, lifecycle events, dependency degradation | `source`, `level`, `message`, `traceId` |
| Audit | service registration, node authorization, secretRef changes, high-risk config actions | `actor`, `action`, `resource`, `decision` |

---

## 8. Done Criteria

- Core can start with TypeScript strict enabled.
- minimal REST health endpoints work.
- the OpenAPI document is generated.
- the Eden contract is callable.
- Core can register a sample service definition.
- Core emits lifecycle events with `version` and `correlationId`.
- privileged actions route through M-Policy and Audit Log.

---

## 9. Current Scope Notes

Current ownership additions:

- Core still aggregates logical node and logical network orchestration through M-Net.
- Core still performs PostgreSQL authoritative writes for its owned state.
- Core still coordinates M-Policy checks and M-Log writes for protected operations.
- Core owns local-mode Identity v0.2 actor records, actor token lifecycle, `jti` revocation, and internal token introspection.
- Core owns SecretRef v0.1 management entrypoints.
- Core owns Config Lifecycle v0.1 orchestration entrypoints.
- Core owns explicit runtime node token rotate/revoke entrypoints; revoke returns metadata only and replacement token adoption remains operator-managed in this slice.

Task ownership note:

- After M-Task cutover, Core no longer owns canonical task routes, task lifecycle state, task lifecycle events, or task log facts.
- M-Task owns `/api/v0/tasks`, M-Task PostgreSQL tables, task lifecycle events, and task control policy/log behavior.

Networking note:

- Core must not implement real network connectivity.
- node flow remains logical records and events only; runtime task delivery is coordinated by M-Task through M-Net.
