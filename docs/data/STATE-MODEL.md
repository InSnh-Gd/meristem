# State Model

> Meristem must keep authoritative state, event state, cache state, read models, collaborative drafts, and log facts separate.

---

## 1. State Classes

| Class | Carrier | Owns | Must Not Become |
|-------|---------|------|-----------------|
| Authoritative State | PostgreSQL | users, roles, permissions, nodes, service definitions, config versions, secretRefs, M-Task task tables | event-only truth |
| Event State | M-EventBus / NATS | task events, node events, lifecycle events, network events, config publish events | authoritative database |
| Cache State | NATS KV first, Redis / KeyDB if needed | rate limit windows, ephemeral sessions, distributed lock, derived hot state | primary database |
| Read Model | OpenSearch or projection | log search, Timeline aggregation, Audit query, node state board, policy analysis view | authoritative system of record |
| Collaborative Draft State | Yjs or equivalent | config draft collaboration, UI schema draft | authoritative config |
| Log Facts | M-Log | Timeline, Full Log, Audit Log | mutable business state |

---

## 2. Initial Authoritative Entities

| Entity | Owner | Notes |
|--------|-------|-------|
| User | Core / M-Policy | base identity; exact auth provider remains separate |
| Role | M-Policy | RBAC baseline |
| Permission | M-Policy | resource/action/scope based |
| Actor / ActorToken / ActorTokenRevocation | Core | Identity v0.2 local-mode actor and token lifecycle state |
| Node | Core / M-Net | Core registers; M-Net updates reachability |
| NodeCredential | Core | hashed per-node agent credentials |
| Network | M-Net | logical node network owned by M-Net |
| NetworkMembership | M-Net | logical node-to-network membership; real path state remains separate |
| ServiceDefinition | Core | service contract entrypoint |
| ConfigVersion | Core / config subsystem | published config state |
| SecretRef | Core | value storage backend is implementation detail |
| SecretRefVersion / SecretRefTransition | Core | SecretRef v0.1 metadata, local value version, and lifecycle transition state |
| ConfigRecord / ConfigApplyAck / ConfigTransition | Core | Config Lifecycle v0.1 authoritative state |
| TaskRequest / TaskTransition / TaskResult / TaskCancellation | M-Task | canonical task lifecycle state |
| PolicyDecision | M-Policy | decision fact; high-risk copies into Audit Log |
| ExtensionDefinition / ExtensionInstance / ExtensionTransition | M-Extension | M-Extension control-plane registry and `system/default` instance state; no execution runtime state |

The MVP concrete schema is defined in `docs/data/POSTGRES-SCHEMA-MVP.md`.

---

## 3. Read Model Rule

OpenSearch projections may optimize:

- Full Log search
- Audit query
- Timeline aggregation
- M-Net historical path view
- M-Policy behavior analysis view

OpenSearch must never be the only place where authoritative state is stored.

---

## 4. Cache Rule

NATS KV is the default cache. Redis / KeyDB can be introduced only when one of these is required:

- complex cache semantics
- high-frequency rate limit
- complex distributed lock
- sorted set
- special session or ephemeral state
- external component requires Redis protocol

Introducing Redis / KeyDB requires a dependency note and failure behavior.

The optional deployment pack provides a Redis compose profile only. It does not introduce a runtime adapter or move any cache, session, lock, rate-limit, task queue, or coordination state to Redis. KeyDB remains a compatible candidate but has no optional deployment pack profile.

---

## 5. Data Change Checklist

Before adding new state, answer:

1. Is this authoritative, event, cache, read model, draft, or log fact?
2. Who owns writes?
3. Who can read it?
4. Does it need versioning?
5. Does it need Audit Log?
6. How does it degrade when storage is unavailable?
7. Does it affect Core / Stem / Leaf compatibility?

---

## 6. Projection Platform State Ownership

The Projection Platform adds three PostgreSQL tables, all owned by M-Log:

```text
projector_jobs
projection_cursors
projection_dlq
```

Ownership rules:

- these tables are authoritative state owned by M-Log
- they must not be used as cache or event state
- the concrete column definitions live in `POSTGRES-SCHEMA-MVP.md`

---

## 7. M-Extension Control Plane State Ownership

M-Extension owns these PostgreSQL authoritative tables:

```text
extension_definitions
extension_instances
extension_transitions
```

Ownership rules:

- these tables must not store executable code, Wasm binaries, raw webhook tokens, secret values, or runtime execution state
- `scopeType` / `scopeId` remain bounded to `system/default` in the current baseline
- the concrete column definitions live in `POSTGRES-SCHEMA-MVP.md`

---

## 8. Identity v0.2 State Ownership

Core owns these PostgreSQL authoritative tables:

```text
actors
actor_tokens
actor_token_revocations
```

Rules:

- token plaintext is never stored.
- `jti` is the revocation key.
- Capability domain services must use Core introspection and must not read these tables directly.
- the concrete column definitions live in `POSTGRES-SCHEMA-MVP.md`.

---

## 9. SecretRef v0.1 State Ownership

Core owns these PostgreSQL authoritative tables:

```text
secret_refs
secret_ref_versions
secret_ref_transitions
```

Rules:

- metadata must be non-secret.
- secret plaintext must not be returned after create / rotate.
- secret values must not appear in logs, projections, UI errors, LLM prompts, or event payloads.
- production KMS / Vault storage remains deferred.
- the concrete column definitions live in `POSTGRES-SCHEMA-MVP.md`.

---

## 10. Config Lifecycle v0.1 State Ownership

Core owns these PostgreSQL authoritative tables:

```text
config_records
config_versions
config_apply_acks
config_transitions
```

Rules:

- configuration state is authoritative in PostgreSQL.
- event subjects notify lifecycle changes but do not replace PostgreSQL as the authoritative state.
- config payloads must not contain secret plaintext; use `secretRef`.
- OpenSearch may project lifecycle facts but must not become the canonical authority.
- the concrete column definitions live in `POSTGRES-SCHEMA-MVP.md`.

## 11. Approval State Ownership

Approval flow adds three PostgreSQL authoritative tables owned by two services.

M-Policy-owned tables:

```text
policy_approvals
policy_approval_votes
```

M-Task-owned table:

```text
task_suspended_operations
```

Ownership rules:

- `policy_approvals.operation_id` references the origin operation by convention, not by cross-service foreign key
- PostgreSQL may be shared, but service ownership remains explicit
- the concrete column definitions live in `POSTGRES-SCHEMA-MVP.md`

### 11.1 M-Deploy Durable State Ownership

M-Deploy owns PostgreSQL operation, agent, proposal, evidence-reference, verified-envelope, and outbox tables listed in `POSTGRES-SCHEMA-MVP.md`. M-Policy remains the authority for approval records/votes and returns the persisted approval ID as the production quorum proof. M-Log owns `deployment_evidence`; M-Deploy stores only its redacted references.

Operation admission and completion transactionally group the operation snapshot, evidence metadata, and pending publication intents. A recreated production composition reads those rows from PostgreSQL and retries pending EventBus publication without rerunning a completed host runtime operation.

---

## 12. Production Authority Matrix

> 生产轨道 authority matrix 定义每个功能域的权威源（source-of-truth）、允许写入者、读模型/投影、缓存层、降级行为、审计义务和契约 owner。此矩阵是 post-v0.1 生产轨道的架构基线，通过 `MERISTEM-ROADMAP.md §7` 授权。

### 12.1 矩阵定义

| 域 | 权威源（Source of Truth） | 允许写入者（Allowed Writers） | 读模型 / 投影（Read-Model / Projection） | 缓存层（Cache Layers） | 降级行为（Degradation Behavior） | 审计义务（Audit Obligations） | 契约 Owner |
|---|---|---|---|---|---|---|---|
| **Identity** | PostgreSQL（local IAM）: principal 记录、角色、权限、状态 | Core (Identity v0.2): actor 生命周期；M-Policy: 角色/权限分配；security-admin: token issue/revoke | M-UI BFF 通过 Core 边界读取；OpenSearch 不投影 identity 权威状态 | NATS KV: token introspection 缓存（≤30s，仅 positive result） | OIDC provider 不可达时 BFF session 失效，但本地 IAM 仍可签发 break-glass token；token introspection 不可用返回 503 | 所有 token issue/revoke 写 Audit before mutation；actor 状态变更强制 Audit；break-glass 访问强制双人 + Audit | Core（Identity v0.2） |
| **Deployment** | Git 仓库（desired-state 源）+ PostgreSQL（M-Deploy operation/outbox metadata）；M-Deploy 是唯一的 reconcile 执行者 | M-Deploy: pull-reconcile 写入 VM 运行时状态；操作员通过 M-UI 提议变更，不直接写入 live state | OpenTofu/Terraform state（IaC 状态快照）；M-UI BFF 通过 Core 边界读取部署状态摘要 | 无独立缓存层；host-local runtime state 由显式 M-Deploy runtime adapter 管理 | M-Deploy 不可达时已部署服务继续运行；pending outbox 在重建 composition 后恢复；新控制操作 fail closed/degraded | 所有 reconcile 操作写 Audit；M-Policy owns quorum proof；M-Log owns deployment evidence；签名验证失败持久化 blocked + Audit | M-Deploy |
| **Network** | PostgreSQL（M-Net）: 网络拓扑、profile 状态、membership、ACL intent、relay 选择、key metadata | M-Net: 网络生命周期、profile 启用/禁用、topology 发布；Core: 网络创建、membership 注册入口 | M-UI BFF 通过 Core 边界读取网络状态；OpenSearch 可投影拓扑历史但非权威源 | NATS KV: 网络 map 缓存（signed map TTL 内有效，过期后 fail-closed） | NetBird sidecar 崩溃或 control-channel partition 驱动 degraded / fail_closed；网络 map 过期后 fail-closed；中继不可达时仅在有可用 direct path 且 policy 允许时降级 | 所有 CN enable/disable 写 Audit；profile 状态转换写 Audit；break-glass disable 强制 Audit；key rotation 写 Audit；Audit 不可用阻塞 CN 操作 | M-Net |
| **Audit** | PostgreSQL: 权威审计元数据（actor、action、resource、decisionId、result、correlationId）；不可变对象归档: 原始审计证据（raw evidence blob） | M-Log: 审计事实写入；M-Policy: policy decision 审计记录；Core: identity/secret 操作审计 | OpenSearch: 审计查询投影（只读，非权威）；M-UI BFF 通过 Core 边界读取审计数据（按 `audit:read` 过滤） | 无缓存；审计数据必须实时权威 | **审计不可绕过**：任何高权限操作在审计写入失败时必须 fail-closed；Audit Log 禁用仅限文档化的紧急恢复路径 | 审计自身写入操作也需要审计（meta-audit）；审计不可用阻塞所有高风险操作；disable audit 仅在紧急恢复时允许且本身强制审计 | M-Log |
| **Search** | 无；OpenSearch 是投影/辅助系统，不是任何域的权威源 | M-Log: 日志投影写入（Full Log、Timeline、Audit 投影）；读路径无写入 | OpenSearch: Full Log 搜索、Timeline 聚合、Audit 查询投影、节点状态面板、策略分析视图 | 无独立缓存 | **搜索可降级**：OpenSearch 不可达时搜索功能返回空结果或降级提示，不影响控制操作；控制操作不依赖 OpenSearch 可用性 | OpenSearch 投影写入失败写入 Full Log；投影不可用不触发 Audit（非高风险路径） | M-Log |
| **Observability** | 无；Prometheus/Grafana/Alertmanager/OpenTelemetry 是监控与可观测性栈，不是任何域的权威源 | Core / M-Log / M-Net / M-Task: 遥测数据输出（metrics、traces、logs）；无业务状态写入 | Grafana: 统一操作仪表盘（查询 Prometheus + OpenSearch）；Alertmanager: 告警路由 | Prometheus TSDB（metrics 存储）；OTel Collector buffer | 可观测性栈完全可降级：Prometheus/Grafana 不可达不影响控制操作；告警不可达时使用本地日志回退 | 无独立审计义务；可观测性栈不产生审计事实 | Core（OTel 集成）: M-Log（日志管道） |
| **Secret** | HashiCorp Vault HA（Integrated Storage / Raft）: secret 值存储；PostgreSQL: secretRef 元数据 | Core: secretRef 创建/轮换/禁用；Vault: secret 值读写（仅通过 SecretProvider v0.2 接口）；security-admin: secret 操作授权 | 无读模型；secret 值不出现在任何投影、日志、事件或 UI 中 | SecretProvider v0.2 内部缓存（stale-while-revalidate；过期缓存 fail-closed） | **fail-closed**：Vault sealed 或不可达时绝不允许降级到本地存储或返回明文 secret；SecretProvider 返回 typed error（provider_unavailable、secret_missing、permission_denied、unsupported_backend、stale_secret） | 所有 secret 变更写 Audit before mutation；secret 访问（read/use/rotate）写 Audit；Audit payload 不得包含 plaintext secret | Core（SecretRef v0.2） |
| **Desired State** | Git commit/digest: desired-state 指针与内容哈希；M-Deploy 签名 envelope | Git 仓库（push via PR/review）: desired-state 定义文件；M-Deploy: 签名验证 + reconcile；操作员通过 M-UI 提议，不直接写入 Git | M-UI BFF 通过 Core 边界读取 desired-state 摘要（commit hash、timestamp、sync status） | 无独立缓存；M-Deploy 本地 clone 状态 | Git 仓库不可达时 M-Deploy 使用上次成功同步的 desired-state 快照，拒绝过期快照超过 TTL 的 reconcile；M-UI 显示 stale 状态 | 所有 reconcile 操作写 Audit；desired-state envelope 签名验证结果写 Audit；签名验证失败阻塞 reconcile | M-Deploy（规划中） |
| **Evidence** | 分层架构: PostgreSQL（权威审计元数据 + operation correlation） → 不可变对象归档（原始 evidence blob，content-addressed） → OpenSearch（查询投影） | M-Log: evidence 事实写入 PostgreSQL + 对象归档；M-Policy: policy decision evidence；Core: identity/secret operation evidence | OpenSearch: evidence 查询投影（只读，不可变） | NATS KV: evidence correlation cache（≤60s） | Evidence 写入失败时高风险操作 fail-closed；evidence 查询降级时不影响控制操作（与 Search 降级规则一致） | 所有 evidence 写入操作需审计；evidence 不可变归档写入失败写入 Audit | M-Log |

### 12.2 降级行为规则

以下降级行为规则适用于所有生产轨道服务：

| 类别 | 规则 |
|------|------|
| **搜索 (Search)** | 可降级。OpenSearch / Dashboards 不可达时搜索返回空结果或降级提示。控制决策不依赖搜索可用性。 |
| **控制 (Control)** | 不可静默降级。任何控制操作（身份变更、网络变更、部署变更、secret 操作、desired-state 变更）在其权威存储不可用时必须 fail-closed，返回 typed error 并在 UI 中显示可见的降级原因。 |
| **审计 (Audit)** | 不可绕过。任何高风险操作在审计写入失败时必须 fail-closed。审计日志禁用仅限文档化的紧急恢复路径，且本身必须被审计。 |

### 12.3 M-UI / BFF 数据流规则

M-UI 和 M-UI BFF 的 authority 角色必须保持以下数据流边界：

```text
M-UI（SvelteKit 路由与组件）
→ M-UI BFF（数据适配与 CommandWell 资格派生）
→ Core public facade（REST / OpenAPI）
→ M-* 功能域服务（权威事实、策略决策、审计事实）
```

具体规则：

- M-UI BFF 可聚合、裁剪、排序、标注 `stateSource`，推导展示用命令资格，但不拥有最终事实、最终授权或最终策略决策。
- M-UI BFF 不调用 M-Policy、M-Log 或 M-Net 内部 HTTP（`/internal/v0/*`）。
- M-UI BFF 不跨请求缓存 Core 数据。
- M-UI BFF 不创建审计事实。
- OpenSearch / Dashboards 被标记为 projection/auxiliary only，不在 authority matrix 中作为任何域的权威源。

### 12.4 契约版本规则

Authority matrix 中各域的契约版本受 `docs/contracts/CONTRACT-VERSIONING.md` 约束：

- 每个域的 API、Eden、事件、配置 schema 和服务定义必须版本化。
- 权威源变更（如从 PostgreSQL 迁移到新存储后端）属于 breaking change，需要新的大版本契约。
- 读模型/投影格式变更属于 non-breaking change，可增量 schema minor version。
- OpenSearch projection shape 不得成为契约权威。

---

## 13. Production Bootstrap / DR Restore Semantics

生产 bootstrap 和 disaster-recovery restore 必须遵守 authority matrix，不允许恢复顺序临时改变事实源。

### 13.1 Restore Authority Order

| Order | Subsystem | State Class | Restore Semantics |
|---:|---|---|---|
| 1 | PostgreSQL | Authoritative State / Log Facts metadata | 先恢复 identity、policy、node、config、secretRef metadata、deployment metadata、audit metadata 和 evidence metadata；PITR 后才能恢复依赖它的 projection。 |
| 2 | Vault | Secret backend | 在 PostgreSQL secretRef metadata 可读后恢复 secret values；校验 provider、keyPath、version 与 metadata 对齐。Vault sealed 时 secret path fail-closed。 |
| 3 | Keycloak | External authentication provider | 恢复 OIDC provider config；client secret / JWKS material 从 Vault reload；不得覆盖 PostgreSQL local IAM authority。 |
| 4 | NATS / JetStream | Event State | 恢复 stream 后从 PostgreSQL event store / transition tables replay 必需事件；事件不得覆盖 authoritative rows。 |
| 5 | M-Deploy desired-state | Desired State authority | 重新 clone Git，验证 signed envelope、commit digest、rollback pointer；agent reconnect 后才允许 reconcile。 |
| 6 | Registry | Deployment artifact trust | 验证 image signature 与 digest pin；mutable tag 不能作为恢复事实。 |
| 7 | OpenSearch | Read Model / Projection | 从 snapshot 恢复后以 PostgreSQL / M-Log 为权威 rebuild projection；查询 degraded 不影响控制操作。 |
| 8 | Redis / NATS KV cache | Cache State | cold start 或 rebuild；不得恢复为任何 authoritative state。 |

### 13.2 RPO / RTO State Responsibilities

| Subsystem | RPO | RTO | State Responsibility |
|---|---:|---:|---|
| PostgreSQL | 15m | 30m | authoritative write model、audit/evidence metadata、policy/identity/config/node/deployment metadata |
| Vault | 0 | 15m | secret values；Raft recovery + unseal 后才能服务 SecretProvider |
| NATS / JetStream | 0 | 15m | event delivery and replay transport；不作为 authority |
| Redis | best-effort | 15m | optional cache only；丢失后从 authority rebuild |
| OpenSearch | 1h | 2h | projection / auxiliary search；degradable |
| Keycloak | 15m | 30m | OIDC authentication provider config；authorization 仍在 PostgreSQL local IAM |
| M-Deploy desired-state | 0 | 15m | Git commit/digest + signed envelope；last successful snapshot 只能在 TTL 内使用 |
| Audit / evidence | 0 | 30m | PostgreSQL synchronous audit metadata + immutable raw evidence pointer |

### 13.3 Degraded Minimum State

- **IdP unavailable**：BFF session 和 OIDC login degraded；local IAM + M-Policy 可签发 30m TTL break-glass token，双人 approval，强制 Audit。
- **Vault sealed**：SecretProvider 返回 typed failure；secret 操作和新部署 fail-closed；已运行服务只可使用未过期 cached secret。
- **M-Net degraded**：不允许新 node join；signed map 在 TTL 内可继续使用，过期后 fail-closed；M-UI 必须显示 degraded。
- **M-Deploy agent disconnected**：保留 last-known state；drift reporting 暂停；禁止新的 desired-state apply。
- **Git desired-state unavailable**：last successful sync snapshot 只能做只读展示或 TTL 内恢复参考；超过 TTL 拒绝 reconcile。
- **OpenSearch degraded**：查询降级；control、Audit、Secret、Desired State 不依赖 OpenSearch。
