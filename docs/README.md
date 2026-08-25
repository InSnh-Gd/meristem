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
| `ui/` | M-UI / SDUI 契约与活跃设计简报 | `ui/SDUI-SCHEMA.md` |
| `archive/` | 已归档的历史参考材料（非权威） | `archive/README.md` |
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

## 5. UI 契约

| Document | Role |
|----------|------|
| [`ui/SDUI-SCHEMA.md`](./ui/SDUI-SCHEMA.md) | Executable SDUI/BFF route and component contract |
| [`ui/M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md`](./ui/M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md) | Authoritative design brief for M-UI Transitional Workbench redesign |

The M-UI BFF service contract ([`services/m-ui-bff.md`](./services/m-ui-bff.md)) complements the above.

Earlier design exploration docs (tool evaluations, concept sketches, convergence rationale) have been moved to [`archive/ui/`](./archive/README.md) and are no longer authoritative.

---

## 6. 生产轨道架构文档（Accepted — Post-v0.1 Production Track）

> 以下 ADR 记录 `MERISTEM-ROADMAP.md §7` 要求的生产轨道架构决策。Accepted 表示架构边界已确定；Podman Full-HA、Vault custody、NetBird sidecar、OCI 发布和恢复演练仍须在目标环境执行对应 proof gate，不能由 ADR 状态替代。

### 6.1 Accepted ADRs

| ADR | 覆盖范围 |
|-----|---------|
| [ADR-P01: OIDC Federation And Local IAM Authority](adr/ADR-P01-oidc-iam-architecture.md) | OIDC 联邦、本地 IAM 权威源、issuer+subject 绑定、JIT pending principal、BFF session 管理、break-glass 路径 |
| [ADR-P02: Vault Integration And SecretProvider Boundary](adr/ADR-P02-vault-integration.md) | Vault HA、auto-unseal/key custody 方向、secret-zero、SecretProvider v0.2、rotation 与 sealed/denied fail-closed |
| [ADR-P03: M-Deploy GitOps Pull-Reconcile Service](adr/ADR-P03-m-deploy-service.md) | Git desired-state、signed envelope、OpenTofu/Terraform libvirt fixture、Podman、OCI provenance、policy/audit/evidence 与 rollback |
| [ADR-P04: Production VM Topology And Degraded Operation](adr/ADR-P04-production-topology.md) | 3 control/state + 3 OpenSearch + 2 Leaf VM、Podman Quadlet、网络边界、RPO/RTO 与 degraded behavior |

### 6.2 当前服务定义

| 服务文档 | 覆盖范围 |
|----------|---------|
| [M-Deploy](services/m-deploy.md) | Git desired-state verifier、pull-reconcile controller、deployment agent、drift、evidence 与 rollback 边界 |
| [M-UI BFF](services/m-ui-bff.md) | OIDC callback/session contract、HttpOnly cookie、rotation、revocation 与 logout 语义 |
| [M-Net](services/m-net.md) | NetBird runtime direction（ADR-N04）、profile lifecycle、node connectivity 与 data-plane proof boundary |

### 6.3 当前契约与运维文档

| 文档 | 覆盖范围 |
|------|---------|
| [REST API](contracts/REST-API-MVP.md) | OIDC、SecretRef、M-Deploy 与相关 public/internal HTTP 契约 |
| [Eden](contracts/EDEN-MVP.md) | Core、M-Deploy 与 agent internal typed-client 契约 |
| [Security Model](security/SECURITY-MODEL.md) | local IAM、Vault/SecretProvider、authority matrix 与 fail-closed 规则 |
| [Operations Runbook](operations/RUNBOOK.md) | Podman/Quadlet、Vault、bootstrap/DR、RPO/RTO 与 production proof procedures |
| [Testing Strategy](testing/TESTING.md) | 生产轨道 contract、failure-mode、integration 与 environment gate 要求 |
| [Production Readiness Evidence](production-readiness/READINESS-SUMMARY.md) | 实现、测试、运维与环境前置条件的 evidence index |
