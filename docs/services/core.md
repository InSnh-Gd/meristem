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

Core owns the microkernel boundary:

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

Core must not own:

- complete M-Net routing algorithms
- complete log analysis
- complete audit query system
- complete risk model or suspicion algorithm
- complete LLM analysis flow
- OpenSearch read model implementation
- complex business microservice logic
- full cloud-function platform

---

## 3. Contracts

| Contract | Path / Subject | Version | Notes |
|----------|----------------|---------|-------|
| REST | `/api/v0/*` | `v0` | External stable entrypoint |
| OpenAPI | `/openapi.json` | `v0` | Must update with REST changes |
| Eden | `@meristem/contracts/core` | `0.1.0` | Internal TS-first contract |
| Events | `core.lifecycle.*`, `node.registration.*` | `v0` | See `docs/events/EVENT-CATALOG.md` |

---

## 4. Permissions

| Permission | Required For | Risk |
|------------|--------------|------|
| `core:read` | read Core status | low |
| `node:register` | register simulated nodes or create agent Join Tickets | high |
| `node:issue-token` | issue or rotate per-node runtime token | high |
| `service:register` | register service definition | high |
| `service:reload` | request reload for a reloadable internal service | high |

---

## 5. Dependencies

| Dependency | Type | Failure Behavior |
|------------|------|------------------|
| PostgreSQL | datastore | Core starts in degraded mode if non-critical tables unavailable; critical state writes fail closed |
| NATS | event bus | event-dependent capabilities degrade; critical state must not rely only on events |
| M-Log | service | high-risk operation blocks if Audit Log is required but unavailable |
| M-Policy | service | protected operations fail closed |
| OpenTelemetry | telemetry | Core continues; trace marked unavailable |

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
| Timeline | Core start, stop, degraded mode, node registration | `summary`, `subject`, `correlationId` |
| Full | API errors, lifecycle events, dependency degradation | `source`, `level`, `message`, `traceId` |
| Audit | service registration, node authorization, secretRef changes, high-risk config | `actor`, `action`, `resource`, `decision` |

---

## 8. Done Criteria

- Core can start with TypeScript strict enabled.
- Minimal REST health endpoint works.
- OpenAPI document is generated.
- Eden contract sample is callable.
- Core can register a sample service definition.
- Core emits lifecycle events with `version` and `correlationId`.
- Privileged actions route through M-Policy and Audit Log.

---

## 9. MVP Additions

For MVP, Core also owns orchestration for:

- Stem / Leaf node registration.
- per-node agent credential issuance.
- logical network API aggregation through M-Net.
- noop Leaf task assignment, including `node-agent` request/reply dispatch for agent-mode nodes.
- PostgreSQL authoritative writes.
- NATS event publication.
- M-Policy checks for protected operations.
- M-Log writes for Timeline / Full / Audit.

Core must not implement real network connectivity for MVP. Node and task flow are logical records and events only.
