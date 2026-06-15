# Meristem

Meristem 是一个 **TypeScript-first、Bun-only、Elysia-first** 的分布式 M 网络控制系统仓库。

它的目标是在**明确契约、权限和审计边界**下，提供一个轻量、可追踪、可审计的控制面，而不是把所有能力堆进一个平台单体。

## 项目介绍

Meristem 围绕以下几条产品与工程原则构建：

- **Core 保持微内核**：只负责 bootstrap、基础身份、REST/OpenAPI、内部契约聚合和最小安全入口。
- **复杂能力进入 M-* 功能域或微服务**：例如 M-Net、M-Policy、M-Log、M-Task、M-Extension、M-UI BFF。
- **PostgreSQL 是权威写模型**：OpenSearch 只做读模型 / 投影，NATS 负责事件与轻量 KV。
- **Leaf Node 默认低权限**：高风险能力必须经过 M-Policy，并留下 Timeline / Full / Audit 事实。

## 技术栈

| 类别 | 选型 |
|------|------|
| 语言 | TypeScript |
| 运行时 | Bun |
| 后端框架 | ElysiaJS |
| 内部契约 | Eden Contract |
| 外部 API | REST + OpenAPI |
| 写模型 | PostgreSQL |
| 事件总线 | NATS |
| 读模型 / 搜索 | OpenSearch |
| UI | SvelteKit + SDUI |
| 可观测性 | OpenTelemetry |
| 复杂副作用建模 | Effect |

## 功能概览

当前仓库围绕这些核心能力组织：

- **Core 微内核**：系统启动、路由组装、基础身份、安全入口
- **M-Net**：节点、逻辑网络、profile 生命周期、node-agent 会话边界
- **M-Policy**：RBAC、高风险操作决策、审计联动
- **M-Log**：Timeline / Full / Audit 三层日志事实
- **M-Task**：规范任务边界与任务生命周期所有权
- **M-Extension**：补充扩展机制，而非主能力承载层
- **M-UI / M-UI BFF / M-CLI**：面向操作者的 UI、BFF 和 CLI 入口

## 快速开始

### 环境要求

- [Bun](https://bun.sh/)
- PostgreSQL
- NATS
- OpenSearch（部分投影 / 搜索 / 契约测试需要）

> Meristem 当前执行 **Bun-only** 规则：统一使用 `bun` 进行安装、运行和测试，不使用 Node.js 运行时执行仓库代码。

### 安装依赖

```bash
bun install
```

### 常用开发命令

```bash
# 本地开发
bun run dev:all
bun run dev:core
bun run dev:full
bun run dev:m-ui
bun run dev:ui-demo

# 数据库
bun run db:migrate
bun run db:seed

# 质量门禁
bun run lint
bun run typecheck
bun run test
bun run test:contracts
bun run test:cli
bun run test:failure-modes
bun run test:integration
bun run test:e2e
bun run nodejs-ban
```

更完整的运行方式、依赖、端口和降级说明见 [`docs/operations/RUNBOOK.md`](./docs/operations/RUNBOOK.md)。

## 项目结构

```text
apps/
  core/         Core 微内核与 REST / OpenAPI / 路由组装
  m-ui/         SvelteKit UI
  m-cli/        官方 CLI

services/
  m-net/
  m-eventbus/
  m-log/
  m-policy/
  m-task/
  m-extension/
  m-ui-bff/
  node-agent/

packages/
  contracts/    REST / Eden / Effect Schema / 共享契约
  events/       事件 envelope 与 schema
  policy/       RBAC 与策略原语
  config/       配置 schema 与生命周期 helper
  testing/      测试共享工具

docs/
  adr/          架构决策记录
  services/     服务定义
  contracts/    API / Eden / CLI / lifecycle 契约
  data/         状态边界与 PostgreSQL schema
  events/       事件目录与 deferred gap map
  security/     安全模型
  operations/   运行手册与部署选项
  testing/      测试策略
  ui/           SDUI / BFF 展示契约
```

## 文档入口

如果你是第一次进入仓库，推荐按下面顺序阅读：

1. [`AGENTS.md`](./AGENTS.md) — 仓库上下文入口
2. [`MERISTEM.md`](./MERISTEM.md) — 产品意图与边界
3. [`MERISTEM-DESIGN.md`](./MERISTEM-DESIGN.md) — M-UI 视觉与交互契约
4. [`MERISTEM-DEV.md`](./MERISTEM-DEV.md) — 工程规范与模块边界
5. [`MERISTEM-ROADMAP.md`](./MERISTEM-ROADMAP.md) — v0.1 范围与验收矩阵
6. [`DEFERRED-WORK.md`](./DEFERRED-WORK.md) — 延后工作
7. [`docs/README.md`](./docs/README.md) — `docs/` 总索引

常用细分入口：

- [`docs/adr/README.md`](./docs/adr/README.md)
- [`docs/services/README.md`](./docs/services/README.md)
- [`docs/contracts/README.md`](./docs/contracts/README.md)
- [`docs/security/SECURITY-MODEL.md`](./docs/security/SECURITY-MODEL.md)
- [`docs/testing/TESTING.md`](./docs/testing/TESTING.md)

## 变更原则

- Core 不是业务单体；复杂能力进入明确的 M-* 边界。
- 文档与实现必须同变更更新。
- PostgreSQL 是权威写模型；事件、缓存、OpenSearch 和协作草稿态都不是权威状态。
- 高风险操作必须经过 M-Policy，并写入可追踪日志 / 审计事实。

如果你不确定某个改动应该更新哪份文档，先从 [`AGENTS.md`](./AGENTS.md) 和 [`docs/README.md`](./docs/README.md) 开始。
