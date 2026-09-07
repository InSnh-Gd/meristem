---
name: meristem-effect
description: Use when writing, reviewing, or refactoring Meristem code that uses effect@4.0.0-rc.112 or @effect/platform-bun@4.0.0-rc.112 (RC migration in progress), including Effect.gen workflows, typed errors, Layer-provided ports, Schema v4 patterns, concurrency, and bun:test coverage. Enforces the ADR-F01 Effect-first boundary for complex workflows only.
---

# Meristem Effect

Meristem 依赖已升级至 `effect@4.0.0-rc.112` 与 `@effect/platform-bun@4.0.0-rc.112`（见 `package.json`）。该版本为当前接受的 Release Candidate（RC 迁移进行中），非最终 stable；已移除独立的 `@effect/platform`。本 skill 仅记录本仓库已验证的原生 v4 API 与既定模式。

## ADR-F01 边界：Effect-first，而非 Effect-everywhere

默认用 Effect 建模：多副作用且有序的工作流、重试/超时/取消、资源获取与释放、事件消费者、M-Policy 决策流、M-Log pipeline、跨服务编排。

禁止把纯数据映射、简短同步规则或简单 CRUD 包装成 Effect。

Elysia handler 保持纤薄：校验输入、进入 workflow、把类型化错误映射为文档化的错误 envelope；多步生命周期、投影、策略或审计编排不得留在路由层。

## 仓库既定模式与原生 v4 规范

- 导入规范：从 `effect` 导入核心能力，运行时试点从 `@effect/platform-bun` 导入；禁止引入已移除的独立 `@effect/platform`。跨服务 HTTP 边界先经 schema 校验，再进入 workflow。
- 错误通道：预期失败走 error channel：`Effect.fail` 携带类型化错误（需要按 tag 区分时用 `Data.TaggedError`），用 `Effect.catchTag` / `Effect.catchTags` / `Effect.catchAll` 恢复；包装 Promise 代码用 `Effect.tryPromise`。
- 端口与 Layer：端口需要多套实现（生产、测试、功能域部署）时用 `Effect.Service` + `Layer`（ADR-F01 指定入口）；否则用普通函数，不为形式统一引入 Layer。Layer 在应用入口统一 provide 一次且按引用记忆化，禁止在请求热路径内重复构建。
- 资源与并发：资源用 `Effect.acquireRelease` + `Scope` 管理；fork 出的 fiber 必须受结构化并发约束，显式 join 或中断，禁止无人监管的 fire-and-forget。
- 边界映射：`Effect.runPromise` / `Effect.runPromiseExit` 只许出现在进程或路由边界（范例：`apps/core/src/effect-helpers.ts` 的 `runServiceEffect`），禁止散落在库代码内部；边界处把类型化失败映射回 `packages/common` 的 `Result`。
- 原生 Schema v4 模式（已验证）：
  - 多值字面量联合：`Schema.Literals(['a', 'b'])`。
  - 字典映射：位置参数 `Schema.Record(Schema.String, ValueSchema)`。
  - 细化过滤与校验：`.pipe(Schema.check(Schema.makeFilter(...)))`。
  - 边界解码：使用 `Schema.decodeUnknownSync` 或 `Schema.decodeUnknownExit`，不得使用 unchecked 类型强转。

## 性能与并发

- `Effect.all` 默认顺序执行；用 `{ concurrency: n | "unbounded" }` 开启并发。它在首个错误处短路；需要收集全部结果时用 `{ mode: "either" | "validate" }`。
- 每个边界只调用一次 `runPromise`：把循环内的工作批处理成单个 program，不要逐项 run。
- 重试用 `Effect.retry` + `Schedule`，超时用 `Effect.timeout`，缓存用 `Effect.cached`；它们作用于 program 描述，不包裹边界调用。
- 并发度必须显式设上限；对出站调用禁止使用 `unbounded`。

## 测试

- 只用 `bun:test`：成功路径在普通 async test 内 `await Effect.runPromise(...)`；失败路径 `await Effect.runPromiseExit(...)` 后断言 `Exit`。
- 每个测试提供全新的 Layer 实例，避免状态泄漏；不引入额外测试运行器。

## 参考

- `docs/adr/ADR-F01-foundational-technology-stack.md`
- `docs/adr/ADR-TOOLING-effect-platform-bun-pilot.md`
- `docs/references/effect-latest.md`
