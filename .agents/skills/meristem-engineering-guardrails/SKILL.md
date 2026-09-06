---
name: meristem-engineering-guardrails
description: Use when implementing, reviewing, or changing Meristem code, tests, contracts, services, events, config, storage, security, logging, policy, telemetry, CLI, or UI behavior.
---

# Meristem Engineering Guardrails

## 使用时机

修改或审查 Meristem 的代码、契约、服务、事件、配置、状态、测试、安全、日志、策略、可观测性、CLI 或 UI 时使用本 skill。

先使用 `meristem-context-protocol` 确认产品意图、文档优先级和细分文档入口。

按触及边界继续加载：

- `meristem-service-definition`：服务、BFF、生命周期、依赖、日志行为。
- `meristem-contract-versioning`：REST、OpenAPI、Eden、事件、Effect Schema、配置、Webhook、SDUI 等版本化契约。
- `meristem-ui-contract`：M-UI、SDUI、CommandWell、M-UI Transitional Workbench。
- `meristem-testing-gates`：测试矩阵、故障模式、完成声明、阶段验收。

## 文档先行检查

生成任何模块、服务、契约、事件、路由、配置或 UI 之前，先确认：

- 这个能力属于哪个 M-* 功能域？
- 对应文档章节号是什么？
- 是否触及 Core 边界、服务定义、契约版本、配置生命周期、状态分类或冻结条款？
- 是否需要 M-Policy 检查、M-Log 记录或 OpenTelemetry trace？

## Core 与微服务边界

Core 是微内核。Core 负责 bootstrap、基础配置、基础身份、服务生命周期入口、Elysia app composition、REST/OpenAPI、Eden 契约聚合、M-CLI 入口、安全模式、最小日志和最小策略入口。

复杂能力必须下沉到 M-Net、M-EventBus、M-Log、M-Policy、M-UI、M-CLI、M-Extension 或其微服务中。

每个微服务必须声明：

- API 契约
- 事件订阅和发布
- 权限需求
- 依赖服务
- 配置 schema
- 健康检查
- 生命周期能力
- 降级和回滚语义
- Timeline / Full / Audit 日志行为

禁止通过私有对象、未声明事件或未声明 API 建立隐式耦合。

## 状态边界

必须区分：

- PostgreSQL 权威写模型
- M-EventBus 事件状态
- NATS KV / Redis 缓存状态
- OpenSearch 读模型
- Yjs 协作草稿态
- M-Log 日志事实
- Audit Log 高可信审计事实

不要把事件总线当日志存储，不要把 OpenSearch 当权威数据库，不要把 Timeline Log 当审计证据。

## Bun-Only 规则

Meristem 当前仓库执行 Bun-only：

- 包管理、脚本执行、测试执行、服务运行统一使用 Bun。
- 禁止使用 `node` 运行时执行仓库代码。
- `node:` 标准库导入只允许在 Bun 兼容的脚本、测试或工具代码中作为显式内置模块协议使用，不能让 Node.js 成为运行前提。
- 禁止让 Node.js 成为本地开发、测试、运行或联调前提。

领域里的 `Core Node`、`Stem Node`、`Leaf Node` 不是禁词；禁令只针对 Node.js 运行时前提。

## Effect 默认规则

Meristem 采用 `ADR-F01` 中的 Effect 使用边界：

- 复杂副作用、生命周期、重试、超时、取消、资源释放、内部服务编排、事件消费者、策略流程、日志 pipeline 默认优先考虑 Effect。
- 纯数据映射、简单 CRUD、短小同步规则、无需资源语义的轻量函数，不要为了形式统一强行改成 Effect。
- Elysia handler 默认负责 orchestration；当 orchestration 涉及多个外部依赖、失败分支、时序要求或资源边界时，优先抽到 Effect 工作流中。
- 不允许把“先全仓库 Promise，后续再看情况”当成复杂流程默认路径。
- 禁止把简单逻辑过度 Effect 化；仓库目标是 Effect-first for complex workflows, not Effect-everywhere。

如果任务触及 Effect 边界，至少同时检查：

- `docs/adr/ADR-F01-foundational-technology-stack.md`
- `.agents/skills/functional-programming/SKILL.md`
- `.agents/skills/effect-ts/SKILL.md`
- 对应服务文档、契约文档与测试门禁

## 类型安全与路由架构边界（摘要）

生产代码禁止 `as unknown as`、`as any`、`@ts-ignore`、`@ts-expect-error`（测试中 `@ts-expect-error` 仅用于验证编译器错误路径）；跨服务 HTTP 边界必须用 Effect Schema / TypeBox 校验后再使用数据，不得直接断言；端口返回值复用 `packages/common/src/result.ts` 的 `Result`/`ok()`/`err()`；schema companion type 统一 `XFromSchema` 命名；TypeBox `t.*` 是 Elysia 路由 primary input validator，错误 envelope 复用 `apiErrorRouteSchema`；路由 handler 保持薄（schema + auth/policy + 调用 + 返回），业务逻辑下沉 support/workflow；support helper 返回显式 tagged failure union，不得用 `as never` 短路；`bun run typecheck`、`typecheck:e2e`、`typecheck:m-ui` 三道门禁全过。

完整规则（类型断言边界、Support helper 错误传播、TypeBox/Elysia 输入边界、路由层职责、类型门禁覆盖）见 [references/type-safety-and-routing.md](references/type-safety-and-routing.md)。

## 注释、文件组织与命名（摘要）

注释用中文、解释边界与原因而非语法；非平凡逻辑必须有代码块级注释，导出/边界/校验/状态转换函数与 Elysia 方法链必须有注释；`FIXME` 之外的 `TODO`/`NOTE`/`HACK` 不得替代边界性标记。单文件不超过 500 行、一文件一职责、禁止 god-file；重构优先做最小存在性改造，第一刀抽同文件私有 helper；新 seam 必须补直接测试；源文件与测试文件命名必须反映职责（`{源文件名}.test.ts`、`{契约名}.contract.test.ts`、`{场景}.integration.test.ts`、`{流程}.e2e.test.ts`），目录 kebab-case。

完整规则见 [references/file-organization-and-naming.md](references/file-organization-and-naming.md) 与 [references/comments-and-doc-sync.md](references/comments-and-doc-sync.md)。

## Phase 字段禁令

**代码、文件名和代码注释中禁止出现任何与 `phase` 字段相关的内容。**

- 禁止在变量名、常量名、类型名、接口字段、配置键、事件名、API 参数或数据库列名中使用 `phase` 及其变体（如 `phaseId`、`phaseName`、`currentPhase` 等）。
- 禁止在源文件名、目录名、测试文件名中使用 `phase` 及其变体。
- 禁止在代码注释中提及 `phase` 概念或引用 phase 相关文档章节号；代码注释只对当前代码块的逻辑、边界和原因进行描述，不承载项目管理或阶段信息。
- 如果业务需要表达“阶段”语义，应使用领域特定词汇（如 `stage`、`step`、`period`、`lifecycleState` 等），并在契约中显式定义其含义。

**本禁令不适用于文档文件**（如 `MERISTEM.md`、`MERISTEM-DEV.md`、`MERISTEM-ROADMAP.md`、ADR、设计文档、`docs/` 下的说明文档等）。文档仍可按产品管理需要使用 `phase` 描述项目阶段、路线图和里程碑。

## 完成标准

任何核心能力完成前，必须满足：

- TypeScript strict 通过。
- 避免显式 `any`；必须依赖 TypeScript strict、Biome 与代码审查，而不是仓库级文本扫描脚本。
- 有测试和错误路径测试。
- 有必要注释，Elysia 方法链有说明。
- 有日志行为。
- 必要时有 Audit Log、M-Policy 检查和 OpenTelemetry trace。
- 契约已版本化。
- 文档已更新。
- 无 Node.js 运行时依赖；Bun 可执行的脚本、测试或工具代码可以使用 Biome 要求的 `node:` 内置模块协议。

微服务、高权限能力和跨节点契约还必须满足 `MERISTEM-DEV.md` 与 `MERISTEM-ROADMAP.md` 的专项完成标准。

## 文档同步责任（摘要）

代码变更引入技术栈或默认依赖、M-* 功能域边界、Core 职责、服务定义字段、契约/事件/配置/M-Net Profile 版本规则、权限/审计/日志/安全边界、UI token/组件/布局/SDUI schema 或分阶段路线护栏变化时，必须建议或执行同步文档更新。文档漂移是 Meristem 最大的工程风险之一；完整变化清单见 [references/comments-and-doc-sync.md](references/comments-and-doc-sync.md)。

## 参考文件

- **[type-safety-and-routing.md](references/type-safety-and-routing.md)**：类型断言边界、Support helper 错误传播、TypeBox/Elysia 输入边界、路由层职责、类型门禁覆盖。
- **[file-organization-and-naming.md](references/file-organization-and-naming.md)**：文件模块化规则、本仓库验证过的重构风格、拆分后的测试责任、文件与测试命名规则。
- **[comments-and-doc-sync.md](references/comments-and-doc-sync.md)**：注释规则、文档同步责任完整清单。
