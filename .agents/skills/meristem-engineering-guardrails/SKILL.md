---
name: meristem-engineering-guardrails
description: Use when implementing, reviewing, or changing Meristem vNext code, tests, contracts, services, events, config, storage, security, logging, policy, telemetry, CLI, or UI behavior.
---

# Meristem Engineering Guardrails

## 使用时机

修改或审查 Meristem 的代码、契约、服务、事件、配置、状态、测试、安全、日志、策略、可观测性、CLI 或 UI 时使用本 skill。

先使用 `meristem-context-protocol` 确认产品意图、文档优先级和细分文档入口。

按触及边界继续加载：

- `meristem-service-definition`：服务、BFF、生命周期、依赖、日志行为。
- `meristem-contract-versioning`：REST、OpenAPI、Eden、事件、Effect Schema、配置、Webhook、SDUI 等版本化契约。
- `meristem-ui-contract`：M-UI、SDUI、CommandWell、Phase 9 demo shell。
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

Meristem vNext 当前仓库执行 Bun-only：

- 包管理、脚本执行、测试执行、服务运行统一使用 Bun。
- 禁止使用 `node` 运行时执行仓库代码。
- 禁止引入 `node:*` 标准库 API。
- 禁止让 Node.js 成为本地开发、测试、运行或联调前提。

领域里的 `Core Node`、`Stem Node`、`Leaf Node` 不是禁词；禁令只针对 Node.js 运行时和 Node.js API。

## Effect 默认规则

Meristem 采用 `ADR-016: Effect Without Effect Everywhere`：

- 复杂副作用、生命周期、重试、超时、取消、资源释放、内部服务编排、事件消费者、策略流程、日志 pipeline 默认优先考虑 Effect。
- 纯数据映射、简单 CRUD、短小同步规则、无需资源语义的轻量函数，不要为了形式统一强行改成 Effect。
- Elysia handler 默认负责 orchestration；当 orchestration 涉及多个外部依赖、失败分支、时序要求或资源边界时，优先抽到 Effect 工作流中。
- 不允许把“先全仓库 Promise，后续再看情况”当成复杂流程默认路径。
- 禁止把简单逻辑过度 Effect 化；仓库目标是 Effect-first for complex workflows, not Effect-everywhere。

如果任务触及 Effect 边界，至少同时检查：

- `docs/adr/ADR-016-effect-without-effect-everywhere.md`
- `.agents/skills/functional-programming/SKILL.md`
- `.agents/skills/effect-ts/SKILL.md`
- 对应服务文档、契约文档与测试门禁

## 注释规则

代码注释不要求引用来源文档或章节号。注释应使用中文，除非引用外部协议字段、错误码、API 名称或英文专有名词。

不要给显而易见的赋值写注释。注释用于解释边界、契约、故障处理和安全原因。

维持 `MERISTEM-DEV.md §8.2` 的要求：

- 非平凡逻辑必须有代码块级注释。
- 导出函数、边界函数、校验函数、状态转换函数必须有函数注释。
- Elysia 方法链必须有特别注释，解释鉴权、策略、生命周期、日志和错误映射。
- 注释优先解释边界和原因，不重复语法本身。

`FIXME` 只能用于临时方案、已知技术债、未完成安全边界、临时降级路径、尚未处理的异常情况、未来必须修复的问题。不得用无说明的 `TODO`、`NOTE` 或 `HACK` 代替这些边界性标记。

## 完成标准

任何核心能力完成前，必须满足：

- TypeScript strict 通过。
- 无 `any`。
- 有测试和错误路径测试。
- 有必要注释，Elysia 方法链有说明。
- 有日志行为。
- 必要时有 Audit Log、M-Policy 检查和 OpenTelemetry trace。
- 契约已版本化。
- 文档已更新。
- 无 Node.js 运行时依赖，无 `node:*` API 依赖。

微服务、高权限能力和跨节点契约还必须满足 `MERISTEM-DEV.md` 与 `MERISTEM-ROADMAP.md` 的专项完成标准。

## 文档同步责任

如果修改引入以下变化，必须建议或执行同步文档更新：

- 技术栈或默认依赖变化
- M-* 功能域边界变化
- Core 职责变化
- 服务定义字段变化
- 契约、事件、配置、M-Net Profile 版本规则变化
- 权限、审计、日志、安全边界变化
- UI token、组件、布局或 SDUI schema 变化
- 分阶段路线或 v0.1 护栏变化

文档漂移是 Meristem 最大的工程风险之一。代码变更不能让文档成为过期口号。
