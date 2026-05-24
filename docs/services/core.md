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

## 2.1 Internal Module Structure

Core 源码位于 `apps/core/src/`，按职责拆分为以下模块：

| 模块 | 文件 | 职责 |
|------|------|------|
| 装配入口 | `app.ts` (41行) | Elysia 实例创建、openapi 插件、7 个路由 `.use()` 组合 |
| 端口类型 | `types.ts` | `CoreDeps`、`CoreStorage`、`AuthPort`、`PolicyPort`、`LogPort` 等端口接口 |
| 依赖装配 | `adapters.ts` (75行) | `createProductionDeps` — 装配所有端口实现并暴露 `close()` |
| Effect 基础设施 | `effect-helpers.ts` | `runServiceEffect`、`tryServiceCall`、`requireServiceData` 等共享工具 |
| 存储适配器 | `storage-adapter.ts` | PostgreSQL 权威写模型 — 节点、任务、凭据、服务定义的 CRUD |
| 认证中间件 | `middleware/auth.ts` | `requireActor` (JWT 验证) + `authorize` (M-Policy RBAC) |
| 工具中间件 | `middleware/helpers.ts` | `statusCodeForServiceError`、`tracedEvent`、`joinSessionUrl` |
| 共享 Schema | `schemas.ts` | 15 个 Elysia typebox schema + `protectedResponse` / `protectedRouteDetail` |
| 适配器 — Policy | `adapters/http-policy.ts` | Core → M-Policy（Eden/HTTP） |
| 适配器 — Log | `adapters/http-log.ts` | Core → M-Log（三层日志 + OpenSearch 搜索） |
| 适配器 — EventBus | `adapters/http-eventbus.ts` | Core → M-EventBus |
| 适配器 — M-Net | `adapters/http-mnet.ts` | Core → M-Net |
| 适配器 — Agent | `adapters/http-agent-task.ts` | Core → node-agent |
| 适配器 — 旧版 RPC | `adapters/rpc-legacy.ts` | NATS RPC 端口（@deprecated） |
| 适配器 — 服务生命周期 | `adapters/service-lifecycle.ts` | 服务运行时聚合、探测、reload |
| 路由 — Health | `routes/health.ts` | `/health`、`/session`、`/ready`、`/status` |
| 路由 — Services | `routes/services.ts` | `/services` register、list、reload |
| 路由 — Networks | `routes/networks.ts` | `/networks` create、list、join、members |
| 路由 — Nodes | `routes/nodes.ts` | `/node-tickets`、`/nodes` register、credential、list、get |
| 路由 — Tasks | `routes/tasks.ts` | `/tasks` assign、get |
| 路由 — Logs | `routes/logs.ts` | timeline/full/audit list + search（6 路由） |
| 路由 — Policy | `routes/policy.ts` | `/policy/decisions/:id` |

拆分原则：
- 路由按资源（REST 路径前缀）分文件，每个导出 `resourceRoutes(deps)` → `Elysia`
- 适配器按目标服务分文件，每个导出 `createHttp*Port()` → 端口对象
- 中间件独立于路由，被多个路由文件共享引用
- `app.ts` 只负责 `.use()` 组合，不含任何路由处理逻辑

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

For the pre-Phase-11 MVP, Core also owned orchestration for:

- Stem / Leaf node registration.
- per-node agent credential issuance.
- logical network API aggregation through M-Net.
- PostgreSQL authoritative writes.
- NATS event publication.
- M-Policy checks for protected operations.
- M-Log writes for Timeline / Full / Audit.

After Phase 11, Core no longer owns canonical task routes, task lifecycle state, task lifecycle events, or task log facts. M-Task owns `/api/v0/tasks`, M-Task PostgreSQL tables, task lifecycle events, and task control policy/log behavior.

Core must not implement real network connectivity for MVP. Node flow remains logical records and events only; task delivery is coordinated by M-Task through M-Net.
