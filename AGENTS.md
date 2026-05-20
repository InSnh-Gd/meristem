# AGENTS.md - AI 上下文协议

> 这份文档规定 AI 代理在 Meristem vNext 仓库中阅读文档、生成代码、审查修改时必须遵循的元规则。
>
> 任何进入本仓库的 AI 代理，都应先读本文件，再读 `MERISTEM.md` 及其衍生文档。

---

## 1. 文档阅读顺序

处理 Meristem 的任何任务时，按以下顺序读取文档：

1. `AGENTS.md` - 理解 AI 的行为边界
2. `MERISTEM.md` - 理解产品意图和范围
3. `MERISTEM-DESIGN.md` - 理解 M-UI 的视觉和交互约束
4. `MERISTEM-DEV.md` - 理解工程规范、模块边界、数据结构和冻结条款
5. `MERISTEM-ROADMAP.md` - 理解分阶段实现顺序和 v0.1 护栏
6. `docs/README.md` - 查找细分契约文档
7. `meristem_v_next_developer_document_v_0_1.md` - 理解原始 Bun-only、Eden-first、注释与 FIXME 约束
8. 相关 ADR、服务定义、事件目录、安全、配置、测试、运行或 UI schema 文档

不要跳过意图文档直接按开发文档写代码。Meristem 的实现必须服务于微内核、轻量微服务、可审计 M 网络这三个上游意图。

---

## 2. 冲突裁决规则

文档冲突时，优先级如下：

```text
MERISTEM.md（产品意图）
> MERISTEM-DESIGN.md（视觉契约）
> MERISTEM-DEV.md（工程规范）
> MERISTEM-ROADMAP.md（阶段计划）
> 当前代码草稿
```

- 如果代码与 `MERISTEM-DEV.md` 冲突，先指出违反的章节号，再修改代码。
- 如果 `MERISTEM-DEV.md` 的实现方案与 `MERISTEM.md` 的产品意图冲突，以 `MERISTEM.md` 为准，并建议同步更新开发文档。
- 如果阶段计划要求实现完整能力但 v0.1 护栏明确禁止，以 v0.1 护栏为准。

---

## 3. 代码生成原则

### 3.1 文档先行

生成任何模块、服务、契约、事件、路由、配置或 UI 之前，先确认：

- 这个能力属于哪个 M-* 功能域？
- 对应文档章节号是什么？
- 是否触及 Core 边界、服务定义、契约版本、配置生命周期、状态分类或冻结条款？
- 是否需要 M-Policy 检查、M-Log 记录或 OpenTelemetry trace？

### 3.2 代码注释要能追溯文档

当代码承载文档中的具体规则时，在必要注释中引用来源。例如：

```ts
// 服务定义字段来自 MERISTEM-DEV.md §二.2
export type MServiceDefinition = { ... };
```

不要给显而易见的赋值写注释。注释用于解释边界、契约、故障处理和安全原因。

必须补齐并维持以下注释要求，见 `meristem_v_next_developer_document_v_0_1.md §26.2` 与 `MERISTEM-DEV.md §8.2`：

- 非平凡逻辑必须有代码块级注释
- 导出函数、边界函数、校验函数、状态转换函数必须有函数注释
- Elysia 方法链必须有特别注释，解释鉴权、策略、生命周期、日志和错误映射
- 注释优先解释边界和原因，不重复语法本身

`FIXME` 只能用于以下场景，见 `meristem_v_next_developer_document_v_0_1.md §26.3` 与 `MERISTEM-DEV.md §8.3`：

- 临时方案
- 已知技术债
- 未完成安全边界
- 临时降级路径
- 尚未处理的异常情况
- 未来必须修复的问题

不得用无说明的 `TODO`、`NOTE` 或 `HACK` 代替这些边界性标记。

### 3.3 Bun-Only 与 Node.js 禁令

Meristem vNext 当前仓库执行 **Bun-only** 规则：

- 包管理、脚本执行、测试执行、服务运行统一使用 Bun
- 禁止使用 `node` 运行时执行仓库代码
- 禁止引入 `node:*` 标准库 API
- 禁止让 Node.js 成为本地开发、测试、运行或联调前提

领域里的 `Core Node`、`Stem Node`、`Leaf Node` 不是禁词；禁令只针对 Node.js 运行时和 Node.js API。

### 3.3.1 Effect 使用默认规则

Meristem 采用 `ADR-016: Effect Without Effect Everywhere`：

- 复杂副作用、生命周期、重试、超时、取消、资源释放、内部服务编排、事件消费者、策略流程、日志 pipeline 默认优先考虑 **Effect**
- 纯数据映射、简单 CRUD、短小同步规则、无需资源语义的轻量函数，不要为了形式统一强行改成 Effect
- Elysia handler 默认负责 orchestration；当 orchestration 已经涉及多个外部依赖、失败分支、时序要求或资源边界时，应优先抽到 Effect 工作流中
- 不允许把 “先全仓库 Promise，后续再看情况” 当成复杂流程的默认路径；如果复杂性已经足以 justify Effect，就应在当前改动里落地
- 同时禁止把简单逻辑过度 Effect 化；仓库目标是 **Effect-first for complex workflows, not Effect-everywhere**

如果任务触及 Effect 边界，至少同时检查：

- `docs/adr/ADR-016-effect-without-effect-everywhere.md`
- `docs/skills/functional-programming/SKILL.md`
- 对应服务文档、契约文档与测试门禁

### 3.4 禁止列表是硬约束

如果文档明确放弃或暂不采用某方案，不要在代码中引入它。当前硬性禁止包括：

- GraphQL
- Temporal
- Tekton
- Raft / 自研 Raft
- Jotai
- Elasticsearch
- 默认 Service Mesh
- gRPC everywhere
- 每服务独立数据库
- 全系统强制 CQRS
- 默认 APISIX
- 默认 Redis / KeyDB
- 把 Core 做成大业务单体
- 把 Leaf Node 做成默认高权限节点
- 让 LLM 成为授权根或审计事实来源

如果用户要求违反上述约束，先说明冲突章节和风险，再给出符合文档的替代方案。

### 3.5 Multi-Agent 默认协作

Meristem 的非平凡任务默认要求使用 **multi-agent**，避免把探索、实现、契约校验、测试和审查全部堆在主模型里。

- 单文件文案修正、纯说明问答、极小范围只读定位可以例外，但涉及代码、契约、服务、配置、测试或文档联动时，默认进入 multi-agent。
- 主模型负责：读取上游意图文档、判断边界、拆解任务、分配子任务、合并结果、处理子代理冲突、做最终结论。
- 子代理负责：在明确边界内完成单一职责工作，默认不跨职责扩张。
- 默认优先把子任务分发给小模型 `gpt-5.4-mini`。只有在以下情况才提升到更强模型或由主模型亲自处理：
  - 产品意图与工程规范存在冲突
  - 涉及跨服务架构调整或大范围集成
  - 高风险安全、授权、审计或数据边界存在不确定性
  - 多个小模型输出相互矛盾，无法直接合并
- 默认拆解方式：
  - `code-mapper`：只读定位代码路径、符号、依赖和最小修改面
  - `task-decomposer`：把任务切成可并行的小块并定义 ownership
  - `contract-guardian`：核对文档章节、契约版本、事件边界、安全边界和文档漂移
  - `backend-developer`：通用后端实现兜底，只在没有更专门 coding 角色时使用
  - `elysia-developer`：处理 Elysia 路由、插件、OpenAPI、Eden 集成和相关测试
  - `contract-implementer`：处理 schema、共享类型、契约版本、事件 envelope 和 validator
  - `domain-logic-developer`：处理纯 TypeScript 领域逻辑、状态转换、策略判断、解析和校验
  - `cli-developer`：处理 M-CLI、参数解析、输出映射和 CLI 契约联动
  - `bug-fixer`：针对明确缺陷做最小修复和失败路径补洞
  - `refactor-worker`：处理低风险重构、提取复用、命名和模块切分，不改变既有契约语义
  - `test-runner`：运行最小必要的 Bun 测试、类型检查和失败路径验证
  - `reviewer`：做回归、边界和风险审查
- 非复杂 coding 任务默认分发策略：
  - 能匹配专职 coding 角色时，优先派给专职角色，不先派给主模型
  - 默认使用 `gpt-5.4-mini`
  - 只有在任务跨越多个专职角色且强耦合时，才由主模型做更高层协调
- 默认 coding 路由：
  - Elysia / Eden / OpenAPI / route test -> `elysia-developer`
  - schema / contract / events / validator -> `contract-implementer`
  - parser / policy / pure function / state transition -> `domain-logic-developer`
  - CLI / command / terminal output / CLI contract -> `cli-developer`
  - 明确 defect fix -> `bug-fixer`
  - 低风险整理与抽取 -> `refactor-worker`
  - 无法明确归类的普通后端任务 -> `backend-developer`
- 默认至少满足以下拆分粒度之一：
  - 跨两个及以上模块或目录的改动：至少拆给 2 个子代理
  - 同时涉及代码与文档 / 契约：至少拆给 2 个子代理
  - 涉及实现、测试、审查三个不同环节：至少拆给 3 个子代理
- 子代理仍然必须遵守本文档的文档阅读顺序、Bun-only 约束、无 `any` 约束和文档同步责任。

---

## 4. 工程边界

### 4.1 Core 边界

Core 是微内核，不是大而全业务单体。Core 负责 bootstrap、基础配置、基础身份、服务生命周期入口、Elysia app composition、REST/OpenAPI、Eden 契约聚合、M-CLI 入口、安全模式、最小日志和最小策略入口。

复杂能力必须下沉到 M-Net、M-EventBus、M-Log、M-Policy、M-UI、M-CLI、M-Extension 或其微服务中。

### 4.2 微服务边界

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

### 4.3 状态边界

必须区分：

- PostgreSQL 权威写模型
- M-EventBus 事件状态
- NATS KV / Redis 缓存状态
- OpenSearch 读模型
- Yjs 协作草稿态
- M-Log 日志事实
- Audit Log 高可信审计事实

不要把事件总线当日志存储，不要把 OpenSearch 当权威数据库，不要把 Timeline Log 当审计证据。

---

## 5. 测试与完成标准

任何核心能力完成前，必须满足：

- TypeScript strict 通过
- 无 `any`
- 有测试
- 有错误路径测试
- 有必要注释
- Elysia 方法链有说明
- 有日志行为
- 必要时有 Audit Log
- 必要时有 M-Policy 检查
- 必要时有 OpenTelemetry trace
- 契约已版本化
- 文档已更新
- 无 Node.js 运行时依赖
- 无 `node:*` API 依赖

微服务、高权限能力和跨节点契约还必须满足 `MERISTEM-DEV.md` 与 `MERISTEM-ROADMAP.md` 的专项完成标准。

---

## 6. 文档维护责任

如果修改引入了以下变化，必须建议同步更新文档：

- 技术栈或默认依赖变化
- M-* 功能域边界变化
- Core 职责变化
- 服务定义字段变化
- 契约、事件、配置、M-Net Profile 版本规则变化
- 权限、审计、日志、安全边界变化
- UI token、组件、布局或 SDUI schema 变化
- 分阶段路线或 v0.1 护栏变化

文档漂移是 Meristem 最大的工程风险之一。代码变更不能让文档成为过期口号。

---

## 7. 细分文档入口

当任务触及具体实现边界时，优先读取对应文档：

| 任务类型 | 必读文档 |
|----------|----------|
| 架构决策 | `docs/adr/README.md` |
| MVP 范围、验收和演示闭环 | `docs/mvp/MVP-SPEC.md` |
| 新增或修改微服务 | `docs/services/SERVICE-DEFINITION-TEMPLATE.md` 和对应服务文档 |
| 新增或修改事件 | `docs/events/EVENT-CATALOG.md` |
| 修改 API / Eden / Webhook / SDUI 契约 | `docs/contracts/CONTRACT-VERSIONING.md` |
| 修改 MVP REST、Eden 或 CLI | `docs/contracts/REST-API-MVP.md`、`docs/contracts/EDEN-MVP.md`、`docs/contracts/CLI-COMMANDS.md` |
| 修改权限、审计、密钥、LLM 或 Webhook 安全 | `docs/security/SECURITY-MODEL.md` |
| 新增状态或存储 | `docs/data/STATE-MODEL.md` |
| 修改配置热重载 | `docs/config/CONFIG-LIFECYCLE.md` |
| 修改部署、端口、依赖或故障处理 | `docs/operations/RUNBOOK.md` |
| 修改测试门禁 | `docs/testing/TESTING.md` |
| 修改 M-UI 或 SDUI | `docs/ui/SDUI-SCHEMA.md` |
| 修改 ElysiaJS 路由、插件、OpenAPI、Eden 或测试 | `docs/skills/elysiajs/SKILL.md` 和 `docs/references/elysiajs-latest.md` |
| 修改 TypeScript 领域逻辑、策略、验证器、事件或状态转换 | `docs/skills/functional-programming/SKILL.md` |
| 修改 Svelte / SvelteKit UI | `docs/references/svelte-latest.md` 和 `docs/ui/SDUI-SCHEMA.md` |
| 引入 Wasm3 / WASI / WebAssembly 扩展运行时 | `docs/references/wasm3-latest.md` 和新增 ADR |

---

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for `InSnh-Gd/m-vnext`. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the default five-label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo: read root `CONTEXT.md` and relevant ADRs under `docs/adr/`. See `docs/agents/domain.md`.
