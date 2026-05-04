# MERISTEM-ROADMAP - 分阶段实现路线

> 这是 MERISTEM 的阶段计划文档。它承接 `MERISTEM.md` 的产品意图和 `MERISTEM-DEV.md` 的工程规范，防止第一版范围失控。
>
> 当路线图与 v0.1 护栏冲突时，以 v0.1 护栏为准。

---

## 1. 当前开发优先级

第一阶段不应尝试一次性实现所有能力。建议最小闭环：

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

MVP 的完整范围见 `docs/mvp/MVP-SPEC.md`。Phase 0-5 的可执行拆分见：

- `docs/roadmap/PHASE-0.md`
- `docs/roadmap/PHASE-1.md`
- `docs/roadmap/PHASE-2.md`
- `docs/roadmap/PHASE-3.md`
- `docs/roadmap/PHASE-4.md`
- `docs/roadmap/PHASE-5.md`

后续 Phase 应沿用同一结构：Scope、Target Files、Required Scripts、Completion Criteria、Verification Checklist。

---

## 2. v0.1 开发护栏

v0.1 阶段必须避免：

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

## 3. 分阶段实现路线

### 3.1 Phase 0：项目骨架与工程基线

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

### 3.2 Phase 1：Core 微内核与基础 API

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

### 3.3 Phase 2：M-EventBus 最小事件闭环

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

### 3.4 Phase 3：节点模型原型

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

### 3.5 Phase 4：M-Log 最小版

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

### 3.6 Phase 5：M-Policy RBAC 最小版

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

### 3.7 Phase 6：微服务生命周期与热重载原型

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

### 3.8 Phase 7：M-Net 基础互联原型

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

### 3.9 Phase 8：配置生命周期与热重载

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

### 3.10 Phase 9：OpenSearch 读模型与 Full Log

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

### 3.11 Phase 10：M-Policy 风险基础

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

### 3.12 Phase 11：多元决策与 LLM 辅助分析

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

### 3.13 Phase 12：M-Net CN 与区域网络 Profile

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

### 3.14 Phase 13：M-UI / SDUI 与 BFF

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

### 3.15 Phase 14：M-Extension 基础

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

### 3.16 Phase 15：可选部署能力

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

## 4. 能力分阶段路线

| 能力 | v0 | v1 | v2 | v3 |
|------|----|----|----|----|
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

## 5. ADR 候选索引

ADR 已拆分到 `docs/adr/`。本节保留为路线图索引，具体 Context / Decision / Consequences / Revisit 条件以对应 ADR 文件为准。

| ADR | 决策 |
|-----|------|
| ADR-001 | Meristem 采用 TypeScript-first |
| ADR-002 | Meristem 采用 Elysia-first |
| ADR-003 | 内部 TS 服务采用 Eden-first，但不是 Eden-only |
| ADR-004 | 对外 API 使用 REST + OpenAPI，移除 GraphQL |
| ADR-005 | 采用轻量现代微服务架构，不采用重型微服务栈优先 |
| ADR-006 | Core 采用微内核思想 |
| ADR-007 | M-Plugin 更名为 M-Extension |
| ADR-008 | 微服务是实现形态，不设置 M-Services 一级模块 |
| ADR-009 | M-EventBus 使用 NATS 作为主干 |
| ADR-010 | 写模型使用 RDBMS，暂定 PostgreSQL |
| ADR-011 | 读模型与搜索分析使用 OpenSearch |
| ADR-012 | 默认使用 NATS KV Cache，Redis / KeyDB 作为补充 |
| ADR-013 | M-Log 采用 Timeline / Full / Audit 三级日志系统 |
| ADR-014 | M-Policy 第一阶段以 RBAC 为基础，后续引入置信度、置疑度和多元决策 |
| ADR-015 | 引入 OpenTelemetry |
| ADR-016 | 引入 Effect，但不强制 Effect-everywhere |
| ADR-017 | APISIX 作为可选部署组件，不进入 Core 默认依赖 |
| ADR-018 | Temporal、Tekton、Raft、Jotai、Elasticsearch 当前放弃 |
| ADR-019 | 性能优化不设 M-Perf，作为各模块内部实现策略 |
| ADR-020 | 身份归 Core 基础能力，不设置 M-Identity |
| ADR-021 | 密钥归 Core 管理、M-Policy 授权、M-Log 审计，不设置 M-Secret |
| ADR-022 | SvelteKit 与 Elysia 进行路由级深度集成 |
| ADR-023 | M-Net 使用 Core DERP、UDP 优先、Tailscale 公共 DERP fallback 可选 |
| ADR-024 | M-Net CN 作为第一个 Regional Network Profile |

ADR 模板：

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
