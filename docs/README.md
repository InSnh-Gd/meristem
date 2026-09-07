# Meristem Documentation Index

> `docs/` 承载实现侧契约文档与配套的运维、发布、参考材料。产品意图、工程总纲和交付范围保留在仓库根文档中。
>
> 本文档是一份索引，不承载任何已在根文档或子目录契约中定义的具体规范。如果索引中的内容需要变更，应修改对应的根文档或契约文档，而不是在此展开。

---

## 1. 文档阅读顺序

1. `../AGENTS.md` — AI agent 入口与项目 skill 路由。
2. `../MERISTEM.md` — 产品意图、产品边界、隐私与安全原则。
3. `../MERISTEM-DEV.md` — 工程规范、模块边界、数据结构、冻结条款。
4. `../MERISTEM-ROADMAP.md` — 当前产品版本（v0.2）现状、验收标准与后续跟踪项。
5. `../DEFERRED-WORK.md` — 延后工作登记册。
6. 本文档（`docs/README.md`）— 查找具体契约的入口。

---

## 2. 按目录索引

| 目录 | 用途 | 入口文档 |
|------|------|----------|
| `adr/` | 架构决策记录 | `adr/README.md` |
| `services/` | 服务定义模板与每个服务的规范 | `services/README.md` |
| `events/` | NATS subject 与事件 schema 目录；deferred subject 差距图 | `events/EVENT-CATALOG.md`、`events/DEFERRED-EVENT-GAP-MAP.md` |
| `contracts/` | API、Eden、Effect Schema、事件、Webhook、生命周期与版本化规则 | `contracts/README.md` |
| `security/` | RBAC、策略、审计、密钥、LLM 与 Webhook 安全 | `security/SECURITY-MODEL.md` |
| `data/` | 权威状态、事件状态、缓存、读模型与 schema 边界 | `data/STATE-MODEL.md` |
| `config/` | 配置生命周期状态机与回滚规则 | `config/CONFIG-LIFECYCLE.md` |
| `operations/` | 本地运行手册、部署选项、依赖、端口与故障响应 | `operations/RUNBOOK.md` |
| `releases/` | 版本发布说明与操作者清单 | `releases/MERISTEM-V02-RELEASE-NOTES.md`、`releases/MERISTEM-V02-OPERATOR-CHECKLIST.md` |
| `testing/` | 测试策略与 CI 门禁 | `testing/TESTING.md` |
| `ui/` | M-UI / SDUI 契约 | `ui/SDUI-SCHEMA.md` |
| `references/` | 上游技术快照 | `references/elysiajs-latest.md`、`references/effect-latest.md`、`references/svelte-latest.md`、`references/drizzle-orm-latest.md`、`references/wasm3-latest.md` |
| `agents/` | Agent issue tracker、分类标签与领域上下文说明 | `agents/domain.md` |

---

## 3. 当前契约集

| 边界 | 对应契约 |
|------|----------|
| 交付现状与验收 | `../MERISTEM-ROADMAP.md` |
| 推迟工作 | `../DEFERRED-WORK.md` |
| REST 路由与 schema | `contracts/REST-API.md` |
| 内部 Eden 契约 | `contracts/EDEN.md` |
| CLI 行为 | `contracts/CLI-COMMANDS.md` |
| 服务生命周期运行时契约 | `contracts/SERVICE-LIFECYCLE.md` |
| PostgreSQL 写模型 | `data/POSTGRES-SCHEMA.md` |
| 状态边界 | `data/STATE-MODEL.md` |
| 事件目录 | `events/EVENT-CATALOG.md` |
| 安全与 RBAC | `security/SECURITY-MODEL.md` |
| 测试门禁 | `testing/TESTING.md` |
| M-UI / SDUI contract | `ui/SDUI-SCHEMA.md` |

---

## 4. 文档维护规则

- 当代码变更触及 `docs/` 中定义的契约边界时，必须在同一次变更中更新对应契约。
- 如果根文档中的产品意图发生变化，应先更新 `../MERISTEM.md`，再级联到 `../MERISTEM-DEV.md`、`../MERISTEM-ROADMAP.md` 以及受影响的契约文档。
- 索引本身只增删目录或入口链接，不展开规范细节。

---

## 5. UI 契约

当前 UI 边界以 [`ui/SDUI-SCHEMA.md`](./ui/SDUI-SCHEMA.md) 与 M-UI BFF 服务契约（`services/m-ui-bff.md`）为准。历史 M-UI 设计探索文档已在 v0.2 文档重组中移除；视觉方向由当前任务定义，但必须保留 SDUI / BFF / CommandWell 契约边界。
