---
name: meristem-context-protocol
description: Use when working in the Meristem vNext repository, before reading implementation files, changing docs or code, reviewing changes, planning phases, or resolving conflicts between Meristem documents and current code.
---

# Meristem Context Protocol

## 使用时机

处理 Meristem 的任何任务时先使用本 skill。它承载仓库级 AI 上下文协议：读文档顺序、冲突裁决、意图边界和细分文档入口。

如果任务会修改代码、契约、服务、配置、测试或 UI，同时使用 `meristem-engineering-guardrails`，并按任务边界加载对应细分 skill。

## 文档阅读顺序

按以下顺序读取文档，不要跳过意图文档直接按代码草稿实现：

1. `AGENTS.md` - 理解入口和项目 skill 路由。
2. `MERISTEM.md` - 理解产品意图和范围。
3. `MERISTEM-DESIGN.md` - 理解 M-UI 视觉和交互约束。
4. `MERISTEM-DEV.md` - 理解工程规范、模块边界、数据结构和冻结条款。
5. `MERISTEM-ROADMAP.md` - 理解分阶段实现顺序和 v0.1 护栏。
6. `docs/README.md` - 查找细分契约文档。
7. 相关 ADR、服务定义、事件目录、安全、配置、测试、运行或 UI schema 文档。

历史开发草案和旧阶段文档已从当前文档集移除；当前实现规范以根文档、`docs/README.md`、对应契约文档和 `DEFERRED-WORK.md` 为准。

## 冲突裁决

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

## 产品意图边界

Meristem 的实现必须服务于三个上游意图：微内核、轻量微服务、可审计 M 网络。

默认判断：

- Core 是微内核，不是大而全业务单体。
- 复杂能力进入明确的 M-* 功能域或微服务。
- 分布式节点默认不可信，Leaf Node 默认低权限、受限 API、受限互联。
- 契约、日志、审计事实、策略决策和 traceability 优先于框架便利。
- Meristem 是轻量微服务优先，不是默认 Kubernetes / Service Mesh 优先。

## 细分文档入口

当任务触及具体实现边界时，优先读取对应文档：

| 任务类型 | 必读文档 |
| --- | --- |
| 架构决策 | `docs/adr/README.md` |
| v0.1 范围、验收和演示闭环 | `MERISTEM-ROADMAP.md` |
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
| 修改 ElysiaJS 路由、插件、OpenAPI、Eden 或测试 | `.agents/skills/elysiajs/SKILL.md` 和 `docs/references/elysiajs-latest.md` |
| 修改 TypeScript 领域逻辑、策略、验证器、事件或状态转换 | `.agents/skills/functional-programming/SKILL.md` |
| 修改 Svelte / SvelteKit UI | `docs/references/svelte-latest.md` 和 `docs/ui/SDUI-SCHEMA.md` |
| 引入 Wasm3 / WASI / WebAssembly 扩展运行时 | `docs/references/wasm3-latest.md` 和新增 ADR |

## 细分项目 Skill 入口

- 服务定义、服务边界、生命周期或 BFF：`.agents/skills/meristem-service-definition/SKILL.md`。
- 版本化契约、迁移或 drift test：`.agents/skills/meristem-contract-versioning/SKILL.md`。
- M-UI、SDUI、CommandWell、UI demo shell：`.agents/skills/meristem-ui-contract/SKILL.md`。
- 测试矩阵、完成声明、阶段验收：`.agents/skills/meristem-testing-gates/SKILL.md`。

## Agent 项目上下文

- Issues 和 PRDs 使用 `InSnh-Gd/m-vnext` 的 GitHub Issues；见 `docs/agents/issue-tracker.md`。
- Triage 标签为 `needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`；见 `docs/agents/triage-labels.md`。
- 本仓库是 single-context repo：读取根目录 `CONTEXT.md` 和 `docs/adr/` 下相关 ADR；见 `docs/agents/domain.md`。
