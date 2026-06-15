<div align="center">

# Meristem

<p align="center">
  一个基于微内核核心、微服务架构，显式服务边界和可审计操作契约构建的分布式节点网络控制平面。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/language-TypeScript-blue?style=flat-square" alt="TypeScript" />
  <img src="https://img.shields.io/badge/runtime-Bun-black?style=flat-square" alt="Bun" />
  <img src="https://img.shields.io/badge/framework-ElysiaJS-pink?style=flat-square" alt="ElysiaJS" />
  <img src="https://img.shields.io/badge/event%20bus-NATS-green?style=flat-square" alt="NATS" />
  <img src="https://img.shields.io/badge/database-PostgreSQL-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/search-OpenSearch-005EB8?style=flat-square" alt="OpenSearch" />
</p>

</div>

---

## 概述

Meristem 是一个以 TypeScript 为核心、仅支持 Bun 运行时、并以 Elysia 作为首选框架的控制平面，用于运行分布式 Meristem 网络。它有意保持 Core 简洁，将复杂能力下沉到明确的子 Meristem 域中，并将契约、策略决策和审计事实视为一级系统边界。

### 主要特性

| 类别 | 能力 |
| --- | --- |
| **核心架构** | 微内核 Core、REST + OpenAPI 接口、内部契约聚合、最小化安全入口 |
| **网络控制** | Core / Stem / Leaf 节点模型、逻辑网络、M-Net 配置文件生命周期、受控加入入口 |
| **策略与审计** | RBAC 优先的策略检查、高风险操作审批门、Timeline / Full / Audit 日志事实 |
| **契约** | REST、OpenAPI、Eden、Effect Schema、服务定义、事件目录、与漂移测试对齐的文档 |
| **运行时拓扑** | 专用 M-* 服务负责策略、日志、网络、任务、扩展、UI BFF 与节点代理 |
| **运维接口** | M-CLI、M-UI BFF、SvelteKit UI、基于 SDUI 的运维面板 |

## 技术栈

- **运行时**：Bun
- **语言**：TypeScript
- **框架**：ElysiaJS
- **公有 API**：REST + OpenAPI
- **内部契约**：Eden Contract + Effect Schema
- **数据库**：PostgreSQL
- **事件总线**：NATS
- **搜索 / 投影**：OpenSearch
- **UI**：SvelteKit + SDUI
- **可观测性**：OpenTelemetry

## Monorepo 结构

```text
meristem/
├── apps/
│   ├── core/                  # 微内核 Core 及主要 REST/OpenAPI 入口
│   ├── m-cli/                 # 官方运维 CLI
│   └── m-ui/                  # SvelteKit UI
├── services/
│   ├── m-net/                 # 网络和配置文件生命周期服务
│   ├── m-eventbus/            # 事件总线接口与消息辅助库
│   ├── m-log/                 # Timeline / Full / Audit 日志服务
│   ├── m-policy/              # 授权与审批决策服务
│   ├── m-task/                # 任务服务边界与任务生命周期
│   ├── m-extension/           # 受控扩展接口
│   ├── m-ui-bff/              # 面向 UI 的后端代理
│   └── node-agent/            # 托管节点代理运行时
├── packages/
│   ├── contracts/             # 共享 REST / Eden / Schema 契约
│   ├── events/                # 事件信封与模式定义
│   ├── config/                # 配置生命周期辅助模块与 Schema
│   ├── policy/                # RBAC 与策略基元
│   └── testing/               # 共享测试辅助与测试夹具
├── docs/
│   ├── adr/                   # 架构决策记录
│   ├── contracts/             # REST / CLI / Eden / 生命周期契约
│   ├── services/              # 服务定义文档
│   ├── data/                  # 状态模型与 PostgreSQL 模式文档
│   ├── events/                # 事件目录与延迟事件差距图
│   ├── security/              # 安全模型
│   ├── operations/            # 运行手册与部署指南
│   ├── testing/               # 测试策略与准则
│   └── ui/                    # SDUI 与 UI 契约文档
└── scripts/                   # 开发、部署与仓库规范脚本
```

### 核心文档路径

```text
AGENTS.md
├── MERISTEM.md               # 产品意图与系统边界
├── MERISTEM-DESIGN.md        # 可视化与运维 UI 契约
├── MERISTEM-DEV.md           # 工程规则与模块边界
├── MERISTEM-ROADMAP.md       # 活动 v0.1 范围与验收矩阵
└── docs/README.md            # 详细文档索引
```

## 快速开始

### 先决条件

| 依赖 | 版本 |
| --- | --- |
| Bun | 1.x |
| PostgreSQL | 建议 16+ |
| NATS | 当前稳定版 |
| OpenSearch | 搜索 / 投影流程所需 |

### 本地开发

```bash
git clone https://github.com/InSnh-Gd/meristem.git
cd meristem

bun install
bun run db:migrate
bun run db:seed
bun run dev:all
```

有关运行时、端口、依赖模式和降级路径行为的详细信息，请参阅 [`docs/operations/RUNBOOK.md`](./docs/operations/RUNBOOK.md)。

## 可用命令

| 命令 | 描述 |
| --- | --- |
| `bun run dev:all` | 启动标准本地多服务开发栈 |
| `bun run dev:core` | 仅启动 Core 开发服务器 |
| `bun run dev:full` | 启动更完整的本地服务集 |
| `bun run dev:m-ui` | 启动 SvelteKit UI |
| `bun run db:migrate` | 应用 PostgreSQL 迁移 |
| `bun run db:seed` | 填充本地开发数据 |
| `bun run lint` | 运行 Biome lint 和仓库规范检查 |
| `bun run typecheck` | 运行 TypeScript 类型检查 |

### 运行测试

```bash
bun run test
bun run test:contracts
bun run test:integration
bun run test:e2e
```

## 文档

| 文档 | 描述 |
| --- | --- |
| [`AGENTS.md`](./AGENTS.md) | 仓库上下文入口与技能路由 |
| [`MERISTEM.md`](./MERISTEM.md) | 产品意图与领域边界 |
| [`MERISTEM-DESIGN.md`](./MERISTEM-DESIGN.md) | 可视化与运维 UI 契约 |
| [`MERISTEM-DEV.md`](./MERISTEM-DEV.md) | 工程规则与实现边界 |
| [`MERISTEM-ROADMAP.md`](./MERISTEM-ROADMAP.md) | 活动 v0.1 范围与验收矩阵 |
| [`docs/README.md`](./docs/README.md) | 详细文档索引 |
| [`docs/contracts/README.md`](./docs/contracts/README.md) | API、CLI、Eden 与生命周期契约集 |
| [`docs/services/README.md`](./docs/services/README.md) | 服务定义索引 |
| [`docs/security/SECURITY-MODEL.md`](./docs/security/SECURITY-MODEL.md) | 安全模型 |
| [`docs/testing/TESTING.md`](./docs/testing/TESTING.md) | 测试准则与策略 |

## 许可证

- 请参阅 [`LICENSE`](./LICENSE)。
