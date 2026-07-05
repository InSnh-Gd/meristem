# Meristem Documentation Index

> `docs/` 只包含实现侧契约文档。产品意图、工程总纲和交付范围保留在仓库根文档中。
>
> 本文档是一份索引，不承载任何已在根文档或子目录契约中定义的具体规范。如果索引中的内容需要变更，应修改对应的根文档或契约文档，而不是在此展开。

---

## 1. 文档阅读顺序

1. `../AGENTS.md` — AI agent 入口与项目 skill 路由。
2. `../MERISTEM.md` — 产品意图、产品边界、隐私与安全原则。
3. `../MERISTEM-DEV.md` — 工程规范、模块边界、数据结构、冻结条款。
4. `../MERISTEM-ROADMAP.md` — v0.1 交付范围、验收标准与后续跟踪项。
5. `../DEFERRED-WORK.md` — v0.1 之后或暂缓的工作。
6. 本文档（`docs/README.md`）— 查找具体契约的入口。

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
| `ui/` | M-UI / SDUI 契约和保留的历史参考材料。当前可执行 UI 边界以 SDUI schema、M-UI BFF 服务契约和用户当前要求为准；保留的设计探索文档只作背景参考。 | `ui/SDUI-SCHEMA.md` |
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
| M-UI / SDUI contract | `ui/SDUI-SCHEMA.md` |

---

## 4. 文档维护规则

- 当代码变更触及 `docs/` 中定义的契约边界时，必须在同一次变更中更新对应契约。
- 如果根文档中的产品意图发生变化，应先更新 `../MERISTEM.md`，再级联到 `../MERISTEM-DEV.md`、`../MERISTEM-ROADMAP.md` 以及受影响的契约文档。
- 索引本身只增删目录或入口链接，不展开规范细节。

---

## 5. UI 参考材料

The active UI contract is [`ui/SDUI-SCHEMA.md`](./ui/SDUI-SCHEMA.md), together with the M-UI BFF service contract. The following documents are preserved as historical or exploratory reference only; they are not mandatory style authorities and should not override current product requirements.

| Document | Purpose |
|----------|---------|
| [`ui/M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md`](./ui/M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md) | Historical workbench brief and operator workflow framing |
| [`ui/M-UI-STRUCTURE-AND-TEST-GAP-AUDIT.md`](./ui/M-UI-STRUCTURE-AND-TEST-GAP-AUDIT.md) | Historical structure/test gap audit |
| [`ui/M-UI-STITCH-CONCEPTS.md`](./ui/M-UI-STITCH-CONCEPTS.md) | Historical layout concept exploration |
| [`ui/M-UI-DESIGN-EXPLORATION-DECISION.md`](./ui/M-UI-DESIGN-EXPLORATION-DECISION.md) | Historical convergence rationale |
| [`ui/M-UI-DESIGN-TOOL-AVAILABILITY.md`](./ui/M-UI-DESIGN-TOOL-AVAILABILITY.md) | Historical design-tool availability notes |
| [`ui/M-UI-DESIGN-MD-CLI-EVALUATION.md`](./ui/M-UI-DESIGN-MD-CLI-EVALUATION.md) | Historical design-system CLI evaluation |
| [`ui/M-UI-FIGMA-CONTEXT-VALIDATION.md`](./ui/M-UI-FIGMA-CONTEXT-VALIDATION.md) | Historical Figma context validation notes |

---

## 6. 生产轨道规划文档（Planned — Post-v0.1 Production Track）

> 以下文档是 `MERISTEM-ROADMAP.md §7` 定义的 post-v0.1 生产轨道所需的规划文档。这些文档当前尚未创建，仅供索引和规划参考。实际创建和内容以对应 ADR 和服务定义为准。

### 6.1 规划 ADR

| 规划 ADR | 覆盖范围 |
|----------|---------|
| `adr/ADR-{N}-oidc-iam-architecture.md` | OIDC 联邦、本地 IAM 权威源、issuer+subject 绑定、JIT pending principal、BFF session 管理、break-glass 路径 |
| `adr/ADR-{N}-vault-integration.md` | Vault HA 拓扑、auto-unseal / key custody、secret-zero 处理、SecretProvider v0.2 契约、rotation 策略 |
| `adr/ADR-{N}-m-deploy-service.md` | M-Deploy GitOps pull-reconcile 架构、Git desired-state 源、OpenTofu/Terraform libvirt fixture、OCI 镜像构建与发布 |
| `adr/ADR-{N}-production-topology.md` | 3 control/state + 3 OpenSearch + 2 Leaf VM 拓扑、Podman Full HA 编排、网络规划、RPO/RTO 目标 |

### 6.2 规划服务定义

| 规划服务文档 | 覆盖范围 |
|-------------|---------|
| `services/m-deploy.md` | M-Deploy GitOps/IaC 功能域：pull-reconcile 控制器、desired-state 源、部署拓扑声明、健康检查、回滚语义 |
| `services/m-ui-bff.md`（更新） | OIDC callback 路由、HttpOnly session 管理、logout、session 刷新 |
| `services/m-net.md`（更新） | NetBird 客户端 sidecar 数据面集成、profile 生命周期扩展、节点连通性验证 |

### 6.3 规划契约更新

| 规划契约文档 | 覆盖范围 |
|-------------|---------|
| `contracts/REST-API-MVP.md`（更新） | OIDC login/logout/session 端点、M-Deploy reconcile API |
| `contracts/EDEN-MVP.md`（更新） | 内部契约对齐 OIDC session 和 M-Deploy reconcile |
| `security/SECURITY-MODEL.md`（更新） | OIDC 威胁模型、session 安全、break-glass 访问控制、Vault 访问控制、secret 操作审计 |
| `operations/RUNBOOK.md`（更新） | 生产拓扑运维、Podman HA 编排、Vault 运维（seal/unseal/备份/恢复）、OIDC 故障恢复 |
| `testing/TESTING.md`（更新） | 生产轨道 TDD 门禁、OIDC 故障矩阵测试、Vault 集成测试、M-Deploy reconcile 测试 |
