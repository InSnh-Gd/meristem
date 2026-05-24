# Meristem vNext 开发文档 v0.1

> 状态：历史开发草案。当前实现规范以 `AGENTS.md`、`MERISTEM.md`、`MERISTEM-DESIGN.md`、`MERISTEM-DEV.md`、`MERISTEM-ROADMAP.md` 和 `docs/**` 契约文档为准。本文只用于追溯早期决策背景，不再作为当前代码生成、审查或实现的规范来源。
>
> 状态：第一版开发文档草案  
> 目标：统一 Meristem / M 网络的基础架构、工程规范、模块边界与第一阶段开发口径  
> 注意：本文档只定义当前已定下的基础框架与开发原则，不展开具体实现细节。

---

## 1. 项目定位

Meristem 是一个 **TypeScript-first、Elysia-first、Eden-first 但非 Eden-only、微服务优先、云原生友好的 Monorepo 分布式 M 网络控制系统**。

Meristem 网络简称为 **M 网络**。

M 网络由 Core Node、Stem Node、Leaf Node 三类节点组成，通过 M-Net 组织节点互联，通过 M-EventBus 承载事件、命令、同步和互联信息，通过 M-Log 提供三级日志与审计，通过 M-Policy 提供权限、策略、置信度、置疑度与多元决策，通过 M-UI 和 M-CLI 提供人机入口，通过 M-Extension 提供微服务无法满足时的补充扩展能力。

Meristem 不是 Wasm-first 项目，也不是插件优先系统。默认开发语言是 TypeScript，Wasm3、Wasmtime、WasmGC、Zig 仅作为隔离、可移植、高级运行时或性能增强手段。

---

## 2. 核心设计原则

### 2.1 TypeScript-first

Meristem 的默认开发语言是 TypeScript。

默认使用 TypeScript 的部分包括：

- Meristem Core
- 核心微服务
- 普通功能逻辑
- M-CLI
- M-UI
- 内部契约
- 测试体系
- 工具链

Wasm / Zig 只在明确需要时引入，例如：

- 性能关键路径
- 强隔离执行
- 低资源节点执行
- 特殊运行时能力
- Wasm Component / WasmGC 场景

### 2.2 Elysia-first

Meristem 后端主体采用 ElysiaJS，并尽可能应用 Elysia 的设计思想。

包括：

- Elysia 方法链
- Elysia 插件机制
- Elysia schema
- Elysia 生命周期
- Elysia 类型推导
- Elysia + Eden 契约

Elysia 不只是 HTTP 框架，而是 Meristem 后端服务组织方式的重要基础。

### 2.3 Eden-first，但非 Eden-only

内部 TypeScript 服务优先使用 Eden 契约。

但 Eden 不是唯一契约。

契约体系暂定为：

| 场景 | 契约形式 |
|---|---|
| 内部 TS 服务 | Eden Contract |
| 外部 API | REST + OpenAPI |
| M-EventBus 事件 | Event Schema |
| 跨语言 / 跨运行时 | REST + OpenAPI / Event Schema |
| Wasm / Component Model | 后续按需考虑 WIT |

### 2.4 微服务优先，但不是重型微服务栈优先

Meristem 采用轻量现代微服务架构。

原则：

1. 微服务优先，但不采用重型微服务栈优先。
2. 核心微服务位于 Monorepo 内，由统一工程规范管理。
3. 内部 TS 服务优先 Eden 契约，对外 REST + OpenAPI。
4. 每个微服务必须声明契约、权限、依赖、配置、生命周期和日志行为。
5. 微服务必须支持健康检查和可观测性。
6. 微服务失败不得拖垮 Core 和其他微服务。
7. 微服务热重载必须有降级和回滚语义。
8. 服务间通信优先使用明确契约和 M-EventBus，不允许隐式强耦合。
9. 不默认引入 service mesh、gRPC everywhere、每服务独立数据库等重型方案。
10. 现代微服务能力应以轻量、可读、可测试的方式引入。

### 2.5 微内核 Core

Core 采用微内核思想。

Core 负责最小核心骨架、服务协调、入口聚合与安全基础，不直接承载大量业务逻辑。

复杂能力应下沉到各 M-* 子系统或微服务中。

---

## 3. Monorepo 决策

整个项目采用 Monorepo。

主仓库暂定为：

```text
Meristem
```

原则：

- Core 与核心微服务位于同一个 Monorepo 内。
- 统一工程规范。
- 统一契约管理。
- 统一测试体系。
- 统一文档规范。
- 统一代码风格。
- 统一构建与发布流程。

微服务不是独立的一级模块，而是各 M-* 子系统的主要实现形态。

---

## 4. M 网络节点模型

M 网络包含三类节点：

```text
Core Node
Stem Node
Leaf Node
```

### 4.1 Core Node

Core Node 运行 Meristem Core，是 M 网络中的主控节点。

职责：

- 运行 Meristem Core
- 提供主控能力
- 提供 M-CLI
- 提供 REST + OpenAPI
- 聚合内部 Eden 契约
- 管理基础身份
- 管理核心配置
- 协调其他节点
- 运行 Core 侧 M-Net 基础能力
- 可同时作为 Stem Node

### 4.2 Stem Node

Stem Node 是 M 网络中的长期节点。

职责：

- 长期在线
- 承担大多数任务
- 承担网络功能
- 承载微服务
- 协助 Leaf Node
- 承担区域中继能力

Stem Node 是 M 网络的长期基础设施节点。

### 4.3 Leaf Node

Leaf Node 是临时、任务驱动节点。

默认特征：

- 快速创建
- 快速加入
- 低权限
- 受限 API
- 受限互联
- 默认仅与任务关系相关节点互联

Leaf Node 可以显式扩展：

- 权限扩展
- API 扩展
- 互联范围扩展

原则：

```text
默认最小能力
显式扩展
可授权
可审计
可撤销
```

---

## 5. 一级功能模块

当前一级功能模块暂定为：

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

---

## 6. Meristem Core

Core 是 Meristem 的微内核。

Core 负责：

- bootstrap
- 基础配置
- 基础身份
- 服务生命周期入口
- Elysia app composition
- REST + OpenAPI
- 内部 Eden 契约聚合
- M-CLI 入口
- 安全模式
- 最小日志入口
- 最小策略入口

Core 不负责承载大量业务能力。

复杂功能由各 M-* 子系统或其微服务实现。

---

## 7. M-Net

M-Net 是 M 网络的组网与互联子系统。

职责：

- 节点互联
- 路径选择
- 网络策略
- DERP / UDP / TCP 策略
- 节点可达性
- Leaf Node 互联范围控制
- 区域网络适配

### 7.1 默认网络设计

当前设计：

- Core 上运行 Headscale DERP Server。
- 默认优先 UDP。
- 使用 Tailscale 公共 DERP 作为 fallback。
- 公共 DERP fallback 应可配置、可关闭。

### 7.2 M-Net CN

M-Net CN 是 M-Net 的区域网络扩展 / profile，属于 M-Extension 范畴。

目标：

- 应对 GFW 等特殊网络环境。

设计：

- 亚洲地区 Stem Node 承担 DERP Server。
- 大陆地区无公网节点强制使用 TCP 互联。
- 亚洲 Stem Node 也通过 TCP 与 Core Node 互联。

---

## 8. M-EventBus

M-EventBus 是事件、命令、同步与互联信息的总线。

底层主干：

```text
NATS
```

采用 EDA 事件驱动架构思想。

职责：

- 事件流
- 命令流
- 同步信号
- 服务间异步协作
- 节点状态事件
- 配置变更事件
- 网络互联信息事件
- 审计相关事件通知

M-EventBus 可以处理互联信息，例如：

- 节点可达性事件
- 网络路径变化事件
- DERP fallback 事件
- M-Net CN 事件
- UDP/TCP 切换事件
- Stem Relay 状态
- Leaf Node 互联范围变更
- 网络策略发布通知

边界：

```text
M-Net 负责实际组网。
M-EventBus 负责互联信息、网络事件、状态同步与策略通知。
```

---

## 9. M-Log

M-Log 是 Meristem 的一级重要能力。

采用三级日志系统：

```text
Timeline Log
Full Log
Audit Log
```

### 9.1 Timeline Log

面向团队多数成员。

特征：

- 时间线形式
- 关键事件
- 概括日志
- 人类友好
- 直观展示系统状态

### 9.2 Full Log

完整记录日志。

包括：

- 网络内部日志
- 外部传递日志
- Core 日志
- 微服务日志
- M-Net 日志
- M-EventBus 日志
- 节点日志
- 任务日志
- 错误日志
- 状态同步日志

面向：

- 运维
- AI 分析
- 故障排查
- 完整检索

### 9.3 Audit Log

Audit Log 独立实现，是高权限系统。

记录：

- 关键变动
- 高权限操作
- 权限变更
- 配置发布
- 服务启停
- 节点授权
- Leaf Node 扩展
- M-Net 策略变更
- 审计相关操作

Audit Log 不能只是 Full Log 的普通分类。

---

## 10. M-Policy

M-Policy 是 Meristem 的权限、策略、风险评估与多元决策模块。

职责：

- RBAC
- 权限判断
- 策略判断
- 置信度计算
- 置疑度计算
- 高风险操作判断
- 多元决策
- LLM 辅助分析触发
- 密钥访问授权

第一阶段以 RBAC 为基础。

后续扩展：

- 置信度
- 置疑度
- 多元决策
- 行为异常算法
- 小模型辅助
- LLM 辅助分析

### 10.1 置信度

置信度根据以下因素计算：

- 行动节点
- 操作用户
- 上下文环境
- 历史可信状态
- 当前会话状态

置信度表示系统对当前操作主体可信程度的正向评估。

### 10.2 置疑度

置疑度根据以下因素计算：

- 审计日志中的节点行为
- 审计日志中的用户操作
- 用户操作危险性
- 长期行为异常
- 短期行为异常
- 置信度

重要原则：

```text
置疑度必须参考置信度。
置疑度不等于 1 - 置信度。
```

### 10.3 置疑度算法

第一版置疑度采用精心设计的可解释算法。

不优先依赖小模型。

后续可以引入 CPU 闲时训练的小模型，用于增强长期行为异常检测。

小模型只输出风险信号，不做最终授权。

### 10.4 多元决策系统

触发条件：

- 高权限操作
- 高风险操作
- 置疑度过高
- 策略指定需要多元决策

多元决策可引入：

- 基础权限规则
- 操作危险性
- 置信度
- 置疑度
- 审计历史
- 策略规则
- LLM 分析
- 人类审批
- 多方确认
- 执行窗口
- 环境状态
- 降级策略

LLM 的角色：

- 辅助分析
- 风险解释
- 日志总结
- 行为异常解释
- 操作影响说明
- 审批建议

LLM 不作为最终授权根。

多元决策结果可以是：

- allow
- deny
- require_mfa
- require_single_approval
- require_multi_approval
- require_llm_summary
- require_manual_review
- require_delay
- require_limited_scope
- require_readonly_mode
- require_core_node_only
- require_audit_lock

多元决策过程必须写入 Audit Log。

---

## 11. M-UI

M-UI 使用：

```text
SvelteKit + SDUI
```

SvelteKit 与 Elysia 服务端深度集成。

当前口径：

- 默认一体化部署。
- 路由级深度集成。
- Elysia 保留清晰 API prefix。
- SvelteKit 负责 UI / SSR / 前端资源。
- Elysia 负责 API / Eden / REST / Core 服务能力。
- 后续保留拆分部署可能性。

M-UI 本体只保留基础框架，具体 UI 主要由微服务或扩展提供。

---

## 12. M-CLI

M-CLI 是官方命令行入口，由 Core 直接提供。

定位：

- 官方命令行入口
- 与 Core 深度绑定
- 优先使用内部 Eden 契约
- 可通过 BFF 聚合后端能力

---

## 13. M-Extension

原 M-Plugin 已确认改名为 M-Extension。

M-Extension 是补充扩展机制，不是主要功能承载层。

功能优先由微服务实现。

只有当微服务无法很好满足扩展目的时，才使用 M-Extension。

适合场景：

- 特殊运行时扩展
- Wasm 扩展
- 特殊 UI 扩展
- 特殊节点能力
- 第三方集成
- 便携执行单元
- 云函数类轻量扩展

---

## 14. 状态、读写模型与搜索

### 14.1 写模型

写模型使用 RDBMS，暂定 PostgreSQL。

PostgreSQL 作为权威状态源方向暂定。

### 14.2 读模型

采用局部 CQRS，不全系统强制。

读模型按场景投影，使用 OpenSearch。

适合 CQRS 的地方：

- M-Log 查询
- Audit Log 查询
- Timeline 聚合
- 节点状态看板
- M-Policy 行为分析
- M-Net 网络状态视图

### 14.3 OpenSearch

OpenSearch 用于：

- 日志检索
- 读模型搜索
- 分析查询
- AI 日志分析前置检索

Elasticsearch 已放弃，替换为 OpenSearch。

---

## 15. KV / Cache

默认优先使用：

```text
MATS / NATS KV Cache
```

当 NATS KV Cache 不够用时，引入：

```text
Redis / KeyDB
```

适用场景：

- 复杂缓存语义
- 高频限流
- 复杂 distributed lock
- sorted set
- 特殊 session / ephemeral state
- 外部组件需要 Redis 协议

Redis / KeyDB 不是默认基础依赖，而是补充后端。

---

## 16. 可观测性

确认引入 OpenTelemetry。

定位：

```text
OpenTelemetry = traces / metrics / logs 的采集与关联层
M-Log = Meristem 自身的日志、时间线、完整日志、审计和 AI 分析层
```

OpenTelemetry 用于：

- Core tracing
- M-* 微服务 tracing
- M-EventBus correlation id
- M-Net path telemetry
- M-Policy decision trace
- M-Log ingestion

---

## 17. Effect

确认引入 Effect，但不滥用。

适合：

- 复杂副作用
- 错误建模
- 资源管理
- 重试 / 超时 / 取消
- 服务生命周期
- 事件消费者
- M-Policy 决策流程
- M-Log pipeline

简单代码不要求全部 Effect 化。

---

## 18. BFF

确认引入 BFF，基于 Eden。

主要用于：

- M-UI BFF
- M-CLI BFF

原则：

- 权限感知
- 聚合后端数据
- 提供更适合 UI / CLI 的接口
- 基于 Eden 契约

---

## 19. Webhook 与云函数

### 19.1 Webhook

确认引入 Webhook。

用于：

- 外部系统通知
- CI/CD 回调
- 告警接入
- 第三方平台集成
- LLM tool callback
- 外部自动化触发

### 19.2 云函数

云函数暂不作为核心能力完整引入。

定位：

```text
后续 M-Extension / 轻量事件响应扩展形态
```

---

## 20. APISIX

APISIX 作为可选部署组件。

不进入 Core 默认依赖。

定位：

- 可选 API Gateway
- 边缘网关
- 生产入口组件

适合：

- TLS 终止
- 限流
- 认证前置
- Webhook 入口
- 灰度
- 流量控制
- 多 Core / 多实例入口

---

## 21. 内部通信方式

不默认引入 RPC。

内部通信使用组合方式：

### 21.1 Eden HTTP

用于：

- TS 内部同步接口
- Core 到微服务
- M-UI BFF
- M-CLI BFF

### 21.2 M-EventBus / NATS

用于：

- 异步事件
- 命令分发
- 状态变化通知
- 网络互联信息
- 服务生命周期事件

### 21.3 Shared packages

用于 Monorepo 内共享：

- 纯函数
- schema
- validator
- policy
- parser
- event envelope helper

### 21.4 REST / Webhook

用于：

- 外部系统
- 跨语言简单接入

### 21.5 WIT / Component Model

后续按需用于：

- Wasm
- 跨语言边界

---

## 22. 服务生命周期与热重载

微服务必须支持：

- 健康检查
- 可观测性
- 热重载
- 故障隔离
- 降级
- 回滚

微服务失败时：

- 不能拖垮 Core
- 不能拖垮其他微服务
- 必须有降级或隔离策略

热重载对象包括：

- 微服务
- 配置
- 扩展
- UI schema

---

## 23. 密钥管理

不设独立 M-Secret 模块。

密钥能力分配：

### Core

负责：

- 密钥基础管理
- secretRef
- 服务凭证
- 节点凭证
- API token
- 密钥加载与轮换入口

### M-Policy

负责：

- 密钥访问授权
- 高风险密钥操作决策
- 导出 / 读取 / 使用 / 轮换权限

### M-Log

负责：

- 密钥操作审计

---

## 24. AI Native

AI Native 是增强方向。

用途：

- 日志总结
- 异常归因
- 故障线索提取
- 事件链路解释
- 高风险操作摘要
- 运维建议
- 网络异常分析
- 审计事件解释
- 多元决策辅助分析

原则：

- AI 不替代日志事实。
- AI 不作为审计事实来源。
- AI 不作为最终授权根。
- AI 分析结果必须可追溯到原始日志。

---

## 25. 明确放弃或暂不采用

当前明确放弃或不采用：

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

Elasticsearch 替换为 OpenSearch。

---

## 26. 代码规范

### 26.1 TypeScript strict

必须开启 TypeScript strict 模式。

严禁 any。

未知类型使用 unknown，并通过 schema、类型守卫或契约收窄。

### 26.2 注释要求

要求：

- 代码块级注释
- 函数注释
- Elysia 方法链特别注释

Elysia 方法链需要特别注释，避免复杂链式调用变成不可读黑盒。

### 26.3 FIXME

需要在以下场景使用 FIXME：

- 临时方案
- 已知技术债
- 未完成安全边界
- 临时降级路径
- 尚未处理的异常情况
- 未来必须修复的问题

### 26.4 编程风格

要求：

- 遵守函数式编程思想
- 避免复杂抽象
- 重视人类可读性
- 优先纯函数
- 副作用集中在边界层
- 不为了抽象而抽象

### 26.5 TDD

开发遵循 TDD。

原则：

- 先测试，再实现。
- 关键逻辑必须可测。
- 不同实现共享同一语义测试。
- 性能实现不能改变语义。

---

## 27. 当前开发优先级建议

第一阶段不应尝试一次性实现所有能力。

建议最小闭环：

1. Core Node 最小启动
2. Elysia app composition
3. REST + OpenAPI 最小 API
4. Eden 内部契约样例
5. M-CLI 基础命令
6. 一个 Stem Node 加入流程原型
7. 一个 Leaf Node 任务驱动原型
8. M-EventBus 基础事件流
9. M-Log Timeline / Audit 最小版
10. M-Policy RBAC 最小版
11. 一个 TS 微服务热重载原型
12. OpenTelemetry 最小 tracing

---

## 28. 当前最终定义

Meristem 是一个 TypeScript-first、Elysia-first、Eden-first 但非 Eden-only、微服务优先的 Monorepo 分布式 M 网络控制系统。M 网络由 Core Node、Stem Node、Leaf Node 组成；Core Node 运行微内核化的 Meristem Core，Stem Node 作为长期节点承担主要任务和网络功能，Leaf Node 作为临时任务驱动节点以低权限、受限 API、受限互联方式加入，并可显式扩展权限、API 和互联范围。系统通过 M-Net 组织节点互联，通过 M-EventBus 承载事件、命令、同步和互联信息，通过 M-Log 提供 Timeline / Full / Audit 三级日志，通过 M-Policy 提供 RBAC、置信度、置疑度、多元决策和 LLM 辅助分析，通过 M-UI 与 M-CLI 提供人机入口，通过 M-Extension 提供微服务无法满足时的补充扩展。Meristem 使用轻量现代微服务架构，引入 OpenTelemetry、Effect、EDA、局部 CQRS、OpenSearch、BFF、Webhook，并将 APISIX、Redis/KeyDB 作为可选补充能力；同时放弃 GraphQL、Temporal、Tekton、Raft、Jotai、默认 Service Mesh、gRPC everywhere 和每服务独立数据库。


---

## 29. Glossary / 术语表

本节用于统一 Meristem / M 网络中的核心名词，避免后续设计和代码实现中出现口径漂移。

| 术语 | 定义 |
|---|---|
| Meristem | 整个项目与系统名称。 |
| M 网络 | Meristem 形成的多节点统一管理网络。 |
| Core Node | 运行 Meristem Core 的主控节点，也可以同时作为 Stem Node。 |
| Stem Node | M 网络中的长期节点，承担主要任务和网络功能。 |
| Leaf Node | 临时、任务驱动、低权限、受限 API、受限互联的节点，可显式扩展权限、API 和互联范围。 |
| Meristem Core | 微内核化核心，负责 bootstrap、基础身份、服务生命周期入口、REST/OpenAPI、Eden 聚合、M-CLI 入口和安全模式。 |
| M-Net | 组网与互联功能域，负责节点互联、路径选择、DERP/UDP/TCP 策略、区域网络 profile。 |
| M-EventBus | 事件、命令、同步与互联信息总线，底层主干为 NATS。 |
| M-Log | 日志功能域，包含 Timeline Log、Full Log、Audit Log。 |
| M-Policy | 权限、策略、RBAC、置信度、置疑度、多元决策功能域。 |
| M-UI | 基于 SvelteKit + SDUI 的界面层。 |
| M-CLI | Core 直接提供的官方命令行入口。 |
| M-Extension | 当微服务无法满足扩展目标时使用的补充扩展机制，原 M-Plugin 已废弃。 |
| 微服务 | Meristem 各 M-* 功能域的主要实现形态，不作为单独一级模块。 |
| Eden Contract | 内部 TS 服务优先使用的类型安全契约。 |
| REST + OpenAPI | 对外 API 形式，RESTful API 文档必须同步更新。 |
| Timeline Log | 面向团队多数成员的人类友好时间线日志。 |
| Full Log | 面向运维与 AI 的完整分类日志。 |
| Audit Log | 独立实现的高权限审计日志。 |
| 置信度 | 对当前操作主体可信程度的正向评估。 |
| 置疑度 | 对当前操作是否可疑、异常或危险的评估，必须参考置信度，但不等于 1 - 置信度。 |
| 多元决策 | 高权限、高风险或高置疑度操作触发的综合决策流程，可引入 LLM 辅助分析和人类审批。 |
| MATS / NATS KV Cache | 默认轻量 KV / cache 能力。Redis / KeyDB 仅在其不够用时作为补充后端。 |
| Regional Network Profile | M-Net 的区域网络策略抽象。M-Net CN 是第一个具体 profile。 |

命名原则：

```text
M-* 表示功能域。
微服务表示实现形态。
Extension 表示补充扩展机制。
Plugin 一词应尽量淡化或避免。
```

---

## 30. ADR Index / 架构决策索引

Meristem 需要维护 ADR（Architecture Decision Record）以记录关键架构选择。

建议目录：

```text
docs/adr/
```

当前已定下的 ADR 候选：

| ADR | 决策 |
|---|---|
| ADR-001 | Meristem 采用 TypeScript-first。 |
| ADR-002 | Meristem 采用 Elysia-first。 |
| ADR-003 | 内部 TS 服务采用 Eden-first，但不是 Eden-only。 |
| ADR-004 | 对外 API 使用 REST + OpenAPI，移除 GraphQL。 |
| ADR-005 | 采用轻量现代微服务架构，不采用重型微服务栈优先。 |
| ADR-006 | Core 采用微内核思想。 |
| ADR-007 | M-Plugin 更名为 M-Extension。 |
| ADR-008 | 微服务是实现形态，不设置 M-Services 一级模块。 |
| ADR-009 | M-EventBus 使用 NATS 作为主干。 |
| ADR-010 | 写模型使用 RDBMS，暂定 PostgreSQL。 |
| ADR-011 | 读模型与搜索分析使用 OpenSearch。 |
| ADR-012 | 默认使用 NATS KV Cache，Redis / KeyDB 作为补充。 |
| ADR-013 | M-Log 采用 Timeline / Full / Audit 三级日志系统。 |
| ADR-014 | M-Policy 第一阶段以 RBAC 为基础，后续引入置信度、置疑度和多元决策。 |
| ADR-015 | 引入 OpenTelemetry。 |
| ADR-016 | 引入 Effect，但不强制 Effect-everywhere。 |
| ADR-017 | APISIX 作为可选部署组件，不进入 Core 默认依赖。 |
| ADR-018 | Temporal、Tekton、Raft、Jotai、Elasticsearch 当前放弃。 |
| ADR-019 | 性能优化不设 M-Perf，作为各模块内部实现策略。 |
| ADR-020 | 身份归 Core 基础能力，不设置 M-Identity。 |
| ADR-021 | 密钥归 Core 管理、M-Policy 授权、M-Log 审计，不设置 M-Secret。 |
| ADR-022 | SvelteKit 与 Elysia 进行路由级深度集成。 |
| ADR-023 | M-Net 使用 Core DERP、UDP 优先、Tailscale 公共 DERP fallback 可选。 |
| ADR-024 | M-Net CN 作为第一个 Regional Network Profile。 |

ADR 模板建议：

```text
# ADR-XXX: 标题

## Status
Accepted / Proposed / Deprecated

## Context
为什么需要这个决策。

## Decision
具体决定。

## Consequences
影响、收益、代价、后续风险。
```

---

## 31. Core Boundary Rules / Core 边界规则

Core 是微内核，不是大而全业务单体。

### 31.1 Core 必须负责

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

### 31.2 Core 可以协调

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

### 31.3 Core 不应直接负责

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

### 31.4 Core 禁止成为隐式强耦合中心

Core 不应通过内部私有对象直接耦合所有 M-* 子系统。

跨子系统通信优先使用：

```text
明确 Eden 契约
明确事件 schema
明确 Service Definition
明确配置 schema
```

---

## 32. Service Definition / 微服务定义规范

每个微服务必须有明确服务定义。该定义可以先以文档形式存在，后续可演进为 `service.definition.ts` 或 `service.json`。

### 32.1 必填信息

```ts
type MServiceDefinition = {
  name: string;
  version: string;
  domain: "core" | "m-net" | "m-eventbus" | "m-log" | "m-policy" | "m-ui" | "m-cli" | "m-extension";
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

### 32.2 服务必须声明

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

### 32.3 服务禁止

- 隐式读取其他服务内部状态。
- 绕过 M-Policy 做高权限操作。
- 绕过 M-Log 执行关键变更。
- 通过未声明事件或未声明 API 建立隐式耦合。

---

## 33. State Classification / 状态分类

Meristem 必须明确区分权威状态、事件、缓存、读模型、协作草稿态和日志事实。

### 33.1 Authoritative State / 权威状态

权威状态暂定由 RDBMS 承载，当前方向为 PostgreSQL。

包括：

```text
用户
角色
权限
节点
服务定义
配置版本
密钥引用
任务记录
关键资源状态
```

### 33.2 Event State / 事件状态

由 M-EventBus 承载。

包括：

```text
任务事件
节点事件
服务生命周期事件
网络互联事件
配置发布事件
策略通知事件
```

事件不是权威数据库。

### 33.3 Cache State / 缓存状态

优先使用 NATS KV Cache。

Redis / KeyDB 仅在 NATS KV Cache 不够用时引入。

### 33.4 Read Model / 读模型

使用 OpenSearch 或其他投影形式。

包括：

```text
日志检索
Timeline 聚合
Audit 查询
节点状态看板
M-Policy 行为分析视图
M-Net 历史路径视图
```

OpenSearch 不是权威写模型。

### 33.5 Collaborative Draft State / 协作草稿态

Yjs 可用于协作态和配置草稿态。

Yjs 不是权威配置源。

### 33.6 Log Facts / 日志事实

M-Log 记录系统事实。

Audit Log 是高可信审计事实，不是 Full Log 的普通分类。

### 33.7 禁止混淆

```text
OpenSearch 不是权威状态源。
NATS KV 不是主数据库。
Yjs 不是权威配置源。
M-EventBus 不是日志存储。
Timeline Log 不是审计证据。
Full Log 不能替代 Audit Log。
```

---

## 34. Contract Versioning / 契约版本化

所有跨服务、跨节点、跨时间存在的契约都必须版本化。

需要版本化的对象包括：

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

```text
破坏性变更必须升级 major version。
非破坏性新增字段必须保持向后兼容。
事件 schema 必须保留 version 字段。
跨节点协议必须允许旧版本节点短期共存。
Core、Stem、Leaf、M-CLI、M-UI 不假设永远同版本。
```

事件 envelope 至少应预留：

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

`payload` 必须通过事件 schema 收窄，不能直接使用 `any`。

---

## 35. Config Lifecycle / 配置生命周期

配置热重载必须建立在版本化配置生命周期之上。

标准流程：

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

### 35.1 配置记录至少包含

```text
config_version
config_hash
schema_version
target_scope
published_by
published_at
applied_nodes
failed_nodes
rollback_version
```

### 35.2 适用对象

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

### 35.3 原则

```text
配置草稿可以协作编辑。
配置发布必须验证。
高风险配置发布必须经过 M-Policy。
关键配置发布必须写入 Audit Log。
节点应用配置后必须 ack。
失败节点必须可追踪。
配置必须可回滚。
```

---

## 36. Failure Mode Matrix / 故障模式矩阵

Meristem 必须明确各类故障下的预期行为。

| 故障 | 预期行为 |
|---|---|
| Core 部分非关键服务失败 | Core 进入 degraded mode，其他服务继续运行。 |
| Core 关键入口失败 | 阻断高风险操作，保留安全模式。 |
| M-Log Timeline 失败 | Timeline 标记 degraded，Full / Audit 不受影响。 |
| M-Log Full Log 失败 | Full Log 查询降级，Timeline / Audit 继续工作。 |
| Audit Log 失败 | 阻断高权限和高风险操作。 |
| M-Policy RBAC 失败 | 默认拒绝高权限操作，系统进入保守模式。 |
| M-Policy 风险算法失败 | 回退 RBAC + 操作危险等级 + 保守策略。 |
| LLM 不可用 | 不阻断普通操作；高风险操作转人工或多方审批。 |
| OpenSearch 不可用 | 写模型不受影响，查询和分析降级。 |
| NATS / M-EventBus 部分不可用 | 依赖事件的能力降级，关键状态不得只依赖事件。 |
| NATS KV 不可用 | 依赖缓存的功能降级，必要时回退 Redis / KeyDB 或禁用高级能力。 |
| Redis / KeyDB 不可用 | 回退 NATS KV 或禁用依赖复杂缓存语义的能力。 |
| M-Net Core DERP 不可用 | 尝试公共 DERP fallback 或区域 profile。 |
| Tailscale 公共 DERP 不可用 | 保持已有连接，标记 fallback degraded。 |
| M-Net CN 亚洲 Stem 不可用 | 回退 Core DERP 或公共 fallback；大陆无公网节点可能进入受限模式。 |
| Stem Node 离线 | 重新分配任务，相关 Leaf Node 进入等待或降级。 |
| Leaf Node 异常 | 终止任务或收缩权限，记录 Audit / Full Log。 |
| 微服务热重载失败 | 回滚上一版本或隔离该服务。 |
| M-Extension 异常 | 禁用扩展并隔离，不影响 Core。 |
| Webhook 验证失败 | 拒绝请求并记录 Full / Audit Log。 |
| 密钥访问异常 | 触发 M-Policy，写入 Audit Log。 |

---

## 37. Threat Model / 威胁模型

Meristem 需要在设计阶段明确基础威胁模型。

### 37.1 主要威胁

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

### 37.2 基础安全原则

```text
Leaf Node 默认最小权限。
M-Extension 默认低权限。
高权限能力默认拒绝，必须显式授权。
高风险操作必须经过 M-Policy。
Audit Log 独立高权限实现。
LLM 不作为授权根。
Webhook 必须验证来源。
密钥访问必须经 M-Policy。
公共 DERP fallback 必须可关闭。
M-Net CN 必须可审计。
```

### 37.3 LLM 安全边界

LLM 只能做：

```text
总结
解释
归因
建议
审批辅助
```

LLM 不能做：

```text
最终授权
绕过 M-Policy
修改 Audit Log
直接执行高权限操作
替代审计事实
```

---

## 38. Dependency and License Policy / 依赖与许可策略

Meristem Core 计划使用 BSD-3 协议。

依赖治理原则：

```text
Core 代码使用 BSD-3。
所有依赖必须进行 license review。
可选部署组件不得污染 Core license。
第三方服务必须明确是否为必需依赖。
M-Extension 允许独立 license，但必须声明。
引入新基础设施前必须说明是否进入默认依赖。
```

当前依赖定位：

| 依赖 / 组件 | 定位 |
|---|---|
| Elysia | Core 后端主体框架。 |
| Eden | 内部 TS 契约优先方案。 |
| SvelteKit | M-UI 基础。 |
| NATS | M-EventBus 主干。 |
| PostgreSQL | 暂定权威写模型。 |
| OpenSearch | 读模型 / 搜索 / 日志检索。 |
| OpenTelemetry | 可观测性标准层。 |
| Effect | 复杂副作用与错误建模。 |
| APISIX | 可选 API Gateway，不进入 Core 默认依赖。 |
| Redis / KeyDB | NATS KV 不够用时的补充后端。 |
| Headscale / DERP | M-Net 组网基础方向。 |
| Wasm3 / Wasmtime / WasmGC / Zig | 隔离、运行时与性能增强手段。 |

明确放弃：

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

---

## 39. Implementation Roadmap / 分阶段实现路线

Meristem 必须分阶段实现，避免第一版过重。

### 39.1 Phase 0：项目骨架与工程基线

目标：建立 Monorepo、工程规范、最小运行骨架。

内容：

```text
Monorepo 初始化
TypeScript strict 配置
严禁 any 的 lint 规则
基础包结构
Elysia app 最小启动
OpenAPI 最小文档生成
测试框架
TDD 工作流
代码块级注释规范
函数注释规范
Elysia 方法链注释规范
FIXME / TODO / HACK 规范
基础 CI
```

完成标准：

```text
Core 可启动。
最小 REST API 可访问。
OpenAPI 文档可生成。
测试可运行。
strict TS 生效。
无 any 规则生效。
```

---

### 39.2 Phase 1：Core 微内核与基础 API

目标：形成 Core 微内核最小闭环。

内容：

```text
Core bootstrap
基础配置加载
基础身份占位
REST + OpenAPI 基础路由
内部 Eden 契约样例
M-CLI 基础命令
服务生命周期入口雏形
安全模式占位
密钥 secretRef 占位
```

完成标准：

```text
Core 可以通过 CLI 查询状态。
Core 暴露 REST + OpenAPI。
内部 Eden contract 示例可调用。
Core 可以注册一个示例微服务定义。
```

---

### 39.3 Phase 2：M-EventBus 最小事件闭环

目标：建立 NATS 基础事件流。

内容：

```text
NATS 接入
事件 envelope
事件 schema version
correlationId / causationId
基础 command / event 区分
服务生命周期事件
节点状态事件占位
M-EventBus 与 Core 集成
```

完成标准：

```text
Core 可以发布事件。
示例微服务可以订阅事件。
事件带 version 和 correlationId。
事件 schema 可测试。
```

---

### 39.4 Phase 3：节点模型原型

目标：实现 Core / Stem / Leaf 的最小概念闭环。

内容：

```text
Stem Node 注册原型
Leaf Node 临时加入原型
Leaf Node 任务驱动原型
Leaf Node 默认低权限标记
Leaf Node 受限 API 标记
Leaf Node 受限互联范围标记
节点状态事件接入 M-EventBus
```

完成标准：

```text
一个 Stem Node 可以注册。
一个 Leaf Node 可以临时加入。
Core 可以向 Leaf Node 分配一个简单任务。
任务完成后写入事件和日志。
```

---

### 39.5 Phase 4：M-Log 最小版

目标：建立日志基础。

内容：

```text
Timeline Log 最小实现
Audit Log 最小实现
Full Log 占位
Core 关键操作写入 Timeline
高权限占位操作写入 Audit
事件到日志的最小关联
OpenTelemetry 最小 trace 接入
```

完成标准：

```text
Core 启动可产生 Timeline Log。
节点加入可产生 Timeline Log。
关键操作可产生 Audit Log。
trace id 可与日志关联。
```

---

### 39.6 Phase 5：M-Policy RBAC 最小版

目标：建立基础权限系统。

内容：

```text
User
Role
Permission
Resource
Action
Node Scope
Service Scope
RBAC allow / deny
M-CLI 权限检查
REST API 权限检查
Audit Log 记录权限相关操作
```

完成标准：

```text
普通用户和管理员角色可区分。
受保护 API 需要权限。
权限拒绝写入 Full / Audit 日志。
```

---

### 39.7 Phase 6：微服务生命周期与热重载原型

目标：验证微服务优先架构。

内容：

```text
Service Definition 原型
服务注册
服务健康检查
服务 reload
服务 degraded 状态
服务 rollback 占位
服务失败隔离
服务日志接入 M-Log
服务事件接入 M-EventBus
Effect 用于复杂生命周期流程
```

完成标准：

```text
示例 TS 微服务可注册。
示例服务可热重载。
重载失败不会拖垮 Core。
服务状态可被 M-CLI 查询。
```

---

### 39.8 Phase 7：M-Net 基础互联原型

目标：建立 M-Net 最小网络能力。

内容：

```text
Core DERP 集成原型
UDP 优先策略占位
Tailscale 公共 DERP fallback 配置项
节点可达性事件
网络路径变化事件
Leaf Node 互联范围策略占位
```

完成标准：

```text
Core 可启动基础 DERP 能力。
节点可报告网络状态。
网络状态变化可进入 M-EventBus 和 M-Log。
公共 DERP fallback 可配置开启/关闭。
```

---

### 39.9 Phase 8：配置生命周期与热重载

目标：建立可版本化的配置发布流程。

内容：

```text
config draft
validate
commit
version
hash/sign 占位
publish
apply
ack
rollback 占位
配置变更事件
配置应用日志
```

完成标准：

```text
一个微服务配置可以发布新版本。
目标节点可以 ack。
失败节点可追踪。
配置可以回滚到上一版本。
```

---

### 39.10 Phase 9：OpenSearch 读模型与 Full Log

目标：建立读模型检索能力。

内容：

```text
OpenSearch 接入
Full Log 投影
Timeline 查询优化
Audit Log 检索投影
M-Net 状态读模型占位
M-Policy 行为分析读模型占位
```

完成标准：

```text
Full Log 可检索。
Audit Log 可按用户/节点/操作查询。
Timeline 可聚合展示。
OpenSearch 不影响权威写模型。
```

---

### 39.11 Phase 10：M-Policy 风险基础

目标：在 RBAC 基础上引入操作危险等级和可解释置疑度算法。

内容：

```text
操作危险等级 low / medium / high / critical
置信度字段预留
置疑度算法 v1
置疑度风险因子解释
高置疑度触发多元决策占位
LLM 分析占位
```

完成标准：

```text
高风险操作可被识别。
置疑度可计算。
置疑度输出主要风险因子。
高置疑度操作可触发 require_manual_review 或 require_multi_approval。
```

---

### 39.12 Phase 11：多元决策与 LLM 辅助分析

目标：建立高权限 / 高风险操作的多元决策流程。

内容：

```text
多元决策流程
LLM 分析入口
日志摘要输入
风险解释输出
人工审批占位
多方审批占位
决策过程写入 Audit Log
```

完成标准：

```text
高风险操作可以触发多元决策。
LLM 可以生成风险解释。
最终授权不依赖 LLM。
决策过程完整写入 Audit Log。
```

---

### 39.13 Phase 12：M-Net CN 与区域网络 Profile

目标：实现第一个区域网络 profile。

内容：

```text
Regional Network Profile 抽象
M-Net CN profile
亚洲 Stem DERP 配置
大陆无公网节点 TCP 强制策略
亚洲 Stem 到 Core TCP 策略
M-Net CN 事件
M-Net CN 日志
M-Net CN 审计
```

完成标准：

```text
M-Net CN 可作为可选 profile 启用。
启用过程受 M-Policy 管控。
大陆无公网节点可按 profile 使用 TCP 路径。
网络路径变化可被记录和查询。
```

---

### 39.14 Phase 13：M-UI / SDUI 与 BFF

目标：建立 UI 基础与 BFF 聚合能力。

内容：

```text
SvelteKit + Elysia 路由级集成
M-UI shell
Timeline Log 页面
节点状态页面
M-Policy 基础页面
M-CLI BFF
M-UI BFF
SDUI schema 原型
权限感知 UI
```

完成标准：

```text
M-UI 可展示 Timeline。
M-UI 可展示节点状态。
M-UI 可展示基础权限状态。
BFF 基于 Eden 调用后端。
```

---

### 39.15 Phase 14：M-Extension 基础

目标：建立补充扩展机制，但不让其成为主功能层。

内容：

```text
M-Extension manifest 原型
扩展能力声明
扩展权限声明
扩展启用 / 禁用
Wasm3 / Wasmtime 占位
Webhook-based extension
云函数类轻量扩展占位
```

完成标准：

```text
一个低权限扩展可以注册。
扩展权限受 M-Policy 管控。
扩展异常不会影响 Core。
扩展操作可写入 M-Log。
```

---

### 39.16 Phase 15：可选部署能力

目标：引入可选部署组件，不污染 Core 默认依赖。

内容：

```text
APISIX 部署文档
Redis / KeyDB adapter
OpenSearch 部署模板
NATS 部署模板
PostgreSQL 部署模板
Core + Stem + Leaf compose 示例
未来 Kubernetes 部署占位
```

完成标准：

```text
默认部署不强依赖 APISIX / Redis。
可选部署可以启用 APISIX。
NATS KV 不够用的场景可以切换 Redis / KeyDB adapter。
```

---

## 40. Capability Roadmap / 能力分阶段路线

能力路线用于防止范围失控。

| 能力 | v0 | v1 | v2 | v3 |
|---|---|---|---|---|
| Core | 最小启动、REST、OpenAPI | 服务生命周期入口 | 安全模式完善 | 多 Core 预留 |
| M-Net | 节点状态与 DERP 原型 | UDP / fallback 策略 | M-Net CN | 多区域 profile |
| M-EventBus | 基础事件 | schema/version/correlation | 互联信息事件 | Event Mesh 能力增强 |
| M-Log | Timeline + Audit 最小版 | Full Log + OpenSearch | AI 日志分析 | 长期日志画像 |
| M-Policy | RBAC | 操作危险等级 | 置信度 / 置疑度 | 多元决策 + LLM |
| M-UI | Shell + Timeline | 节点 / 权限页面 | SDUI | 扩展 UI |
| M-CLI | 基础状态命令 | 节点 / 服务命令 | 日志 / 策略命令 | 高级运维命令 |
| M-Extension | 占位 | 低权限扩展 | Wasm / Webhook 扩展 | 云函数类扩展 |
| OpenTelemetry | 最小 trace | 服务级 trace | 事件链路 trace | 决策链路 trace |
| OpenSearch | 暂不强制 | Full Log 检索 | 行为分析读模型 | AI 检索增强 |

---

## 41. v0.1 Development Guardrails / v0.1 开发护栏

v0.1 阶段必须避免以下问题：

```text
不要实现完整 M-Policy。
不要实现完整 LLM 决策。
不要实现完整 M-Net CN。
不要实现完整云函数平台。
不要引入默认 APISIX。
不要引入默认 Redis / KeyDB。
不要把 OpenSearch 当权威数据库。
不要把 M-EventBus 当日志存储。
不要把 Leaf Node 做成默认高权限节点。
不要把 Core 做成大单体。
不要为了抽象而抽象。
```

v0.1 阶段必须完成：

```text
Core 最小启动
REST + OpenAPI
Eden 契约样例
M-CLI 基础命令
M-EventBus 基础事件
Stem / Leaf 原型
Timeline / Audit 最小日志
RBAC 最小权限
微服务热重载原型
OpenTelemetry 最小 trace
```

---

## 42. Definition of Done / 完成标准

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
