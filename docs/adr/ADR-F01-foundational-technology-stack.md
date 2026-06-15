# ADR-F01: 基础技术栈

## 状态

Accepted

## 上下文

Meristem 需要一个统一、可验证且工程团队可长期维护的默认技术栈。默认语言、后端框架和外部 API 形式会直接影响契约表达、类型安全、测试方式、 onboarding 成本和跨团队协作方式。技术栈选择必须在以下约束之间取得平衡：

- Core 必须是微内核，复杂能力下沉到明确的 M-* 功能域或微服务。
- 内部 TypeScript 服务之间需要类型安全的契约。
- 外部 API 需要跨语言可消费、可被工具化生成客户端。
- 默认栈必须轻量，不能默认引入重型编排平台或服务网格。

## 决策

### TypeScript-first

TypeScript 是 Meristem 的默认实现语言，覆盖 Core、核心微服务、契约、测试、CLI 和 UI 工具链。Wasm、Zig 或其他运行时仅在性能关键路径、隔离需求、低资源节点或特殊运行时能力场景下作为补充使用。

### Elysia-first

Meristem 后端服务使用 ElysiaJS 作为默认组织模型。Elysia 的方法链、插件机制、schema、生命周期、类型推导和 Eden 契约是工程基线的一部分。复杂 Elysia 方法链必须在代码注释中说明其鉴权、策略、生命周期、日志和错误映射语义。

### REST + OpenAPI，无 GraphQL

外部 API 使用 REST + OpenAPI。GraphQL 不是当前默认架构的一部分。REST 边界通过 URL 或 header 进行版本化，OpenAPI 文档必须随 REST 路由变化同步更新。

### Eden-first，但非 Eden-only

内部 TypeScript 服务优先使用 Eden over HTTP 获得类型安全的客户端/服务端契约。Eden 不是唯一的契约系统，也不是独立的传输协议。MVP 中 `Core -> M-Policy`、`Core -> M-Log`、`Core -> M-EventBus` 使用 loopback-only HTTP 加共享内部 token；外部 API 使用 REST + OpenAPI；事件使用 Event Schema；跨语言或 Wasm 边界使用 REST/OpenAPI、Event Schema 或后续 WIT。

### Effect-first 内部工作流，非 Effect Everywhere

复杂 Meristem 工作流和可执行契约默认使用 Effect 建模：

- 使用 `Effect.gen` 处理多副作用、有序写入、重试、超时、取消、降级状态或清理的工作流。
- 使用 `Effect.Service` / `Layer` 为生产、测试或未来微服务部署拥有不同实现的端口提供统一入口。
- 使用 Effect Schema 表达跨服务、节点、运行时或时间边界的内部可执行契约，包括策略决策、事件 payload、日志/投影记录、服务定义、配置生命周期对象和 BFF command-state 契约。
- Elysia TypeBox schema 保留为 REST/OpenAPI 适配层；路由 schema 可以从共享 Effect Schema 派生或进行一致性校验，但不强制一次性迁移。
- 禁止把纯数据映射、简短同步规则或简单 CRUD 包装 solely for style uniformity 改成 Effect。

Elysia handler 应保持纤薄：校验 HTTP 输入、进入对应 Effect workflow、将类型化的领域错误映射到文档化的错误 envelope，并暴露 REST/OpenAPI 元数据。路由不应拥有多步生命周期、投影、策略或审计编排。

### M-UI 技术集成

M-UI 使用 SvelteKit + SDUI，并与 Elysia 在路由级集成。M-UI 初始与 Core 一体化部署，但保留后续拆分部署的可能。BFF 路由可通过 Eden 聚合后端能力。

### 不默认采用的技术

以下技术明确不作为默认架构：

- GraphQL
- Temporal
- Tekton
- Raft
- Jotai
- Elasticsearch
- 默认 Service Mesh
- gRPC everywhere
- 每服务独立数据库
- 自研 Raft
- 全系统强制 CQRS

任何例外都需要一份专门的 ADR。

## 结果

- 统一默认语言使 Core、服务、CLI、UI 和测试之间可以共享类型契约。
- Elysia-first 让后端服务拥有一致的类型化风格，但需要警惕复杂方法链的可读性风险。
- REST + OpenAPI 让 API 版本化、文档生成和跨语言客户端保持简单，代价是复杂 UI 数据聚合需要 BFF 端点。
- 非 TypeScript 集成必须通过 REST/OpenAPI、Event Schema 或后续 WIT 边界接入。

## 重访条件

- 如果某个核心子系统无法用 TypeScript + 受限的非 TypeScript 运行时满足隔离、可移植性或性能目标。
- 如果 Elysia 阻碍了必需的生命周期、OpenAPI、部署或可观测性行为，且无法通过轻量 workaround 解决。
- 如果 REST + BFF 无法支持已验证的 UI 或集成需求，且端点扩散成本超过收益。
- 如果 Eden 契约泄漏到外部边界，或维护多种契约形式导致不一致。
- 如果 Effect 使用变得不一致、简单代码被过度建模，或 Elysia/Effect Schema 重复导致契约漂移。
- 如果 SvelteKit + Elysia 路由级集成造成部署或所有权问题。
- 如果要重新引入负面清单中的某项技术作为默认组件。
