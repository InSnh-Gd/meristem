# Meristem Documentation Index

> `docs/` 只包含实现侧契约文档。产品意图、工程总纲和交付范围保留在仓库根文档中。
>
> 本文档是一份索引，不承载任何已在根文档或子目录契约中定义的具体规范。如果索引中的内容需要变更，应修改对应的根文档或契约文档，而不是在此展开。

---

## 1. 文档阅读顺序

1. `../AGENTS.md` — AI agent 入口与项目 skill 路由。
2. `../MERISTEM.md` — 产品意图、产品边界、隐私与安全原则。
3. `../MERISTEM-DESIGN.md` — M-UI 视觉与交互契约。
4. `../MERISTEM-DEV.md` — 工程规范、模块边界、数据结构、冻结条款。
5. `../MERISTEM-ROADMAP.md` — v0.1 交付范围、验收标准与后续跟踪项。
6. `../DEFERRED-WORK.md` — v0.1 之后或暂缓的工作。
7. 本文档（`docs/README.md`）— 查找具体契约的入口。

---

## 2. 按目录索引

| 目录 | 用途 | 入口文档 |
|------|------|----------|
| `adr/` | 架构决策记录 | `adr/README.md` |
| `services/` | 服务定义模板与每个服务的规范 | `services/README.md` |
| `events/` | NATS subject 与事件 schema 目录 | `events/EVENT-CATALOG.md` |
| `contracts/` | API、Eden、Effect Schema、事件、Webhook、生命周期与版本化规则 | `contracts/README.md` |
| `security/` | RBAC、策略、审计、密钥、LLM 与 Webhook 安全 | `security/SECURITY-MODEL.md` |
| `data/` | 权威状态、事件状态、缓存、读模型与 schema 边界 | `data/STATE-MODEL.md` |
| `config/` | 配置生命周期状态机与回滚规则 | `config/CONFIG-LIFECYCLE.md` |
| `operations/` | 本地运行手册、部署选项、依赖、端口与故障响应 | `operations/RUNBOOK.md` |
| `testing/` | 测试策略与 CI 门禁 | `testing/TESTING.md` |
| `ui/` | M-UI 过渡型工作台 brief、SDUI schema 与运营组件契约 | `ui/M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md`, `ui/SDUI-SCHEMA.md` |
| `references/` | 上游技术快照 | `references/elysiajs-latest.md` |
| `agents/` | Agent issue tracker、分类标签与领域上下文说明 | `agents/domain.md` |

---

## 3. v0.1 最小契约集

| 边界 | 对应契约 |
|------|----------|
| 交付范围与验收 | `../MERISTEM-ROADMAP.md` |
| 推迟工作 | `../DEFERRED-WORK.md` |
| REST 路由与 schema | `contracts/REST-API-MVP.md` |
| 内部 Eden 契约 | `contracts/EDEN-MVP.md` |
| CLI 行为 | `contracts/CLI-COMMANDS.md` |
| 服务生命周期运行时契约 | `contracts/SERVICE-LIFECYCLE-PROTOTYPE.md` |
| PostgreSQL 写模型 | `data/POSTGRES-SCHEMA-MVP.md` |
| 状态边界 | `data/STATE-MODEL.md` |
| 事件目录 | `events/EVENT-CATALOG.md` |
| 安全与 RBAC | `security/SECURITY-MODEL.md` |
| 测试门禁 | `testing/TESTING.md` |
| M-UI transitional workbench brief | `ui/M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md` |
| M-UI / SDUI contract | `ui/SDUI-SCHEMA.md` |

---

## 4. 文档维护规则

- 当代码变更触及 `docs/` 中定义的契约边界时，必须在同一次变更中更新对应契约。
- 如果根文档中的产品意图发生变化，应先更新 `../MERISTEM.md`，再级联到 `../MERISTEM-DESIGN.md`、`../MERISTEM-DEV.md`、`../MERISTEM-ROADMAP.md` 以及受影响的契约文档。
- 索引本身只增删目录或入口链接，不展开规范细节。

---

## 5. UI 设计激活文档集

The following documents record the M-UI Transitional Workbench design activation. They supplement the brief and SDUI schema listed in §2 and §3 above.

| Document | Purpose |
|----------|---------|
| [`ui/M-UI-DESIGN-TOOL-AVAILABILITY.md`](./ui/M-UI-DESIGN-TOOL-AVAILABILITY.md) | Design tool availability and fallback path |
| [`ui/M-UI-STRUCTURE-AND-TEST-GAP-AUDIT.md`](./ui/M-UI-STRUCTURE-AND-TEST-GAP-AUDIT.md) | Structure/test gap audit and drift findings D1–D10 |
| [`ui/M-UI-STITCH-CONCEPTS.md`](./ui/M-UI-STITCH-CONCEPTS.md) | Two layout concepts compared during exploration |
| [`ui/M-UI-DESIGN-EXPLORATION-DECISION.md`](./ui/M-UI-DESIGN-EXPLORATION-DECISION.md) | Convergence decision: Focus-Flow Ledger |
| [`ui/DESIGN.md`](./ui/DESIGN.md) | Design-system tokens and primitive layer |
| [`ui/M-UI-DESIGN-MD-CLI-EVALUATION.md`](./ui/M-UI-DESIGN-MD-CLI-EVALUATION.md) | design-md CLI tool evaluation |
| [`ui/M-UI-FIGMA-CONTEXT-VALIDATION.md`](./ui/M-UI-FIGMA-CONTEXT-VALIDATION.md) | Figma MCP context validation (deferred) |
| [`ui/M-UI-STRUCTURE-MAPPING.md`](./ui/M-UI-STRUCTURE-MAPPING.md) | Component-to-module (`layout / modules / ui`) mapping |
| [`ui/M-UI-BITS-UI-EVALUATION.md`](./ui/M-UI-BITS-UI-EVALUATION.md) | Bits UI primitive-layer evaluation |
| [`ui/M-UI-FRONTEND-TECH-DECISIONS.md`](./ui/M-UI-FRONTEND-TECH-DECISIONS.md) | Frontend technology decisions |
