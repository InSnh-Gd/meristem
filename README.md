<div align="center">

# Meristem

<p align="center">
  一个基于微内核核心、微内核多服务架构（Microkernel Multi-Service Architecture），显式服务边界和可审计操作契约构建的分布式节点网络控制平面。
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

Meristem 是一个以 TypeScript 为核心、仅支持 Bun 运行时、并以 Elysia 作为首选框架的控制平面，用于运行分布式 Meristem 网络。它有意保持 Core 简洁，将复杂能力下沉到明确的功能域中，并将契约、策略决策和审计事实视为一级系统边界。

### 主要特性

| 类别 | 能力 |
| --- | --- |
| **核心架构** | 微内核 Core、REST + OpenAPI 接口、内部契约聚合、最小化安全入口 |
| **网络控制** | Core / Stem / Leaf 节点模型、逻辑网络、M-Net 配置文件生命周期、受控加入入口 |
| **策略与审计** | RBAC 优先的策略检查、高风险操作审批门、Timeline / Full / Audit 日志事实 |
| **契约** | REST、OpenAPI、Eden、Effect Schema、服务定义、事件目录、与漂移测试对齐的文档 |
| **运行时拓扑** | 各功能域负责策略、日志、网络、任务、扩展、UI BFF 与节点代理 |
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
- **可观测性**：OpenTelemetry + Pino（操作日志）
- **开发工具**：date-fns（日期处理）、cac（CLI 解析）、@total-typescript/shoehorn（测试 mock）、@effect/platform-bun（Effect/Bun 平台试点）

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
├── MERISTEM-DEV.md           # 工程规则与模块边界
├── MERISTEM-ROADMAP.md       # 活动 v0.1 范围与验收矩阵
└── docs/README.md            # 详细文档索引
```

## 部署与运行

### 依赖

- **本地**：Bun 1.x、Git、Docker Engine、Docker Compose v2。
- **NixOS**：Nix/NixOS（`compose2nix` 由 `nix develop` 提供）。
- **生产**：rootless Podman、user systemd、Vault、受信任 OCI registry 与签名身份。

本地启动前确认 Docker daemon 已启动，且 `3000`、`3200`、`5173`、`55432`、`4222/4223` 未被占用。

### 1. 本地完整开发环境

```bash
git clone https://github.com/InSnh-Gd/meristem.git
cd meristem
bun install
bun run dev:full
```

一键安装器（生成并校验部署清单，再准备依赖并启动完整栈）：

```bash
bun run meristem deploy install --profiles opensearch,redis,apisix
# 只准备依赖、不启动长期进程：
bun run meristem deploy install --profiles opensearch,redis,apisix --prepare-only
```

只启动后端：

```bash
bun run dev:core
```

启动 OpenSearch、Redis 与 APISIX 一起测试：

```bash
bun run dev:full --opensearch --redis --apisix
```

另开一个终端验证；最后用 `Ctrl-C` 停止 Bun 进程：

```bash
docker compose ps
curl --fail http://127.0.0.1:3000/api/v0/health

# 仅在使用 --opensearch --redis --apisix 时执行：
curl --fail http://127.0.0.1:9200/_cluster/health
docker compose exec -T redis redis-cli ping
curl --fail http://127.0.0.1:9080/api/v0/health

# 删除本地容器与数据：
docker compose down --volumes
```

`APISIX` profile 仅支持 Linux/NixOS 本地验证；它使用 host networking 访问 loopback 服务，且不会暴露 `/internal/v0/*`。

### 2. 本地静态 UI 部署验证

```bash
# 只准备容器、证书、迁移和 seed 数据
bun run deploy:local --prepare-only

# 启动 Core、BFF 与静态 Web UI
bun run deploy:local
```

### 3. NixOS 单机部署

```bash
nix develop
bun run nix:generate
sudo install -d -m 0750 /etc/meristem
sudo install -m 0640 ops/nixos/meristem.env.example /etc/meristem/meristem.env
```

在目标主机配置中导入 `ops/nixos/module.nix` 并设置 `services.meristem.enable = true` 后，执行主机自己的 rebuild：

```bash
sudo nixos-rebuild switch --flake /etc/nixos#<hostname>
systemctl status meristem-core
```

`docker-compose.yml` 是 NixOS 基础设施容器的唯一源；修改后执行 `bun run nix:generate`。完整模块配置见 [`ops/nixos/README.md`](./ops/nixos/README.md)。

### 4. 生产部署（GitOps）

生产运行时是 rootless Podman + Quadlet；Git 是 desired-state 权威，M-Deploy agent 只 pull-reconcile 已签名、已审批的状态。`deploy init` / `validate` 是离线命令；`deploy propose` 及之后需要已 bootstrap 并运行的 M-Deploy 控制面（Core → M-Deploy + M-Policy + M-Log）。前置 bootstrap、OCI 构建签名与灾备恢复见 [`RUNBOOK.md`](./docs/operations/RUNBOOK.md) 和 [`OCI-PIPELINE.md`](./docs/operations/OCI-PIPELINE.md)。

```bash
# 0. 设置环境（propose 及之后需要运行中的控制面）
export MERISTEM_CORE_URL=http://127.0.0.1:3000
export MERISTEM_TOKEN=<operator-jwt>

# 1. 离线：从当前 Git checkout 自动生成生产清单并立即校验
bun run meristem deploy init --profile production-podman
bun run meristem deploy validate

# 2. admin 或 security-admin 提交 desired-state proposal（生成 M-Policy 双人审批；需运行中控制面）
bun run meristem deploy propose

# 3. 两位不同的 security-admin 分别批准同一 proposal
bun run meristem deploy approve <proposal-id>
bun run meristem deploy approve <proposal-id>

# 4. 双人批准后排队 agent reconcile
bun run meristem deploy apply --proposal <proposal-id> --agent <agent-id> --confirm

# 5. 验证结果与证据
bun run meristem deploy status
bun run meristem deploy agents
bun run meristem deploy evidence
bun run meristem deploy drift

# 6. 独立授权的 rollback（不复用 apply 审批）
bun run meristem deploy rollback --agent <agent-id> --digest-value <sha256-hex> --confirm
```

`deploy init` 从运行命令的 Git checkout 自动派生生产 sourceRef：origin URL、附着分支、不可变 commit，以及对原始 `git archive --format=tar <commit> -- .` 字节的小写 SHA-256 digest；脏工作树与未跟踪文件不进入 digest。必须在带 origin 的附着 checkout 中运行：缺少 origin、detached HEAD、archive 失败或 origin 含凭据时不会写入清单。已存在且校验通过的同一 profile 清单会被原样复用，只有旧版占位清单会被原地升级；不同 profile 或损坏清单会失败。`validate` 只做离线语义校验，不证明远端 source/envelope 可获取或可信、已签名、通过策略审批或已被 agent 复核；签名与准入复核由 M-Deploy/agent 拉取时执行。

### 5. 测试

```bash
bun run lint
bun run typecheck
bun run test:agent-submit
bun run test:real-env --opensearch --redis --apisix
```

M-Net 多主机前置检查：

```bash
bun run mnet:harness:preflight
bun run mnet:v02:sidecar-proof
```

## 文档

| 文档 | 描述 |
| --- | --- |
| [`AGENTS.md`](./AGENTS.md) | 仓库上下文入口与技能路由 |
| [`MERISTEM.md`](./MERISTEM.md) | 产品意图与领域边界 |
| [`MERISTEM-DEV.md`](./MERISTEM-DEV.md) | 工程规则与实现边界 |
| [`MERISTEM-ROADMAP.md`](./MERISTEM-ROADMAP.md) | 活动 v0.1 范围与验收矩阵 |
| [`docs/README.md`](./docs/README.md) | 详细文档索引 |
| [`docs/contracts/README.md`](./docs/contracts/README.md) | API、CLI、Eden 与生命周期契约集 |
| [`docs/services/README.md`](./docs/services/README.md) | 服务定义索引 |
| [`docs/security/SECURITY-MODEL.md`](./docs/security/SECURITY-MODEL.md) | 安全模型 |
| [`docs/testing/TESTING.md`](./docs/testing/TESTING.md) | 测试准则与策略 |
| [`docs/operations/RUNBOOK.md`](./docs/operations/RUNBOOK.md) | 本地运行、生产 bootstrap、promotion、rollback、恢复与故障响应的权威手册 |
| [`docs/operations/OPTIONAL-DEPLOYMENT-PACK.md`](./docs/operations/OPTIONAL-DEPLOYMENT-PACK.md) | OpenSearch、Redis 与 APISIX profile 的边界、验证和降级行为 |
| [`docs/operations/OCI-PIPELINE.md`](./docs/operations/OCI-PIPELINE.md) | OCI 构建、签名证据、promotion 与 rollback metadata 规则 |
| [`ops/nixos/README.md`](./ops/nixos/README.md) | NixOS 单机适配、OCI unit 与 Bun systemd unit 说明 |
| [`docs/production-readiness/READINESS-SUMMARY.md`](./docs/production-readiness/READINESS-SUMMARY.md) | 生产轨道的实现证据索引与仍需在目标环境完成的 proof gate |

## 许可证

- 请参阅 [`LICENSE`](./LICENSE)。
