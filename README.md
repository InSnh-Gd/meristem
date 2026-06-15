# Meristem vNext

Meristem vNext 是一个 **TypeScript-first、Bun-only、Elysia-first** 的分布式 M 网络控制系统仓库。

它关注的不是“把所有能力塞进一个大平台”，而是在明确契约、权限和审计边界下，提供一个 **轻量、可追踪、可审计** 的 M 网络控制面。

## 核心原则

- **Core 保持微内核**：只承载 bootstrap、基础身份、REST/OpenAPI、内部契约聚合和最小安全入口。
- **复杂能力进入 M-* 功能域或微服务**：例如 M-Net、M-Policy、M-Log、M-Task、M-Extension、M-UI BFF。
- **PostgreSQL 是权威写模型**：OpenSearch 是读模型 / 投影目标，NATS 承担事件与轻量 KV 角色。
- **Leaf Node 默认低权限**：高风险能力必须经过 M-Policy，并留下 Timeline / Full / Audit 事实。

## 先读什么

不要直接从零散代码开始。推荐入口顺序：

1. [`AGENTS.md`](./AGENTS.md) — 仓库上下文入口
2. [`MERISTEM.md`](./MERISTEM.md) — 产品意图与边界
3. [`MERISTEM-DESIGN.md`](./MERISTEM-DESIGN.md) — M-UI 视觉与交互契约
4. [`MERISTEM-DEV.md`](./MERISTEM-DEV.md) — 工程规范与模块边界
5. [`MERISTEM-ROADMAP.md`](./MERISTEM-ROADMAP.md) — v0.1 范围与验收矩阵
6. [`DEFERRED-WORK.md`](./DEFERRED-WORK.md) — 延后工作
7. [`docs/README.md`](./docs/README.md) — 具体契约与服务文档索引

## 快速开始

### 依赖

- [Bun](https://bun.sh/)
- PostgreSQL
- NATS
- OpenSearch（部分投影 / 搜索 / 契约测试需要）

Meristem 当前执行 **Bun-only** 规则：统一使用 `bun` 进行安装、运行和测试，不使用 Node.js 运行时执行仓库代码。

### 安装

```bash
bun install
```

### 常用命令

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

## 仓库结构

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
  adr/
  services/
  contracts/
  data/
  events/
  security/
  operations/
  testing/
  ui/
```

## 文档入口

- [`docs/README.md`](./docs/README.md) — `docs/` 总索引
- [`docs/adr/README.md`](./docs/adr/README.md) — ADR 索引
- [`docs/services/README.md`](./docs/services/README.md) — 服务定义索引
- [`docs/contracts/README.md`](./docs/contracts/README.md) — 契约文档索引
- [`docs/security/SECURITY-MODEL.md`](./docs/security/SECURITY-MODEL.md) — 安全模型
- [`docs/testing/TESTING.md`](./docs/testing/TESTING.md) — 测试门禁

## 变更原则

- Core 不是业务单体；复杂能力进入明确的 M-* 边界。
- 文档与实现必须同变更更新。
- PostgreSQL 是权威写模型；事件、缓存、OpenSearch 和协作草稿态都不是权威状态。
- 高风险操作必须经过 M-Policy，并写入可追踪日志 / 审计事实。

如果你不确定某个改动应该更新哪份文档，先从 [`AGENTS.md`](./AGENTS.md) 和 [`docs/README.md`](./docs/README.md) 开始。
