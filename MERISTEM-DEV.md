# MERISTEM-DEV - 开发文档

> 这是 MERISTEM 的**工程规范**。它回答：产品怎么被实现、数据结构长什么样、哪些决策一旦定下来就不可更改。
>
> **边界**：`MERISTEM.md` 回答「是什么」，`MERISTEM-DESIGN.md` 回答「长什么样」，本文档回答「怎么被实现」。三份文档冲突时，`MERISTEM.md` 是意图，`MERISTEM-DESIGN.md` 是视觉契约，本文档是实现当前的草稿。意图先改，视觉契约再跟上，实现最后跟上。
>
> **跨文档引用约定**：`产品文档 §X.Y` 引用 `MERISTEM.md`，`设计文档 §X.Y` 引用 `MERISTEM-DESIGN.md`，`开发文档 §X.Y` 引用本文档。

---

## 一、工程底座

### 1.0 细分工程契约

本文档只保留工程总纲。实现前应读取对应细分文档：

| 主题 | 文档 |
|------|------|
| 文档总索引 | `docs/README.md` |
| MVP 范围 | `docs/mvp/MVP-SPEC.md` |
| 架构决策 | `docs/adr/README.md` |
| 微服务定义 | `docs/services/SERVICE-DEFINITION-TEMPLATE.md` |
| Core 服务边界 | `docs/services/core.md` |
| M-Net 服务边界 | `docs/services/m-net.md` |
| M-EventBus 服务边界 | `docs/services/m-eventbus.md` |
| M-Log 服务边界 | `docs/services/m-log.md` |
| M-Policy 服务边界 | `docs/services/m-policy.md` |
| 事件目录 | `docs/events/EVENT-CATALOG.md` |
| 契约版本 | `docs/contracts/CONTRACT-VERSIONING.md` |
| MVP REST API | `docs/contracts/REST-API-MVP.md` |
| MVP Eden 契约 | `docs/contracts/EDEN-MVP.md` |
| MVP CLI 命令 | `docs/contracts/CLI-COMMANDS.md` |
| 安全模型 | `docs/security/SECURITY-MODEL.md` |
| 状态模型 | `docs/data/STATE-MODEL.md` |
| MVP PostgreSQL schema | `docs/data/POSTGRES-SCHEMA-MVP.md` |
| 配置生命周期 | `docs/config/CONFIG-LIFECYCLE.md` |
| 运行手册 | `docs/operations/RUNBOOK.md` |
| 测试策略 | `docs/testing/TESTING.md` |
| SDUI schema | `docs/ui/SDUI-SCHEMA.md` |

### 1.1 技术栈

| 层级 | 选型 | 约束/备注 |
|------|------|----------|
| 默认语言 | TypeScript | TypeScript-first；Core、核心微服务、契约、测试、CLI、UI 工具链默认使用 TS |
| 默认运行时 | Bun | Bun-only；包管理、脚本执行、测试执行、本地服务进程统一使用 Bun |
| 后端框架 | ElysiaJS | Elysia-first；方法链、插件机制、schema、生命周期和类型推导是服务组织基础 |
| 内部 TS 契约 | Eden Contract | Eden-first，但非 Eden-only |
| 外部 API | REST + OpenAPI | 对外 API 使用 REST + OpenAPI；GraphQL 当前移除 |
| 事件总线 | NATS | M-EventBus 的底层主干 |
| 写模型 | PostgreSQL | 暂定权威状态源 |
| 读模型 / 搜索 | OpenSearch | 用于日志检索、读模型、分析查询和 AI 日志分析前置检索；不是权威状态源 |
| KV / Cache | NATS KV / MATS | 默认轻量 KV；Redis / KeyDB 仅作为补充后端 |
| UI | SvelteKit + SDUI | M-UI 基础；与 Elysia 路由级深度集成 |
| CLI | TypeScript CLI | Core 直接提供官方命令行入口，优先 Eden 契约 |
| 可观测性 | OpenTelemetry | traces / metrics / logs 的采集与关联层 |
| 副作用与内部契约建模 | Effect | 复杂副作用、生命周期、事件消费者、策略流程、日志 pipeline、投影、重试/超时/取消、多服务编排和跨服务内部契约默认优先使用；不强制 Effect-everywhere |
| 扩展 | M-Extension | 原 M-Plugin 已废弃；扩展是补充机制，不是主功能承载层 |
| 可选网关 | APISIX | 可选部署组件，不进入 Core 默认依赖 |
| 可选运行时 | Wasm3 / Wasmtime / WasmGC / Zig | 仅用于隔离、可移植、高级运行时或性能增强 |

明确放弃或暂不采用：

```text
GraphQL
Temporal
Tekton
Raft
Jotai
Elasticsearch
默认 Service Mesh
gRPC everywhere
每服务独立数据库
自研 Raft
全系统强制 CQRS
```

额外硬约束：

- 禁止使用 `node` 运行时执行仓库代码。
- 禁止引入 `node:*` 标准库 API。
- 禁止让 Node.js 成为开发、测试、运行或联调前提。

### 1.2 Monorepo 策略

整个项目采用 Monorepo，主仓库暂定为 `Meristem`。

原则：

- Core 与核心微服务位于同一 Monorepo。
- 统一工程规范、契约管理、测试体系、文档规范、代码风格、构建和发布流程。
- 微服务不是独立一级模块，而是各 M-* 子系统的主要实现形态。
- 共享包只承载纯函数、schema、validator、policy、parser、event envelope helper 等无隐式状态的能力。

建议目录结构：

```text
apps/
  core/
    src/
      app.ts              Elysia instance assembly + openapi + route composition
      types.ts            CoreDeps, CoreStorage and port interfaces
      adapters.ts         createProductionDeps dependency assembly + re-export
      schemas.ts          REST/OpenAPI adapter schemas; complex shared contracts should come from packages/contracts Effect Schema modules
      effect-helpers.ts   Effect infrastructure (runServiceEffect, tryServiceCall, etc.)
      storage-adapter.ts  PostgreSQL authoritative write model adapter
      adapters/           per-service adapter ports (http-policy, http-log, http-eventbus, http-mnet, http-agent-task, rpc-legacy, service-lifecycle)
      middleware/          auth middleware (requireActor, authorize) + route helpers
      routes/             per-resource routes (health, services, networks, nodes, tasks, logs, policy)
  m-ui/                 SvelteKit + SDUI
  m-cli/                official CLI

packages/
  contracts/            Eden contracts, OpenAPI helpers, Effect Schema executable contracts, shared schemas
  events/               MEventEnvelope, event schemas, subject helpers
  service-definition/   MServiceDefinition types and validators
  policy/               RBAC and policy primitives
  log-schema/           Timeline / Full / Audit schemas
  config/               config schema, lifecycle, version/hash helpers
  telemetry/            OpenTelemetry helpers
  testing/              shared semantic tests and fixtures

services/
  m-net/
  m-eventbus/
  m-log/
  m-policy/
  m-extension/

docs/
  adr/
  services/
  api/
```

### 1.3 渲染与部署策略

Meristem 不是单纯前端项目。M-UI 默认与 Elysia 服务端一体化部署，但保留后续拆分部署可能性。

| 入口 | 策略 | 说明 |
|------|------|------|
| Core API | Elysia runtime | REST + OpenAPI，对外稳定入口 |
| 内部 TS 调用 | Eden HTTP | Core 到微服务、BFF、CLI 优先使用 |
| M-UI | SvelteKit SSR + SDUI | M-UI shell、Timeline、节点状态、策略页面 |
| M-CLI | Core 深度绑定 | 官方命令行入口，可通过 BFF 聚合后端能力 |
| Webhook | REST endpoint | 外部通知、CI/CD、告警、第三方平台、LLM tool callback |
| APISIX | 可选边缘组件 | TLS、限流、认证前置、灰度、多 Core / 多实例入口 |

### 1.4 Core 边界

Core 是微内核，不是大而全业务单体。

Core 必须负责：

```text
bootstrap
基础配置加载
基础身份能力
服务生命周期入口
Elysia app composition
REST + OpenAPI
内部 Eden 契约聚合
M-CLI 入口
安全模式
最小日志入口
最小策略入口
密钥基础管理入口
节点注册入口
Core 自身健康检查
```

Core 可以协调：

```text
M-Net 控制服务
M-EventBus 接入
M-Log 接入
M-Policy 接入
M-UI 路由级集成
微服务注册与生命周期
Webhook 入口
BFF 聚合入口
```

Core 不应直接负责：

```text
完整 M-Net 策略算法
完整日志分析
完整审计查询系统
完整权限风险算法
完整置疑度模型
完整 LLM 分析流程
OpenSearch 读模型实现
复杂业务微服务逻辑
完整云函数平台
复杂性能 hot path 实现
```

Core 禁止通过私有对象直接耦合所有 M-* 子系统。跨子系统通信优先使用明确 Eden 契约、事件 schema、Service Definition 和配置 schema。

### 1.5 状态管理与存储边界

Meristem 必须明确区分权威状态、事件、缓存、读模型、协作草稿态和日志事实。

| 状态类别 | 承载 | 边界 |
|----------|------|------|
| Authoritative State | PostgreSQL | 用户、角色、权限、节点、服务定义、配置版本、密钥引用、任务记录、关键资源状态 |
| Event State | M-EventBus / NATS | 任务事件、节点事件、服务生命周期事件、网络互联事件、配置发布事件、策略通知事件；不是权威数据库 |
| Cache State | NATS KV 优先，Redis / KeyDB 补充 | 复杂缓存语义、高频限流、复杂 distributed lock、sorted set、特殊 session |
| Read Model | OpenSearch 或投影 | 日志检索、Timeline 聚合、Audit 查询、节点状态看板、行为分析视图、网络路径视图；不是权威写模型 |
| Collaborative Draft State | Yjs | 协作态和配置草稿态；不是权威配置源 |
| Log Facts | M-Log | 系统事实；Audit Log 是高可信审计事实，不是 Full Log 的普通分类 |

禁止混淆：

```text
OpenSearch 不是权威状态源。
NATS KV 不是主数据库。
Yjs 不是权威配置源。
M-EventBus 不是日志存储。
Timeline Log 不是审计证据。
Full Log 不能替代 Audit Log。
```

### 1.6 样式系统

M-UI 的视觉系统必须通过 token 和 SDUI schema 落地。

关键约束：

- 所有颜色、字体、间距和状态信号必须通过 design token 引用，见 `设计文档 §2–§4`。
- 禁止在组件文件中写死 hex、rgb、hsl 或任意 px 值。
- SDUI schema 必须限制 route-level layout 和组件 inventory。
- 高风险操作只能出现在 CommandWell 中，见 `设计文档 §6.1`。
- Audit、Policy、Log、Node state 组件必须显示可追溯来源。

---

## 二、核心数据结构

### 2.1 节点模型

```ts
type MNodeKind = "core" | "stem" | "leaf";

type MNodeCapability =
  | "core.control"
  | "node.relay"
  | "service.host"
  | "task.execute"
  | "network.derp"
  | "network.tcp"
  | "network.udp";

type MNodeStatus =
  | "joining"
  | "healthy"
  | "degraded"
  | "offline"
  | "revoked";

interface MNodeRecord {
  id: string;
  kind: MNodeKind;
  displayName: string;
  region?: string;
  capabilities: MNodeCapability[];
  status: MNodeStatus;
  scope: string[];
  createdAt: string;
  updatedAt: string;
}
```

边界：

- Core Node 运行 Meristem Core，可同时作为 Stem Node。
- Stem Node 是长期基础设施节点。
- Leaf Node 默认低权限、受限 API、受限互联；扩展能力必须显式授权、可审计、可撤销。

### 2.2 服务定义

每个微服务必须有明确服务定义。该定义可以先以文档形式存在，后续可演进为 `service.definition.ts` 或 `service.json`。

```ts
type MServiceDefinition = {
  name: string;
  version: string;
  domain:
    | "core"
    | "m-net"
    | "m-eventbus"
    | "m-log"
    | "m-policy"
    | "m-task"
    | "m-ui"
    | "m-cli"
    | "m-extension";
  kind: "core" | "internal" | "node" | "task" | "extension" | "bff";
  contracts: {
    eden?: string;
    rest?: string;
    events?: string[];
  };
  permissions: string[];
  dependencies: string[];
  configSchema?: string;
  health: {
    liveness: boolean;
    readiness: boolean;
  };
  lifecycle: {
    reloadable: boolean;
    rollbackable: boolean;
    degradable: boolean;
  };
  logs: {
    timeline: boolean;
    full: boolean;
    audit: boolean;
  };
  policyRequirements?: string[];
};
```

服务必须声明：

- 提供哪些 API。
- 订阅哪些事件。
- 发布哪些事件。
- 依赖哪些服务。
- 需要哪些权限。
- 暴露哪些配置。
- 是否支持热重载。
- 是否支持回滚。
- 降级策略是什么。
- 记录哪些 Timeline / Full / Audit 日志。

服务禁止：

- 隐式读取其他服务内部状态。
- 绕过 M-Policy 做高权限操作。
- 绕过 M-Log 执行关键变更。
- 通过未声明事件或未声明 API 建立隐式耦合。

### 2.3 事件 Envelope

所有跨服务、跨节点、跨时间存在的事件必须版本化。

```ts
type MEventEnvelope = {
  id: string;
  type: string;
  version: string;
  source: string;
  timestamp: string;
  correlationId?: string;
  causationId?: string;
  subject?: string;
  payload: unknown;
};
```

约束：

- `payload` 必须通过事件 schema 收窄，不能直接使用 `any`。
- 事件不是权威数据库。
- 关键状态不得只依赖事件。
- 事件 schema 必须保留 version 字段。

### 2.4 日志模型

M-Log 采用三级日志系统：

```text
Timeline Log
Full Log
Audit Log
```

```ts
type MLogLevel = "debug" | "info" | "warn" | "error";

interface TimelineLogEntry {
  id: string;
  timestamp: string;
  summary: string;
  subject?: string;
  correlationId?: string;
}

interface FullLogEntry {
  id: string;
  timestamp: string;
  level: MLogLevel;
  source: string;
  message: string;
  correlationId?: string;
  traceId?: string;
  payload?: unknown;
}

interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  resource: string;
  decision: MPolicyDecisionResult;
  correlationId?: string;
  traceId?: string;
  immutable: true;
}
```

边界：

- Timeline Log 面向多数团队成员，强调人类友好。
- Full Log 面向运维、AI 分析、故障排查和完整检索。
- Audit Log 独立实现，是高权限系统，不能只是 Full Log 的普通分类。

### 2.5 策略决策

```ts
type MPolicyDecisionResult =
  | "allow"
  | "deny"
  | "require_mfa"
  | "require_single_approval"
  | "require_multi_approval"
  | "require_llm_summary"
  | "require_manual_review"
  | "require_delay"
  | "require_limited_scope"
  | "require_readonly_mode"
  | "require_core_node_only"
  | "require_audit_lock";

interface MPolicyDecision {
  id: string;
  actor: string;
  action: string;
  resource: string;
  confidence?: number;
  suspicion?: number;
  result: MPolicyDecisionResult;
  reasons: string[];
  createdAt: string;
}
```

原则：

- 第一阶段以 RBAC 为基础。
- 置信度是系统对当前操作主体可信程度的正向评估。
- 置疑度必须参考置信度，但不等于 `1 - 置信度`。
- 小模型只输出风险信号，不做最终授权。
- LLM 只做辅助分析、风险解释、日志总结和审批建议，不作为最终授权根。
- 多元决策过程必须写入 Audit Log。

### 2.6 配置生命周期

配置热重载必须建立在版本化配置生命周期之上。

```text
draft
-> validate
-> commit
-> version
-> hash/sign
-> publish
-> apply
-> ack
-> rollback
```

配置记录至少包含：

```ts
interface MConfigRecord {
  configVersion: string;
  configHash: string;
  schemaVersion: string;
  targetScope: string[];
  publishedBy?: string;
  publishedAt?: string;
  appliedNodes: string[];
  failedNodes: string[];
  rollbackVersion?: string;
}
```

适用对象：

```text
M-Net 策略
M-Net CN profile
M-Policy 策略
微服务配置
M-UI SDUI schema
M-Extension 配置
Webhook 配置
OpenTelemetry 配置
```

---

## 三、契约、版本与通信

### 3.1 契约形式

| 场景 | 契约形式 |
|------|----------|
| 内部 TS 服务 | Eden Contract + Effect workflow / Effect Schema |
| 外部 API | REST + OpenAPI |
| M-EventBus 事件 | Event Schema + Effect Schema executable contract |
| 跨语言 / 跨运行时 | REST + OpenAPI / Event Schema |
| Wasm / Component Model | 后续按需考虑 WIT |

### 3.1.1 Effect-first 内部契约规则

Meristem 内部复杂契约默认使用 Effect 建模，见 `docs/adr/ADR-016-effect-without-effect-everywhere.md`。

必须优先考虑 Effect Schema 的对象：

```text
PolicyDecision / PolicyInput
Service Definition
MEventEnvelope payload
Timeline / Full / Audit log facts
Projection job / cursor / DLQ / health / backfill params
Config lifecycle state
M-UI BFF command-state contract
Webhook payload
跨服务内部 HTTP 响应 envelope
```

规则：

- Effect Schema 是内部 executable contract 的主路径，类型、运行时校验和测试样例应尽量从同一 Module 取得。
- Elysia TypeBox schema 是 REST/OpenAPI 适配层，不应成为内部领域契约的唯一来源。
- 新增复杂契约时，先在 `packages/contracts` 或对应 M-* 包中定义 Effect Schema，再由路由层复用或映射到 Elysia schema。
- 现有手写 TypeBox 字面量可分阶段迁移；迁移前必须通过 contract tests 防止字面量漂移。
- 简单同步映射和短小纯函数不需要包成 Effect；复杂 workflow、可替换 adapter、重试/超时/取消、资源生命周期和多服务编排默认进入 Effect。

### 3.2 内部通信方式

不默认引入 RPC。内部通信使用组合方式：

- **Eden HTTP**：TS 内部同步接口、Core 到微服务、M-UI BFF、M-CLI BFF。
- **M-EventBus / NATS**：异步事件、命令分发、状态变化通知、网络互联信息、服务生命周期事件。
- **Effect workflow / Layer**：复杂内部流程、可替换端口、生命周期 worker、投影 worker、策略流程和日志 pipeline。
- **Shared packages**：Monorepo 内共享纯函数、Effect Schema、validator、policy、parser、event envelope helper。
- **REST / Webhook**：外部系统和跨语言简单接入。
- **WIT / Component Model**：后续按需用于 Wasm 和跨语言边界。

### 3.3 版本化规则

所有跨服务、跨节点、跨时间存在的契约都必须版本化。

需要版本化的对象：

```text
REST API
OpenAPI schema
Eden Contract
Event Schema
Service Definition
M-Net Profile
M-Policy Rule
M-Log Schema
Config Schema
M-Extension Manifest
Webhook Payload
BFF Contract
```

版本化原则：

- 破坏性变更必须升级 major version。
- 非破坏性新增字段必须保持向后兼容。
- 事件 schema 必须保留 version 字段。
- 跨节点协议必须允许旧版本节点短期共存。
- Core、Stem、Leaf、M-CLI、M-UI 不假设永远同版本。

---

## 四、冻结条款（必须遵守）

以下条款在产品上线、产生可持久化用户数据或跨节点协议后不应随意更改。更改任何一条都需要明确迁移策略。

1. **节点类型集合** - `core | stem | leaf` 是 M 网络基础模型，不能在无迁移方案时重命名或改变语义。
2. **Core 微内核边界** - Core 不能扩张为业务单体；新增复杂能力必须先声明 M-* 功能域或微服务边界。
3. **Service Definition 基础字段** - `name/version/domain/kind/contracts/permissions/dependencies/health/lifecycle/logs` 是微服务最低契约，不得移除。
4. **MEventEnvelope 基础字段** - `id/type/version/source/timestamp/payload` 必须保留，payload 只能通过 schema 收窄。
5. **三级日志语义** - Timeline / Full / Audit 的职责不能互相替代；Audit Log 必须保持独立高权限语义。
6. **配置生命周期顺序** - `draft -> validate -> commit -> version -> hash/sign -> publish -> apply -> ack -> rollback` 是热重载基础，不得跳过关键验证和审计环节。
7. **LLM 授权边界** - LLM 不能成为最终授权根、审计事实来源或高权限操作执行者。
8. **状态分类边界** - PostgreSQL、M-EventBus、NATS KV、OpenSearch、Yjs、M-Log 的职责不得混淆。
9. **禁止默认依赖** - APISIX、Redis / KeyDB、Wasm / Zig、Service Mesh、gRPC everywhere 不得成为 Core 默认依赖。
10. **协议兼容窗口** - Core、Stem、Leaf、M-CLI、M-UI 不假设永远同版本；破坏性契约变更必须有兼容或迁移方案。

如果需要修改其中任何一条，那不是普通重构，而是格式、协议或系统边界迁移。

---

## 五、功能域边界

### 5.1 一级功能模块

当前一级功能模块：

```text
Meristem Core
M-Net
M-EventBus
M-Extension
M-UI
M-CLI
M-Log
M-Policy
```

明确不设为一级模块：

```text
M-Services
M-Perf
M-Identity
M-Secret
GraphQL
```

说明：

- 微服务是实现形态，不是 M-Services 模块。
- 性能是各模块内部实现策略，不设 M-Perf。
- 身份归 Core 基础能力。
- 密钥归 Core 管理、M-Policy 授权、M-Log 审计。
- GraphQL 当前移除。

### 5.2 M-Net

M-Net 是组网与互联子系统。职责包括节点互联、路径选择、网络策略、DERP / UDP / TCP 策略、节点可达性、Leaf Node 互联范围控制和区域网络适配。

当前默认设计：

- Core 上运行 Headscale DERP Server。
- 默认优先 UDP。
- 使用 Tailscale 公共 DERP 作为 fallback。
- 公共 DERP fallback 可配置、可关闭。
- `M-Net` 完成后不直接把内部控制或总线端口暴露公网。
- 目标部署只保留一个供节点加入的公网入口；其余内部端口应保持 private 或 loopback-only。

M-Net CN 是第一个 Regional Network Profile，属于 M-Extension 范畴，用于应对特殊网络环境。

### 5.3 M-EventBus

M-EventBus 是事件、命令、同步与互联信息的总线，底层主干为 NATS。

边界：

```text
M-Net 负责实际组网。
M-EventBus 负责互联信息、网络事件、状态同步与策略通知。
```

### 5.4 M-Log

M-Log 是日志、时间线、完整日志、审计和 AI 分析层。它不是 OpenTelemetry 的替代品。

```text
OpenTelemetry = traces / metrics / logs 的采集与关联层
M-Log = Meristem 自身的日志、时间线、完整日志、审计和 AI 分析层
```

### 5.5 M-Policy

M-Policy 是权限、策略、风险评估与多元决策模块。

第一阶段以 RBAC 为基础，后续扩展置信度、置疑度、多元决策、行为异常算法、小模型辅助和 LLM 辅助分析。

### 5.6 M-Extension

M-Extension 是补充扩展机制，不是主要功能承载层。功能优先由微服务实现。

适合场景：

- 特殊运行时扩展
- Wasm 扩展
- 特殊 UI 扩展
- 特殊节点能力
- 第三方集成
- 便携执行单元
- 云函数类轻量扩展

---

## 六、错误处理与降级

### 6.1 错误呈现原则

Meristem 的错误呈现必须诚实、可追溯、保守。错误 UI 不使用 Toast 或无上下文红色 Banner。错误块必须说明：

- 发生了什么
- 影响范围是什么
- 系统采取了什么保守行为
- 可追踪的 event / log / audit / trace ID 是什么
- 用户下一步能做什么

### 6.2 故障模式矩阵

| 故障 | 预期行为 |
|------|----------|
| Core 部分非关键服务失败 | Core 进入 degraded mode，其他服务继续运行 |
| Core 关键入口失败 | 阻断高风险操作，保留安全模式 |
| M-Log Timeline 失败 | Timeline 标记 degraded，Full / Audit 不受影响 |
| M-Log Full Log 失败 | Full Log 查询降级，Timeline / Audit 继续工作 |
| Audit Log 失败 | 阻断高权限和高风险操作 |
| M-Policy RBAC 失败 | 默认拒绝高权限操作，系统进入保守模式 |
| M-Policy 风险算法失败 | 回退 RBAC + 操作危险等级 + 保守策略 |
| LLM 不可用 | 不阻断普通操作；高风险操作转人工或多方审批 |
| OpenSearch 不可用 | 写模型不受影响，查询和分析降级 |
| NATS / M-EventBus 部分不可用 | 依赖事件的能力降级，关键状态不得只依赖事件 |
| NATS KV 不可用 | 依赖缓存的功能降级，必要时回退 Redis / KeyDB 或禁用高级能力 |
| Redis / KeyDB 不可用 | 回退 NATS KV 或禁用依赖复杂缓存语义的能力 |
| M-Net Core DERP 不可用 | 尝试公共 DERP fallback 或区域 profile |
| Tailscale 公共 DERP 不可用 | 保持已有连接，标记 fallback degraded |
| M-Net CN 亚洲 Stem 不可用 | 回退 Core DERP 或公共 fallback；大陆无公网节点可能进入受限模式 |
| Stem Node 离线 | 重新分配任务，相关 Leaf Node 进入等待或降级 |
| Leaf Node 异常 | 终止任务或收缩权限，记录 Audit / Full Log |
| 微服务热重载失败 | 回滚上一版本或隔离该服务 |
| M-Extension 异常 | 禁用扩展并隔离，不影响 Core |
| Webhook 验证失败 | 拒绝请求并记录 Full / Audit Log |
| 密钥访问异常 | 触发 M-Policy，写入 Audit Log |

---

## 七、安全与依赖治理

### 7.1 威胁模型

主要威胁：

```text
恶意 Leaf Node
被盗用户账号
异常 Stem Node
被篡改微服务
M-Extension 滥权
日志篡改
审计绕过
密钥泄露
Webhook 伪造
LLM prompt injection
公共 DERP fallback 风险
M-Net CN 中继风险
OpenSearch 读模型泄露
NATS subject 滥用
```

基础安全原则：

- Leaf Node 默认最小权限。
- M-Extension 默认低权限。
- 高权限能力默认拒绝，必须显式授权。
- 高风险操作必须经过 M-Policy。
- Audit Log 独立高权限实现。
- LLM 不作为授权根。
- Webhook 必须验证来源。
- 密钥访问必须经 M-Policy。
- 公共 DERP fallback 必须可关闭。
- M-Net CN 必须可审计。

### 7.2 依赖与许可策略

Meristem Core 计划使用 BSD-3 协议。

依赖治理原则：

- Core 代码使用 BSD-3。
- 所有依赖必须进行 license review。
- 可选部署组件不得污染 Core license。
- 第三方服务必须明确是否为必需依赖。
- M-Extension 允许独立 license，但必须声明。
- 引入新基础设施前必须说明是否进入默认依赖。

---

## 八、代码规范与完成标准

### 8.1 TypeScript strict

必须开启 TypeScript strict 模式。严禁 `any`。未知类型使用 `unknown`，并通过 schema、类型守卫或契约收窄。

### 8.2 注释要求

要求：

- 代码块级注释
- 函数注释
- Elysia 方法链特别注释
- 注释优先解释边界、契约、故障处理和安全原因
- 文档规则落到代码时，应在必要注释中引用来源章节

Elysia 方法链需要特别注释，避免复杂链式调用变成不可读黑盒。

### 8.3 FIXME

需要在以下场景使用 FIXME：

- 临时方案
- 已知技术债
- 未完成安全边界
- 临时降级路径
- 尚未处理的异常情况
- 未来必须修复的问题

### 8.4 编程风格

要求：

- 遵守函数式编程思想。
- 避免复杂抽象。
- 重视人类可读性。
- 优先纯函数。
- 副作用集中在边界层。
- 不为了抽象而抽象。

### 8.4.1 Effect 使用规则

Effect 是复杂内部 workflow 和 executable contract 的默认工具，但不是格式统一工具。

必须优先使用 Effect 的场景：

- 多个外部依赖按顺序协作，且任何一步失败都需要明确映射。
- 涉及 retry、timeout、cancellation、resource cleanup 或 lifecycle。
- 事件消费者、日志 pipeline、projection/backfill worker、service reload、node-agent task assignment。
- M-Policy 决策流程中读取权限、写入决策事实、写日志或跨服务调用的部分。
- 需要 `Effect.Service` / `Layer` 支持 production adapter 与 test adapter 的端口。
- 需要 Effect Schema 表达跨服务、跨节点、跨时间存在的内部契约。

不应使用 Effect 的场景：

- 单个纯数据映射。
- 简单同步 predicate / formatter / parser，除非它承载版本化契约。
- Elysia handler 仅做 HTTP 参数转发且无复杂失败语义。

Elysia handler 的目标形态：

```text
HTTP schema validation
-> actor / correlationId extraction
-> call Effect workflow or pure domain function
-> map typed domain error to documented error envelope
-> return REST/OpenAPI response
```

### 8.5 TDD

开发遵循 TDD：

- 先测试，再实现。
- 关键逻辑必须可测。
- 不同实现共享同一语义测试。
- 性能实现不能改变语义。

### 8.6 Definition of Done

任何核心能力完成前，必须满足：

```text
TypeScript strict 通过。
无 any。
有测试。
有必要注释。
Elysia 方法链有说明。
有错误路径测试。
有日志行为。
必要时有 Audit Log。
必要时有 M-Policy 检查。
必要时有 OpenTelemetry trace。
契约已版本化。
文档已更新。
```

微服务完成前，必须满足：

```text
Service Definition 已声明。
契约已声明。
权限已声明。
依赖已声明。
配置 schema 已声明或明确不需要。
健康检查已实现。
日志行为已声明。
热重载能力已声明。
降级策略已声明。
```

高权限能力完成前，必须满足：

```text
M-Policy 检查已接入。
Audit Log 已接入。
失败模式已定义。
回滚或降级策略已定义。
必要时触发多元决策。
LLM 仅作为辅助分析，不作为授权根。
```

---

## 九、术语表

| 术语 | 定义 |
|------|------|
| Meristem | 整个项目与系统名称 |
| M 网络 | Meristem 形成的多节点统一管理网络 |
| Core Node | 运行 Meristem Core 的主控节点，也可以同时作为 Stem Node |
| Stem Node | M 网络中的长期节点，承担主要任务和网络功能 |
| Leaf Node | 临时、任务驱动、低权限、受限 API、受限互联的节点 |
| Meristem Core | 微内核化核心，负责 bootstrap、基础身份、服务生命周期入口、REST/OpenAPI、Eden 聚合、M-CLI 入口和安全模式 |
| M-Net | 组网与互联功能域，负责节点互联、路径选择、DERP/UDP/TCP 策略、区域网络 profile |
| M-EventBus | 事件、命令、同步与互联信息总线，底层主干为 NATS |
| M-Log | 日志功能域，包含 Timeline Log、Full Log、Audit Log |
| M-Policy | 权限、策略、RBAC、置信度、置疑度、多元决策功能域 |
| M-UI | 基于 SvelteKit + SDUI 的界面层 |
| M-CLI | Core 直接提供的官方命令行入口 |
| M-Extension | 当微服务无法满足扩展目标时使用的补充扩展机制 |
| Eden Contract | 内部 TS 服务优先使用的类型安全契约 |
| REST + OpenAPI | 对外 API 形式，RESTful API 文档必须同步更新 |
| Timeline Log | 面向团队多数成员的人类友好时间线日志 |
| Full Log | 面向运维与 AI 的完整分类日志 |
| Audit Log | 独立实现的高权限审计日志 |
| 置信度 | 对当前操作主体可信程度的正向评估 |
| 置疑度 | 对当前操作是否可疑、异常或危险的评估，必须参考置信度，但不等于 `1 - 置信度` |
| 多元决策 | 高权限、高风险或高置疑度操作触发的综合决策流程 |
| Regional Network Profile | M-Net 的区域网络策略抽象；M-Net CN 是第一个具体 profile |
