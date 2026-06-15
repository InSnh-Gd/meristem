# MERISTEM - 产品文档

> 这是 MERISTEM 的**产品意图文档**。它回答：Meristem 是什么、为谁而做、核心体验是什么、以及它拒绝长成什么样。
>
> **文档优先级**：当本文档与 `MERISTEM-DESIGN.md` 或 `MERISTEM-DEV.md` 冲突时，以本文档为准。意图先改，视觉契约再跟上，实现最后跟上。
>
> **跨文档引用格式**：`产品文档 §X.Y` 引用本文件，`设计文档 §X.Y` 引用 `MERISTEM-DESIGN.md`，`开发文档 §X.Y` 引用 `MERISTEM-DEV.md`。

---

## 0. 这个产品要解决的问题

分布式自动化和节点控制系统常见的现有解法包括：重型 Kubernetes / Service Mesh 栈、插件优先的控制平台、孤立的脚本和 Webhook 自动化、以及需要跨多种语言和协议拼接的运维系统。它们的共同问题是：控制面太重、契约不清、审计链路不完整、节点权限难以收缩，并且很容易把业务逻辑、网络控制、日志、策略和扩展机制耦合成一个难以测试的大系统。

本产品的核心假设：

1. **控制系统必须先有边界，再有能力** - Core 只能是微内核，复杂能力必须进入明确的 M-* 功能域或微服务。
2. **分布式节点默认不可信** - Leaf Node 默认低权限、受限 API、受限互联，任何能力扩展都必须可授权、可审计、可撤销。
3. **契约和日志比框架更重要** - Eden、REST/OpenAPI、Event Schema、Service Definition、Audit Log 和 M-Policy 是系统长期可维护性的基础。
4. **现代微服务应轻量可读** - Meristem 采用微服务优先，但拒绝默认引入重型微服务栈、每服务独立数据库和复杂编排平台。

所有设计决策从这几条出发。如果某个改动让 Core 变重、让节点默认变强、让契约不可追踪，默认是改动有问题。

---

## 1. 一句话定位

MERISTEM 是一个 TypeScript-first、Elysia-first、Eden-first 但非 Eden-only、微服务优先的 Monorepo 分布式 Meristem 网络控制系统。

它不是 Wasm-first 项目，不是插件优先系统，不是 Kubernetes 替代品，也不是把所有能力塞进 Core 的平台单体。

---

## 2. 核心体验

### 2.1 用户打开产品的第一秒

用户首先看到的是：Meristem 网络的当前状态，包括 Core Node 健康状态、Stem / Leaf 节点概览、关键服务状态、最近 Timeline Log、需要关注的策略或审计事件。

这一刻的设计目标是：操作者无需理解全部内部实现，也能立即判断系统是否安全、是否降级、哪里需要处理。

### 2.2 唯一的核心交互

整个产品只有一个真正的交互：**在明确契约、权限和审计边界下，对 Meristem 网络中的节点、服务、配置和高风险操作做可追踪控制**。

M-UI、M-CLI、REST/OpenAPI、Eden Contract、M-EventBus 和 Webhook 都只是这个交互的入口或传输形式。任何入口都不能绕过 M-Policy、M-Log 和契约版本规则。

### 2.3 完成后的出口

用户完成核心流程后，会得到：

- 一个已注册、可观测、可审计的 Core / Stem / Leaf 节点状态变化
- 一个已声明契约、权限、依赖、配置和日志行为的微服务变化
- 一个经过验证、版本化、可回滚的配置发布
- 一个写入 Timeline / Full / Audit 的操作事实
- 一个明确的 allow / deny / require_* 决策结果

这个出口的标准是：系统状态变化可解释、可回放、可检索，并且不会因为单个微服务、扩展、LLM 或读模型失败而破坏 Core 的安全边界。

---

## 3. 用户旅程

```text
进入 M-UI 或 M-CLI
-> 查看 Core / 节点 / 服务 / 日志状态
-> 选择一个操作对象
-> 系统检查契约、权限、配置版本和风险
-> 执行或进入多元决策
-> 写入事件、日志、审计和 trace
-> 返回可解释结果
```

| 步骤 | 用户看到什么 | 用户做什么 | 异常/岔路 |
|------|-------------|-----------|----------|
| 入口 | Core 健康、节点概览、Timeline、风险提示 | 选择 M-UI 或 M-CLI 入口 | Core degraded 时只开放安全操作 |
| 对象选择 | 节点、服务、配置、策略或日志视图 | 进入目标对象详情 | 权限不足时显示拒绝原因，不暴露敏感细节 |
| 操作发起 | 操作摘要、影响范围、所需权限 | 确认或取消操作 | 高风险操作进入 M-Policy 多元决策 |
| 策略判断 | allow / deny / require_* 结果 | 按要求补充 MFA、审批或缩小范围 | LLM 不可用时转人工或保守策略 |
| 状态变更 | Timeline / Full / Audit / trace 关联结果 | 追踪执行结果 | 写模型不受 OpenSearch 降级影响 |
| 后续处理 | 相关日志、事件、配置版本和回滚入口 | 查询、回滚、继续操作 | Audit Log 失败时阻断高权限操作 |

---

## 4. 核心概念与领域模型

### 4.1 领域实体

MERISTEM 的核心领域实体：

1. **Meristem 网络** - Meristem 形成的多节点统一管理网络。
2. **Core Node** - 运行 Meristem Core 的主控节点，也可以同时作为 Stem Node。
3. **Stem Node** - 长期在线节点，承担主要任务、网络功能、微服务承载和区域中继能力。
4. **Leaf Node** - 临时、任务驱动、默认低权限、受限 API、受限互联的节点。
5. **Meristem Core** - 微内核化核心，负责 bootstrap、基础配置、基础身份、服务生命周期入口、REST/OpenAPI、Eden 聚合、M-CLI 入口和安全模式。
6. **M-* 功能域** - M-Net、M-EventBus、M-Log、M-Policy、M-Task、M-UI、M-CLI、M-Extension 等一级能力边界。
7. **Service Definition** - 微服务必须声明的契约、权限、依赖、配置、生命周期和日志行为。
8. **契约与事件** - Eden Contract、REST/OpenAPI、Event Schema、Webhook Payload、BFF Contract 等跨服务和跨节点边界。
9. **日志事实** - Timeline Log、Full Log、Audit Log 组成的三级日志系统。
10. **策略决策** - M-Policy 基于 RBAC、置信度、置疑度、多元决策和必要的人类审批给出的操作结果。

### 4.2 实体间的关系

```text
Meristem 网络
  ├─ Core Node
  │   └─ Meristem Core
  │       ├─ REST + OpenAPI / Eden / M-CLI
  │       ├─ M-Policy 最小入口
  │       ├─ M-Log 最小入口
  │       └─ 服务生命周期入口
  ├─ Stem Node
  │   ├─ 微服务承载
  │   ├─ 网络功能
  │   └─ 区域中继
  └─ Leaf Node
      ├─ 临时任务
      ├─ 受限 API
      └─ 受限互联

M-* 功能域通过明确契约、事件 schema、配置 schema 和 Service Definition 协作。
```

工程规范见 `MERISTEM-DEV.md`。分阶段路线见 `MERISTEM-ROADMAP.md`。

---

## 5. 品牌声音

### 5.1 语调特征

- **精确** - 优先使用可验证的边界、字段、状态和完成标准。
- **保守** - 面对权限、审计、密钥、节点互联和 LLM 自动化时默认收缩能力。
- **可追溯** - 重要结论必须指向契约、日志、审计、配置版本或原始事件。

### 5.2 写作边界

- 自动化能力必须能落到可审计的操作、契约和日志事实。
- LLM 表述保持在总结、解释、归因、建议和审批辅助范围内。
- M-Extension 表述为补充扩展机制，主能力仍由 M-* 功能域和微服务承载。
- 微服务表述为 M-* 功能域内的实现形态，强调契约协作而不是系统割裂。

### 5.3 人称与视角

- 面向操作者和开发者时使用第二人称。
- 架构和规范文档使用客观陈述。
- 审计、日志和策略结果使用系统事实视角。

---

## 6. 产品边界

Meristem 的产品边界由以下默认选择定义。任何偏离这些默认选择的方案，都需要先说明产品收益、审计影响、权限影响和迁移成本：

- Core 保持微内核职责，复杂能力进入明确的 M-* 功能域或微服务。
- M-Extension 是补充扩展机制，主功能由 M-* 功能域和微服务承载。
- 外部 API 默认使用 REST + OpenAPI，内部 TypeScript 调用优先 Eden，跨服务异步协作使用事件 schema。
- 微服务共享统一 Monorepo、契约、测试和数据边界，默认共享权威写模型而不是割裂为每服务独立数据库。
- PostgreSQL 承载权威写模型；OpenSearch、NATS KV、M-EventBus 和 Yjs 分别承载读模型、缓存、事件和协作草稿态。
- Leaf Node 默认低权限、受限 API、受限互联，能力扩展必须显式授权、可审计、可撤销。
- 高权限和高风险操作由 M-Policy 决策，并写入对应 M-Log / Audit Log 事实。
- APISIX、Redis / KeyDB、Wasm / Zig 是可选补充能力，不进入默认基础依赖。
- 抽象必须服务于契约清晰、测试可行、审计可追踪和实现可读。

---

## 7. 隐私、安全与数据原则

- 权威状态暂定存储在 PostgreSQL。
- 事件状态由 M-EventBus 承载，但事件不是权威数据库。
- 缓存优先使用 NATS KV；Redis / KeyDB 仅作为补充后端。
- 读模型和搜索使用 OpenSearch，但 OpenSearch 不是权威写模型。
- Audit Log 独立实现，不能只是 Full Log 的普通分类。
- 密钥由 Core 管理，M-Policy 授权，M-Log 审计；不单设 M-Secret 模块。
- 高权限和高风险操作必须进入 M-Policy，并在必要时写入 Audit Log。
- LLM 只能做总结、解释、归因、建议和审批辅助；不能做最终授权。
- Webhook 必须验证来源。
- 公共 DERP fallback 必须可配置、可关闭。

---

## 8. 变更日志

| 日期 | 版本 | 变更内容 | 变更人 |
|------|------|---------|--------|
| 2026-05-04 | v0.1 | 抽取产品意图初稿，并将历史开发草案从当前文档集移除 | Codex |
