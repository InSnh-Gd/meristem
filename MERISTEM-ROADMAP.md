# MERISTEM-ROADMAP - v0.2 Current State (v0.1 Baseline Delivered)

> This document is the single active roadmap for Meristem. It states the current product version (v0.2), the acceptance matrix, and the post-v0.2 track list.
>
> **版本词汇约定**：`Identity v0.2`、`SecretRef v0.1`、`SecretProvider v0.2`、`Config Lifecycle v0.1`、`SDUI v0.2`、`m-net@0.3.0` 是子契约版本号，不是产品发布版本。产品发布版本只有本文档声明的 v0.2。
>
> If this roadmap conflicts with `MERISTEM.md`, `MERISTEM-DEV.md`, or active contract docs, the root intent and engineering documents win. Deferred work lives in `DEFERRED-WORK.md`.

---

## 1. Current Version: v0.2

v0.2 是当前产品版本。v0.1 基线（Core bootstrap、REST/Eden/CLI 契约、节点与 M-Net 控制面、三级日志、RBAC 与审批、服务生命周期、M-Task cutover、读模型与运维、M-UI workbench 契约）已交付并保持为验收底线。

在 v0.1 基线之上，v0.2 交付并声明以下当前状态：

1. **M-Net 数据面方向确定为 NetBird-only（ADR-N04）**：profile 契约 `m-net@0.3.0` / `m-net-cn@0.3.0` 承载 NetBird 数据面语义，`m-net-cn@0.2.0`（WireGuard + wstunnel）作为迁移窗口内的 legacy 路径；sidecar viability gate `bun run mnet:v02:sidecar-proof` 守护实施承诺。
2. **Identity v0.2 本地身份硬化**：本地 actor token 模型、权限继承与身份表组（见 `docs/security/SECURITY-MODEL.md` §2.2.1、`docs/data/POSTGRES-SCHEMA.md`）。
3. **SecretProvider v0.2 生产后端契约**：Vault KV v2 兼容的 production SecretProvider backend 契约与 SecretRef 规则（见 `docs/security/SECURITY-MODEL.md`）。
4. **SDUI v0.2 路由注册表与 CommandWell mutation 执行流**：审批 approve/reject 与网络 profile enable/disable 的 preview + execute 全链路（`docs/ui/SDUI-SCHEMA.md`、`docs/services/m-ui-bff.md`）。
5. **Config Lifecycle v0.1 可执行子集**：draft → validated → published → applied → rolled_back，hash 版本化与 secretRef 合规（`docs/config/CONFIG-LIFECYCLE.md`）。
6. **M-Net 多节点验证与运维 harness**：three-node validation、multihost harness contract tests 与 preflight 工具（`docs/operations/`）。

v0.2 的发布验收以操作者视角表述。发布完成仅当操作者可以：

1. start Core and inspect health through REST, Eden-backed CLI, and transitional M-UI workbench contracts;
2. register and observe Stem / Leaf node records with restricted Leaf semantics;
3. submit a simple task through the canonical task boundary;
4. publish events and correlate them with Timeline / Full / Audit log facts;
5. enforce RBAC and high-risk policy decisions through M-Policy;
6. validate service lifecycle registration and reload behavior;
7. observe traces, failure modes, and documented degraded behavior.

---

## 2. v0.2 Guardrails

v0.2 延续 v0.1 基线护栏，仍然有意收窄：

```text
Core remains a microkernel.
M-Policy implements RBAC and bounded approval primitives only.
LLM remains auxiliary explanation space, not an authorization root.
M-Net data plane is NetBird-only at runtime (ADR-N04); NetBird Management is excluded.
M-Extension is supplemental, not a primary capability host.
PostgreSQL is the authoritative write model.
OpenSearch is a read model / projection target, not authority.
NATS carries events and lightweight KV/cache roles.
APISIX, Redis / KeyDB, Wasm, Zig, and heavier deployment packs stay optional.
```

Any change that expands Core responsibility, creates implicit service coupling, weakens Audit behavior, or bypasses M-Policy is out of scope unless `MERISTEM.md` and the affected contract docs are updated first.

---

## 3. Acceptance Matrix

| Area | Required Outcome | Canonical Docs |
|------|------------------|----------------|
| Core bootstrap | Core starts, composes Elysia routes, exposes health and OpenAPI | `MERISTEM-DEV.md`, `docs/services/core.md`, `docs/contracts/REST-API.md` |
| REST / Eden | REST v0 routes and internal Eden contract stay aligned | `docs/contracts/REST-API.md`, `docs/contracts/EDEN.md`, `docs/contracts/CONTRACT-VERSIONING.md` |
| CLI | Official CLI covers health, node, network, task, service, log, and policy flows | `docs/contracts/CLI-COMMANDS.md`, `docs/services/m-cli.md` |
| Service lifecycle | Service definitions, dependency checks, lifecycle events, reload behavior are declared and tested | `docs/services/SERVICE-DEFINITION-TEMPLATE.md`, `docs/contracts/SERVICE-LIFECYCLE.md` |
| Nodes and M-Net | Stem / Leaf records, logical networks, profile lifecycle boundaries, and node-agent sessions are auditable | `docs/services/m-net.md`, `docs/services/node-agent.md`, `docs/adr/ADR-N01-m-net-default-network.md`, `docs/adr/ADR-N02-m-net-cn-profile.md`, `docs/adr/ADR-N03-m-net-production-data-plane.md` |
| M-Task | Task submission and lifecycle state are owned by M-Task, not ad hoc Core fields | `docs/services/m-task.md`, `docs/adr/ADR-T01-m-task-canonical-service.md` |
| Events | Event envelopes, subjects, schema versions, correlation, and causation are stable | `docs/events/EVENT-CATALOG.md`, `packages/events/` tests |
| Logs | Timeline / Full / Audit facts remain distinct and trace-correlated | `docs/services/m-log.md`, `docs/security/SECURITY-MODEL.md` |
| Policy | RBAC and bounded high-risk decisions fail closed and write Audit facts | `docs/services/m-policy.md`, `docs/security/SECURITY-MODEL.md`, `docs/adr/ADR-F02-architecture-organization.md` |
| State | PostgreSQL write model, read model, cache, event state, draft state, and log facts are not conflated | `docs/data/STATE-MODEL.md`, `docs/data/POSTGRES-SCHEMA.md` |
| Config and secrets | Config lifecycle and SecretRef responsibilities are explicit and auditable | `docs/config/CONFIG-LIFECYCLE.md`, `docs/adr/ADR-F02-architecture-organization.md` |
| UI / BFF | M-UI, BFF, and SDUI organize operational state, command eligibility, and traceable workbench structure through active UI/BFF contracts | `docs/ui/SDUI-SCHEMA.md`, `docs/services/m-ui-bff.md` |
| Operations | Bun-only local operation, optional deployment pack, ports, and degraded modes are documented | `docs/operations/RUNBOOK.md`, `docs/operations/OPTIONAL-DEPLOYMENT-PACK.md` |
| Tests | Typecheck, contracts, failure modes, integration, CLI, e2e, and Node.js-ban gates are selected by boundary | `docs/testing/TESTING.md` |

---

## 4. Implementation Order

The old phase documents are retired. Use this implementation order when planning remaining work:

1. **Foundation** - Core bootstrap, Elysia app composition, OpenAPI, Bun-only scripts, strict TypeScript.
2. **Contracts** - REST, Eden, CLI, service definition, event envelope, state schemas.
3. **Node and network control plane** - Stem / Leaf records, node-agent sessions, logical networks, profile state.
4. **Logs and policy** - Timeline / Full / Audit, RBAC, high-risk decisions, trace correlation.
5. **Service lifecycle and M-Task** - service registry / reload and canonical task lifecycle ownership.
6. **Read model and operations** - projection behavior, OpenSearch failure handling, optional deployment pack.
7. **M-UI workbench alignment** - SDUI/BFF transitional workbench contracts, CommandWell restrictions, operator-visible audit and policy state, and a front-end structure that can evolve into the formal operator workbench.
8. **Acceptance closure** - drift search, smoke plan, failure-mode review, deferred-work audit.

Each slice must update its owning service, contract, security, data, operation, and testing docs in the same change.

---

## 4.1 v0.2 M-Net Data-Plane Direction (Current)

v0.2 数据面方向由 ADR-N04 声明并为当前方向：**NetBird-only at runtime**，排除 NetBird Management。

### 关键 Gate

在 Meristem 对 NetBird 客户端 sidecar 集成做出实施承诺之前，必须先通过 viability proof：

```bash
bun run mnet:v02:sidecar-proof
```

该 proof 验证 NetBird 客户端可在无 Management 模式下运行，并通过 Signal + Relay/STUN 建立 WireGuard 隧道。

### Profile 状态

- `m-net@0.3.0` 和 `m-net-cn@0.3.0`：NetBird 数据面语义，v0.2 目标 profile。
- `m-net-cn@0.2.0`（WireGuard + wstunnel）：legacy profile，供已部署节点迁移窗口内使用（ADR-N03 legacy 路径）。
- v0.2 相对 legacy 路径是 breaking change：旧节点获得 typed migration-required / rebuild 指导。

### 回退

如果 sidecar-proof 未通过，回退方案为 Meristem 自有 WireGuard 渲染 + NetBird Signal/Relay/STUN 基础设施，仍排除 NetBird Management。见 ADR-N04 第 4 节。

---

## 5. Post-v0.2 Tracks

These tracks are not default v0.2 scope. Start them only by reopening a specific item in `DEFERRED-WORK.md` or by adding a new root roadmap section with acceptance criteria.

| Track | Boundary |
|-------|----------|
| LLM-assisted review | Auxiliary explanation only; never final authorization |
| Formal approval UI | BFF + SDUI + CommandWell contract first |
| Real M-Net data plane | NetBird-only runtime per ADR-N04; control-plane profile lifecycle stays separate from endpoint / route / secret data |
| M-Extension runtime depth | Registry, manifest, policy, lifecycle, and sandbox contracts before execution depth |
| Deployment hardening | Optional pack first; no default Kubernetes / Service Mesh assumption |
| Identity hardening | Core-owned local identity lifecycle and revocation before external IdP complexity |
| Secret operations | SecretRef governance through Core + M-Policy + M-Log, no standalone M-Secret module |
| Config operations | Draft, validate, publish, apply, ack, rollback with Audit and failure-mode gates |

---

## 6. Completion Evidence

A v0.2 completion claim must include:

```text
bun run lint
bun run typecheck
bun run test
bun run test:contracts
bun run test:cli
bun run test:failure-modes
bun run test:integration
bun run test:e2e
```

If infrastructure-dependent tests cannot run locally, the completion note must name the skipped gate, the missing dependency, and the fallback evidence. Contract and failure-mode tests should not be skipped for missing optional infrastructure.

---

## 7. 生产轨道（Post-v0.1 Production Track）

> **这不是 v0.1 范围扩大（scope creep）**。生产轨道是 v0.1 之后的独立交付轨道，不进入 v0.1 验收矩阵。v0.1 完成前不开始本轨道的代码实现。

### 7.1 轨道目标

v0.1 证明了 Meristem 在单机 Bun 开发环境下的控制平面契约完整性。生产轨道将 Meristem 推进到可部署、可运维、具有完整身份认证和密钥管理的生产级状态：

1. **生产部署**：OCI 镜像在 3 台 control/state VM + 3 台 OpenSearch VM + 2 台 Leaf VM 上以 Podman 优先（Docker 兼容）的 Full HA 拓扑运行。
2. **M-UI 登录与 IAM**：操作员通过 OIDC 联邦登录进入 M-UI，本地 IAM 作为身份权威源。
3. **M-Net 完整管理**：M-Net 控制平面与 NetBird 客户端 sidecar 数据平面集成，覆盖 profile 生命周期、节点加入和网络连通性验证。
4. **OIDC 验证**：Keycloak 作为 OIDC Provider，issuer + subject 绑定、JIT pending principal 创建、BFF HttpOnly session 管理。
5. **真实 OpenSearch / Dashboards**：替换开发占位，提供日志检索、读模型查询和操作仪表盘。
6. **NetBird 客户端 sidecar**：每节点部署 NetBird 客户端 sidecar，与 M-Net 控制平面协作。
7. **Vault HA**：HashiCorp Vault 高可用部署，自动解封（auto-unseal）、密钥托管、轮换、SecretProvider v0.2 对齐。
8. **可观测性栈**：OpenTelemetry Collector、Prometheus、Grafana 生产部署，与 M-Log 和 Core traces 集成。
9. **M-Deploy 功能域**：新增 M-Deploy GitOps / IaC 能力域，以 Git 仓库为 desired-state 源，pull-reconcile 模式驱动部署。

### 7.2 关键决策摘要

| 决策域 | 决定 |
|--------|------|
| 容器运行时 | Podman 优先，Docker 兼容；不引入 Kubernetes |
| 拓扑 | 3 control/state + 3 OpenSearch + 2 Leaf VM，Full HA |
| 身份源 | 本地 IAM 拥有身份（不是 Keycloak）；Keycloak 仅做认证 |
| OIDC 绑定 | issuer + subject 绑定；JIT 创建 pending principal |
| 会话管理 | BFF 拥有 HttpOnly session cookie |
| 紧急访问 | 双人 30 分钟 TTL break-glass |
| 数据面 | NetBird 客户端 sidecar only，不引入 NetBird Management |
| 部署模式 | M-Deploy GitOps pull-reconcile；Git 是 desired-state 源 |
| 基础设施即代码 | OpenTofu / Terraform provider-neutral libvirt fixture |
| 密钥管理 | Vault HA，auto-unseal，SecretProvider v0.2 |
| 搜索 | OpenSearch / Dashboards 辅助；搜索可降级，控制不可静默降级，审计不可绕过 |
| RPO / RTO | RPO 15 分钟，RTO 1 小时 |
| 开发纪律 | TDD，实现前先更新 ADR、服务定义、契约、安全、运维和测试文档 |

### 7.3 生产轨道范围

本轨道覆盖以下能力域：

- **M-UI 登录 / IAM**：OIDC 联邦、本地 IAM 源、issuer + subject 绑定、JIT pending approval、BFF HttpOnly session、OIDC 故障矩阵、break-glass 路径。
- **M-Net 完整管理**：NetBird sidecar 集成、profile 生命周期、节点连通性验证、数据面可用性监控。
- **M-Deploy（新增功能域）**：GitOps pull-reconcile 部署控制器、OpenTofu / Terraform libvirt fixture、OCI 镜像构建与发布、Podman Full HA 编排。
- **密钥与安全加固**：Vault HA 部署、auto-unseal / key custody、secret rotation、SecretProvider v0.2 对齐、redaction 与审计。
- **可观测性生产化**：OpenTelemetry Collector、Prometheus、Grafana 生产拓扑、与 M-Log / Core traces 的集成。
- **OpenSearch / Dashboards**：真实部署替换开发占位、日志检索、读模型查询、操作仪表盘。

### 7.4 实现前置条件

**在代码实现完成前**，必须先更新以下文档：

| 文档类别 | 必须更新内容 |
|----------|-------------|
| ADR | 新增 M-Deploy 服务 ADR、OIDC/IAM 架构 ADR、Vault 集成 ADR、生产拓扑 ADR |
| 服务定义 | 新增 `docs/services/m-deploy.md`；更新 `docs/services/m-net.md`（data-plane sidecar）、`docs/services/m-ui-bff.md`（session/OIDC） |
| 契约 | 更新 REST 和 Eden 契约（OIDC login/logout/session、M-Deploy reconcile API）；新增 OIDC 故障矩阵 |
| 安全模型 | 更新 `docs/security/SECURITY-MODEL.md`（OIDC 威胁模型、session 安全、break-glass、Vault 访问控制） |
| 运维 | 更新 `docs/operations/RUNBOOK.md`（生产拓扑、Podman HA 编排、Vault 运维、OIDC 故障恢复） |
| 测试 | 更新 `docs/testing/TESTING.md`（生产轨道 TDD 门禁、OIDC 故障矩阵测试、Vault 集成测试、M-Deploy reconcile 测试） |

### 7.5 重新打开的工作项

生产轨道重新打开以下推迟工作项：

- **DFW-027**：生产身份提供者集成（OIDC / browser session / admin IAM）。见 `DEFERRED-WORK.md` 的更新条目。
- **DFW-028**：生产密钥后端（Vault / KMS / secret rotation）。见 `DEFERRED-WORK.md` 的更新条目。

### 7.6 排除项

以下内容明确不在本生产轨道范围内：

- Kubernetes、Helm、Service Mesh 部署模式
- NetBird Management 服务部署
- LLM 辅助审批执行（DFW-001 仍推迟）
- M-Extension Wasm 运行时（DFW-018 仍推迟）
- Redis / KeyDB 生产部署（DFW-024 仍推迟）
- APISIX 生产网关加固（DFW-025 仍推迟）
