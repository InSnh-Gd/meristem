# ADR-016: Effect-First Internal Workflows, Not Effect Everywhere

## Status

Accepted

## Context

Some Meristem flows need strong modeling for effects, errors, resources, retries, cancellation, and lifecycle.

Recent architecture review found the same pressure in contract and orchestration code: permission vocabularies, log/search/projection shapes, task assignment, service lifecycle, M-Policy, and M-Log projection all cross service, node, runtime, and time boundaries. Keeping these as ad hoc Promise chains and duplicated literal schemas spreads failure semantics across route handlers and adapters.

## Decision

Use Effect as the default internal model for complex Meristem workflows and executable contracts:

- Use `Effect.gen` for workflows with multiple side effects, ordered writes, retries, timeout, cancellation, degraded states, or cleanup.
- Use `Effect.Service` / `Layer` when a module owns durable ports or adapters whose implementations vary in production, tests, or future microservice deployments.
- Use Effect `Schema` for internal executable contracts that cross service, node, runtime, or time boundaries, especially policy decisions, event payloads, log/projection records, service definitions, config lifecycle objects, and BFF command-state contracts.
- Keep Elysia TypeBox schemas at REST/OpenAPI edges until a route is deliberately migrated; route schemas may be derived from or checked against Effect Schema, but Elysia remains the external HTTP/OpenAPI adapter.
- Do not convert pure data mapping, short synchronous rules, or trivial CRUD wrappers solely for style uniformity.

This is Effect-first for internal workflows and contract modeling, not Effect everywhere.

## Consequences

Complex workflows get better safety without making the whole codebase harder to read. Contract literals and runtime validation should move toward shared Effect Schema modules instead of being repeated in each Elysia route file.

Elysia handlers should become thin adapters: validate HTTP input, enter the relevant Effect workflow, map typed domain errors to the documented error envelope, and expose REST/OpenAPI metadata. They should not own multi-step lifecycle, projection, policy, or audit sequencing.

## Revisit When

## 2026-05-22 扩展记录

本轮扩展（Phase 2）将 Effect 从局部辅助提升到 Core 架构层：

1. **自定义错误类** — 引入 `CoreError` 继承 `Error`，配合 Elysia `.error()` 做类型安全错误路由。
2. **`Effect.Service` Tag** — `CoreDepsTag` 封装 Core 端口集合，为后续 `Layer` DI 提供统一入口。
3. **`requireActor` / `authorize` throw 迁移** — 认证/授权失败从 `apiError(status, ...)` 返回值改为抛出 `CoreError`，由全局 `.onError()` 统一收敛为错误 envelope。
4. **`apiError()` 逐步退役** — 路由层不再手动拼装错误 envelope，统一依赖 Elysia 错误处理链。
5. **Effect Schema 主路径** — 内部领域契约优先使用 Effect Schema 建模；Elysia TypeBox 保留为 REST/OpenAPI 适配层，并逐步消除手写重复字面量。
6. **`Layer` DI 主路径** — 新增复杂端口、可替换 adapter、事件消费者、投影/生命周期 worker 时，默认使用 `Effect.Service` / `Layer`。现有 `CoreDeps` 可分阶段迁移，不要求一次性重写。

## 2026-05-23 扩展记录

本轮扩展将 Effect 从“复杂副作用可选方案”提升为 Meristem 内部复杂 workflow 和 executable contract 的默认方案：

1. **契约模型** — `packages/contracts` 后续应优先提供 Effect Schema 版本的 actor、permission、log、policy、projection、service definition、event payload 等共享契约。
2. **HTTP 适配** — Elysia route schema 继续保障 REST/OpenAPI 输出；重复手写 TypeBox 字面量应逐步改为从共享契约派生或保持一致性测试。
3. **Projection Platform** — M-Log projection job/cursor/DLQ/backfill/health 属于 Effect workflow 候选，不应长期停留在单个 Promise-heavy module。
4. **Task assignment** — Core task assignment 属于 Effect workflow 候选，路由应变薄，任务状态转换、audit/event/log 顺序和失败恢复集中到 workflow module。
5. **M-Policy** — RBAC 纯决策仍保持纯函数；读取权限、写入决策事实、失败映射和审计联动属于 Effect workflow。

## Revisit When
Revisit if Effect usage becomes inconsistent, if simple code is being over-modeled, or if Elysia/Effect Schema duplication continues to create contract drift.
