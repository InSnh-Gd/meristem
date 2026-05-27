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

MVP 的完整范围见 `docs/mvp/MVP-SPEC.md`。MVP 与后续阶段的可执行拆分见：

- `docs/roadmap/PHASE-0.md`
- `docs/roadmap/PHASE-1.md`
- `docs/roadmap/PHASE-2.md`
- `docs/roadmap/PHASE-3.md`
- `docs/roadmap/PHASE-4.md`
- `docs/roadmap/PHASE-5.md`
- `docs/roadmap/PHASE-6.md`
- `docs/roadmap/PHASE-7.md`
- `docs/roadmap/PHASE-8.md`
- `docs/roadmap/PHASE-9.md`

执行文档编号当前采用临时双轨映射：

| 根路线图阶段 | 可执行文档 |
|--------------|------------|
| `Phase 6` 微服务生命周期与热重载原型 | `docs/roadmap/PHASE-7.md` |
| `Phase 7` M-Net 原型 / 更真实网络能力 | `docs/roadmap/PHASE-8.md` |
| `Phase 9` M-UI 功能演示控制室 | `docs/roadmap/PHASE-9.md` |

说明：

- `docs/roadmap/PHASE-6.md` 已用于已落地的逻辑网络阶段。
- `docs/roadmap/PHASE-9.md` 是真实 `node-agent` 运行时之后插入的 M-UI 功能演示阶段，不是最终前端设计阶段。
- `docs/roadmap/PHASE-11.md` 是 Phase 11 的执行总章，覆盖 M-Task 服务切换、M-Policy 风险基础和 v0.1 MVP closure。
- 根路线图保留早期双轨映射说明，执行文档通过映射表消除历史漂移。

后续 Phase 应沿用同一结构：Scope、Target Files、Required Scripts、Completion Criteria、Verification Checklist。

已明确延后但仍需追踪的 phase follow-up items 统一记录在 `docs/roadmap/DEFERRED-WORK.md`。实现这些事项前必须先更新对应 phase、ADR、服务定义或契约文档。

---

## 2. v0.1 开发护栏

v0.1 阶段通过正向范围收缩控制复杂度：

```text
M-Policy 只实现 RBAC 最小闭环。
LLM 只保留辅助分析和解释入口的后续空间。
M-Net 只实现基础互联原型和可选区域 profile 的文档边界。
云函数类能力只作为 M-Extension 后续方向保留。
默认依赖集中在 Bun、PostgreSQL、NATS 和必要的 OpenTelemetry 基线。
APISIX、Redis / KeyDB、Wasm / Zig 作为后续可选补充能力进入。
PostgreSQL 是权威写模型；OpenSearch 只作为读模型和搜索投影。
M-EventBus 承载事件和命令流，M-Log 承载日志事实。
Leaf Node 保持默认低权限、受限 API、受限互联。
Core 保持微内核职责，复杂能力进入 M-* 功能域或微服务。
抽象必须服务于契约清晰、测试可行和审计可追踪。
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

### 3.10 Phase 9：M-UI 功能演示控制室

目标：建立第一个可操作的 M-UI Functional Demo Shell，用真实前后端入口证明 Control Room Ledger 的最小闭环。

内容：

```text
SvelteKit apps/m-ui 最小 shell
Elysia services/m-ui-bff 薄聚合层
SDUI control-room route schema
三分区布局：navigation rail / primary surface / inspector / command well
Core status / nodes / services / Timeline / Audit access state 聚合
仅通过 Core REST v0 读取数据和执行命令
本地 demo token 输入或开发注入
operator 与 security-admin 两条角色演示路径
reachable Leaf 的 noop task CommandWell 控制动作
CommandWell 内二次确认
禁用命令的可见原因
BFF contract tests
Playwright 功能演示验收
```

完成标准：

```text
M-UI 可展示 Core、节点、服务、Timeline 和 Audit 访问状态。
M-UI BFF 不直连 M-Log / M-Policy / M-Net 内部 HTTP。
operator 可对 reachable Leaf 执行 noop。
权限不足、非 Leaf、不可达节点会显示 disabled reason。
命令成功后展示 task.id、policyDecisionId 和 correlationId。
security-admin 可演示 Audit 可见性。
Phase 9 UI 明确标记为功能演示壳，不作为最终前端设计。
```

### 3.11 Phase 10：OpenSearch 读模型与 Full Log

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

Phase 10.1 Projection Platform Track 任务列表见 `docs/roadmap/PHASE-10.1.md`。

### 3.12 Phase 11：M-Task 与 M-Policy 风险基础

目标：完成 M-Task 服务切换，把任务所有权从 Core-owned MVP workflow 迁到 M-Task，并在真实任务控制动作上引入 M-Policy 风险基础。

内容：

```text
Phase 11.1 M-Task Service Cutover
Phase 11.2 M-Policy Risk Foundation
Phase 11.3 End-to-End MVP Closure
services/m-task 独立 Bun 服务
packages/auth 共享认证边界
M-Task canonical external /api/v0/tasks
M-Task-owned PostgreSQL task state
M-Task-owned task lifecycle events
submit / best-effort cancel / timeout worker
retry policy-aware not_implemented_for_phase
操作危险等级 low / medium / high / critical
置疑度算法 v1 与风险因子解释
require_manual_review / require_multi_approval pending escalation
完整本地 post-MVP smoke
```

完成标准：

```text
M-Task 是 canonical task API、状态、事件和生命周期所有者。
Core 不再暴露 canonical task routes，也不再写 task state / lifecycle events / task log facts。
M-Task 通过 M-Net 协调 node-agent，不直接持有 node-agent session。
M-Task 自己验证 actor auth，并直接调用 M-Policy / M-Log。
任务操作可输出 danger level、suspicion score 和 risk factors。
高置疑度任务操作可触发 require_manual_review 或 require_multi_approval，并阻断执行。
MVP closure smoke 使用真实 Bun 进程、PostgreSQL、NATS、HTTP / WebSocket 边界跑通。
```

### 3.13 Phase 12：审批执行流

目标：把 Phase 11 的 Pending Policy Escalation 扩展为可执行审批工作流。Phase 12 只交付 Approval Execution Flow；LLM 辅助解释延后到正式 M-UI、读模型和审批上下文稳定之后。

内容：

```text
Phase 12A Approval Execution Flow
approval queue
approve / reject API
固定 quorum：manual_review 1 个 security-admin，multi_approval 2 个不同 security-admin
approval timeout
M-Policy-owned external approval REST
M-CLI approval commands
M-Task suspended operation
源服务 resume contract，不做 HTTP request replay
resume safety / stale / idempotency checks
approval lifecycle events
resume lifecycle events
决策过程写入 Audit Log
```

完成标准：

```text
Pending Policy Escalation 可进入审批队列。
人工审批和多方审批可以 approve / reject / expire。
审批通过后只能通过源服务 resume contract 恢复原操作。
审批拒绝后原操作保持不执行。
审批超时进入 expired，不等同于 reject。
原 actor 不能审批自己的 pending operation。
M-Task submit / cancel / retry 是 Phase 12A 唯一 origin scope。
决策过程和 resume attempt 完整写入 Audit Log。
LLM 不参与 Phase 12 完成标准。
```

Phase 12 执行规格见 `docs/roadmap/PHASE-12.md`。

### 3.14 Phase 13：M-Net CN 与区域网络 Profile

目标：实现第一个区域网络 profile 的控制面、审批和审计闭环，不实现真实 DERP / TCP / UDP 数据面。

内容：

```text
Regional Network Profile 抽象
M-Net CN control-plane profile
per-network enable / disable
M-Net-owned external profile REST
M-CLI network profile commands
M-Net-owned profile state and transitions
M-Net suspended enable operation
Phase 12 approval required for enable
M-Policy allow + Audit for disable
controlPlaneOnly profile capability
M-Net CN 事件
M-Net CN 日志
M-Net CN 审计
```

完成标准：

```text
M-Net CN 可作为可选 per-network profile 启用。
启用过程进入 Phase 12 approval flow。
禁用过程可立即回退到 m-net-default@0.1.0，但仍需 M-Policy allow + Audit。
profileVersion、状态转换、事件和日志可被记录和查询。
Phase 13 不声明真实网络传输路径已经改变。
```

Phase 13 执行规格见 `docs/roadmap/PHASE-13.md`。ADR-024 只接受控制面 Regional Profile lifecycle，数据面能力延后。

### 3.15 Phase 14：正式 M-UI / SDUI 与 BFF

目标：在 Phase 9 功能演示之后，替换临时 M-UI shell，建立正式 Control Room Ledger UI、SDUI v0.2 route contract 和 M-UI BFF display contract。

内容：

```text
正式 M-UI shell
formal route registry
SDUI route contract v0.2
M-UI BFF display contracts
Overview / Nodes / Timeline / Audit / Policy Decisions / Services routes
StateSource visibility
CommandWell contract hardening
permission-aware disabled states
degraded-mode route states
desktop + mobile operational layout
替换 Phase 9 functional demo shell
```

完成标准：

```text
Phase 9 Functional Demo Shell 被正式 route shell 和 route registry 替换。
M-UI 可展示 Overview、节点、Timeline、Audit、Policy Decisions 和 Services。
关键状态显示 authoritative / log / audit / policy / read-model 等来源。
M-UI BFF 提供 UI-facing route data，不成为事实源。
CommandWell 至少保留 M-Task noop 正式路径。
正式视觉和交互遵守 MERISTEM-DESIGN token、布局和 forbidden component 规则。
Phase 14 不实现 LLM review、approval queue UI、M-Net profile UI 或 config authoring UI。
```

Phase 14 执行规格见 `docs/roadmap/PHASE-14.md`。

### 3.16 Phase 15：M-Extension 控制面基础

目标：建立补充扩展控制面，但不让其成为主功能层，也不引入真实执行运行时。

内容：

```text
独立 m-extension 服务定义
M-Extension Manifest v0.1
extension definition registry
system/default scoped extension instance
声明型 extension kind
extension:read / register / enable / disable 权限
M-Policy allow / deny
Timeline / Full / Audit 规则
extension lifecycle events
REST + CLI 控制面
Wasm / Webhook / HTTP callback / 云函数运行时延后
```

完成标准：

```text
一个低权限 controlPlaneOnly extension manifest 可以注册。
system/default extension instance 可以启用 / 禁用。
扩展权限受 M-Policy 管控。
高风险或未知权限 manifest 被拒绝。
扩展操作写入 M-Log 和 Audit Log。
Core 不拥有 extension authoritative state。
Phase 15 不引入 Wasm、Webhook、HTTP callback、script 或云函数执行运行时。
```

Phase 15 执行规格见 `docs/roadmap/PHASE-15.md`。

### 3.17 Phase 16：可选部署能力

目标：引入可选部署组件，不污染 Core 默认依赖，也不把部署包扩大成生产部署平台。

内容：

```text
APISIX 部署文档
Redis optional profile 与 Redis / KeyDB adapter contract
OpenSearch 部署模板
NATS 部署模板
PostgreSQL 部署模板
Core + Stem + Leaf compose 示例
```

完成标准：

```text
默认部署不强依赖 APISIX / Redis。
可选部署可以启用 APISIX。
OpenSearch 保持 optional read-model profile。
NATS KV 不够用的场景未来才允许实现 Redis / KeyDB adapter。
APISIX 示例使用显式 allowlist，不暴露内部服务。
```

Phase 16 执行规格见 `docs/roadmap/PHASE-16.md`。

### 3.18 Phase 17：Identity v0.2 本地身份硬化

目标：在不引入 OIDC / SSO / M-Identity 的前提下，把本地 JWT 身份从开发占位升级为可撤销、可审计、可被外部 M-* 服务复用的 v0.2 契约。

内容：

```text
Core-owned actor records
Core-owned token lifecycle
jti revocation
internal token introspection
identity REST + CLI
security-admin token issue / revoke
M-* services shared auth verification
token lifecycle Audit
```

完成标准：

```text
Core 拥有 actor / token 权威状态。
M-Policy 不拥有 token lifecycle。
revoked token 被拒绝。
M-* 服务通过 Core internal introspection 检查撤销状态。
token plaintext 只返回一次且不进入日志。
```

Phase 17 执行规格见 `docs/roadmap/PHASE-17.md`。

### 3.19 Phase 18：SecretRef v0.1 控制面

目标：实现 Core-owned secretRef 最小控制面，不创建 M-Secret，不接生产 KMS / Vault。

内容：

```text
secretRef metadata
secret value create / rotate / disable
M-Policy authorization
Audit before mutation
redaction across logs / OpenSearch / UI errors / LLM prompts
secret REST + CLI
```

完成标准：

```text
secretRef metadata 和版本状态有权威写模型。
secret mutating operations 走 M-Policy 和 Audit。
secret plaintext 不进入 Timeline / Full / Audit / OpenSearch / error envelope。
不创建 M-Secret 服务。
```

Phase 18 执行规格见 `docs/roadmap/PHASE-18.md`。

### 3.20 Phase 19：Config Lifecycle v0.1

目标：落地最小 authoritative config lifecycle，不做 UI authoring 或通用配置平台膨胀。

内容：

```text
config draft
schema validation
version + hash
publish
apply / ack
rollback
M-Policy + Audit for high-risk config
config REST + CLI
```

完成标准：

```text
配置变更必须验证、版本化、hash、publish、apply/ack。
高风险 config publish / rollback 走 M-Policy 和 Audit。
config payload 不包含 secret plaintext。
Phase 13 M-Net profile state 保持兼容但不静默迁移。
```

Phase 19 执行规格见 `docs/roadmap/PHASE-19.md`。

### 3.21 Phase 20：v0.1 Acceptance Closure

目标：形成 v0.1 验收矩阵，关闭规划漂移，不新增产品能力。

内容：

```text
v0.1 acceptance matrix
contract drift audit
service ownership audit
event catalog audit
state model audit
security / Audit audit
CLI / REST smoke plan
optional deployment verification
deferred work audit
```

完成标准：

```text
Phase 0-20 与契约、状态、事件、安全、测试、运行文档一致。
所有延期项都有 owner、reason、reopen trigger 和 required-before-implementation。
v0.1 不声明生产部署、生产身份、LLM 授权或 extension runtime。
```

Phase 20 执行规格见 `docs/roadmap/PHASE-20.md`。

Phase 20 marks the v0.1 planning closure boundary. New work after Phase 20 must either reopen a deferred item from `docs/roadmap/DEFERRED-WORK.md` or start a post-v0.1 roadmap track with its own scope and acceptance criteria.

---

## 4. 能力分阶段路线

| 能力 | v0 | v1 | v2 | v3 |
|------|----|----|----|----|
| Core | 最小启动、REST、OpenAPI | 服务生命周期入口 | 安全模式完善 | 多 Core 预留 |
| M-Net | 节点状态与 DERP 原型 | UDP / fallback 策略 | M-Net CN | 多区域 profile |
| M-EventBus | 基础事件 | schema/version/correlation | 互联信息事件 | Event Mesh 能力增强 |
| M-Log | Timeline + Audit 最小版 | Full Log + OpenSearch | AI 日志分析 | 长期日志画像 |
| M-Policy | RBAC | 操作危险等级 | 置信度 / 置疑度 | 多元决策 + LLM |
| M-UI | Functional Demo Shell + noop CommandWell | 正式节点 / 权限页面 | SDUI | 扩展 UI |
| M-CLI | 基础状态命令 | 节点 / 服务命令 | 日志 / 策略命令 | 高级运维命令 |
| M-Extension | 占位 | 低权限控制面扩展 | Wasm / Webhook 执行扩展 | 云函数类扩展 |
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
