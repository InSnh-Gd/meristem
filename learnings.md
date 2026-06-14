
## DFW Audit: Items 007–013

> Generated: 2026-06-04
> Source: `docs/roadmap/DEFERRED-WORK.md` lines 222–461 + source code audit

### DFW-007: Real M-Task Retry Execution — **STILL DEFERRED**

*Evidence:*
- Retry REST endpoint exists at `services/m-task/src/app.ts:323` (`POST /api/v0/tasks/:id/retry`) but always returns HTTP 501 with `not_implemented_yet` (line 330).
- Retry schema is `retryNotImplementedSchema` (lines 106–113) with `code: t.Literal('not_implemented_yet')`.
- Resume handler for `task.retry` explicitly states in a code comment: "不实现 retry 执行语义, 只记录 resume 成功" (line 399–401) — semantics confirmed at runtime with a warn-level Full Log entry.
- `task:retry` permission is defined in `packages/contracts/src/literals.ts:14`, seeded in `packages/db/src/seed.ts`, and included in operator/admin roles in `packages/policy/src/index.ts`. Policy decisions are exercised but short-circuit to 501.
- No `task_attempts` or `task_leases` PostgreSQL table exists in `packages/db/src/schema.ts` (required per reopen trigger).
- Event catalog (`docs/events/EVENT-CATALOG.md:82-83`) lists `task.retry.requested.v0` and `task.retry.rejected.v0` subjects, but these are not emitted from any source code — they remain planned but not wired.
- Contract tests (`tests/contracts/m-task-service.test.ts:135`) assert `not_implemented_yet`.
- CLI tests (`tests/cli/cli.test.ts:200-211`) also exercise the `not_implemented_yet` path.

### DFW-008: Agent Interrupt And Running-Task Cancellation Hardening — **STILL DEFERRED**

*Evidence:*
- No `apps/node-agent/` directory exists in the repository. The node agent runtime does not exist yet — so no interrupt frames, running-task registries, or force-interrupt can exist.
- Zero grep matches for "interrupt", "running.*task.*regist", "force.*cancel", "cancel.*race", "idempotent.*cancel", or "task.*frame" anywhere in the source tree.
- M-Task cancel (`app.ts:297-322`) is best-effort: it calls `deps.delivery.cancelDelivery()` and transitions state. There is no node-agent force path, no running-task registry on the agent side, and no cancellation-race handling.
- The reopen trigger was "tasks can run long enough or perform meaningful side effects where cancellation semantics matter" — currently only `noop` task type exists, so the trigger is not met.

### DFW-009: M-Task Multi-Worker Coordination And Queue Infrastructure — **STILL DEFERRED**

*Evidence:*
- Zero grep matches for "leader.election", "distributed.lock", "multi.worker", "task.lease", "task_attempts", "task_leases" across the entire repository.
- M-Task uses single-service in-memory + PostgreSQL semantics. No Redis/KeyDB adapter exists in the runtime.
- `services/m-net/src/index.ts` uses in-memory `pendingTasks` Map (line 105) for task dispatch — no distributed queue, no lease mechanism.
- Phase 16 explicitly excludes Redis adapter: "Runtime Redis / KeyDB Adapter Integration" is DFW-024, further deferred.
- The reopen trigger was "M-Task runs multiple workers or instances that can race on task timeout / retry / scheduling" — this hasn't happened.
- No concurrency model ADR exists.

### DFW-010: Production Historical Task Migration Compatibility — **PARTIALLY RESOLVED**

*Evidence:*
- The old Core-owned `tasks` table still exists in `packages/db/src/schema.ts:126-134` with the comment: "tasks 是 Core-owned MVP 路径的历史兼容表; canonical task state 由 M-Task 表组持有。"
- M-Task's `storage-adapter.ts` writes to the M-Task table group (`taskRequests`, `taskTransitions`, `taskResults`, `taskCancellations`) exclusively, not to `tasks`.
- The storage adapter comment (line 57-58): "Core 旧 tasks 表只保留历史兼容, 不再作为任务生命周期事实来源。"
- *Resolved:* The dual-tables architecture is in place — M-Task owns canonical state; Core's `tasks` is preserved as a read-only historical compatibility shim.
- *Still deferred:* No production-grade migration script, rollback plan, compatibility window contract, or old/new contract compatibility tests exist. The reopen trigger ("real user data exists in Core-owned task tables") has not been met — still in local dev mode.
- M-Task `index.ts` does not read from Core's `tasks` table at all — it only creates its own.

### DFW-011: M-Net CN Data Plane — **STILL DEFERRED**

*Evidence:*
- Profile definitions in `services/m-net/src/profile-store.ts:49-82` explicitly set: `realDerpRelay: false`, `realTcpInterconnect: false`, `realUdpPathSwitching: false` for both `m-net-default@0.1.0` and `m-net-cn@0.1.0`.
- `m-net-cn@0.1.0` is tagged `controlPlaneOnly: true` (line 79).
- Zero grep matches for "data.plane", "derp", "tcp.*interconnect", "headscale", "stun", "turn" in TypeScript source code.
- The event catalog (`docs/events/EVENT-CATALOG.md:86`) lists `mnet.derp.fallback.changed.v0` as a subject, but no code emits this event — it's a planned/ghost subject.
- ADR-024 (`docs/adr/ADR-024-m-net-cn-profile.md`) line 15 explicitly states: "Real data-plane behavior — DERP relay, TCP tunnels, UDP path switching, Headscale control, active probing, latency measurement... is explicitly deferred."
- The Phase 20 acceptance matrix (line 163) confirms "data-plane M-Net CN transport" is a non-goal.
- M-Net implements only control-plane profile lifecycle: definitions, per-network state, transitions, suspended enable operations, and Phase 12 approval integration.

### DFW-012: Generic Config Lifecycle Subsystem — **PARTIALLY RESOLVED**

*Evidence:*
- Phase 19 implemented Config Lifecycle v0.1 as a generic subsystem owned by Core.
- Full state machine exists at `apps/core/src/config-state-machine.ts` with states: draft → validated → published → applied → rolled_back.
- PostgreSQL tables: `configRecords`, `configVersions`, `configTransitions`, `configApplyAcks` (schema.ts lines 390-444).
- REST routes at `apps/core/src/routes/config.ts` implement: list, get, draft, validate, publish, rollback, applyAck.
- Config lifecycle currently supports: draft/validate/publish/apply/ack/rollback with hash-versioning, secretRef compliance, and M-Policy support.
- *Resolved:* The basic generic lifecycle IS implemented with versioning, hashing, publish/apply/ack semantics, and rollback.
- *Still deferred:* "node-level apply acknowledgements" (distributed ack from multiple nodes) is not implemented — the current ack system targets config service domains, not nodes. "Generic config records for multiple domains" is implemented (supports core, m-net, m-policy, m-log, m-extension, m-ui). M-Net profile lifecycle has NOT been absorbed into the generic config lifecycle (Phase 19 line 41: "does not replace Phase 13 M-Net profile lifecycle; it only creates the generic lifecycle that M-Net can later absorb").
- Phase 20 smoke scenario (line 132) confirms the config lifecycle is expected to be exercised end-to-end.

### DFW-013: M-Net CN Runtime Configuration And Secrets — **STILL DEFERRED**

*Evidence:*
- No grep matches for "runtime.config", "runtime.secret" or any actual runtime transport configuration in M-Net source code.
- Profile definitions in `profile-store.ts` contain no DERP endpoint URLs, TLS private material, STUN/TURN credentials, Headscale keys, regional IP ranges, or routing tables — they are purely declarative metadata.
- Phase 18 SecretRef v0.1 control plane exists (`apps/core/src/routes/secrets.ts`, schema `secret_refs`/`secret_ref_versions`/`secret_ref_transitions`), but M-Net does not consume SecretRef for runtime transport secrets. The SecretRef system is a general-purpose mechanism, not wired to M-Net data-plane config.
- ADR-024 line 21-22: "M-Net CN remains a per-network optional profile... `m-net-cn@0.1.0` is marked `controlPlaneOnly: true` and contains no real endpoint, secret, route, or probe data."
- The reopen trigger was "M-Net data-plane phase is accepted" and "secretRef and network runtime config contracts are ready" — the first condition is not met (DFW-011 is deferred), and the second is partially met (SecretRef exists but the network runtime config contract doesn't).

## DFW-014 → DFW-029 状态调查（2026-06-04）

按照 docs/roadmap/DEFERRED-WORK.md 对 DFW-014 至 DFW-029 的调查。每个项目根据代码和文档证据分类为：STILL DEFERRED、PARTIALLY RESOLVED 或 RESOLVED。

### DFW-014：全局 M-Net 配置文件默认值或全局开关 → 仍然推迟
- M-Net 严格按网络应用配置文件（`POST /networks/:id/profile`——每个网络一个）。
- 无全局启用/禁用机制，无默认配置文件选择逻辑，无大规模迁移。
- 种子数据中每条网络创建时分配 `m-net-default@0.1.0`。
- 证据：`services/m-net/src/app.ts` 第 456-624 行，仅按网络运行。

### DFW-015：M-Net CN 禁用的审批要求 → 仍然推迟（按设计）
- 禁用流程直接使用 M-Policy allow + Audit，无需审批。
- 代码：`services/m-net/src/app.ts` 第 549-614 行——无审批创建，仅执行策略和审计。
- Phase 13 规范明确：禁用在 "立即执行" 路径上。
- DEFERRED-WORK.md 本身说明为 "非默认必需"。

### DFW-016：M-Net 配置文件 UI → 仍然推迟
- M-UI 控制室具有节点、服务、时间线视图——无网络配置文件屏幕。
- 无配置文件列表、启用/禁用 UI、`controlPlaneOnly` 警告显示。
- CLI 支持 Phase 13 中的配置文件命令，但无 UI/BFF 表面。
- 证据：`apps/m-ui/src/routes/`——无配置文件路由。

### DFW-017：针对推迟流程的广泛事件网格或投影扩展 → 仍然推迟
- 事件目录包含审批生命周期事件，但**无投票级别事件**（`policy.approval.vote.cast.v0`）。
- 无审批评论事件、无行为分析投影。
- Phase 12 规范说明："投票事实存在于 PostgreSQL 和审计日志中。"
- 证据：`docs/events/EVENT-CATALOG.md` 第 327-340 行，未列出投票或评论事件。

### DFW-018：真正的 M-Extension Wasm 运行时 → 仍然推迟
- M-Extension 支持仅声明类型的 `wasm-placeholder`——无 Wasm 运行时集成。
- 清单验证会拒绝 `wasmBinary` 等可执行字段。
- 未导入 Wasm3、Wasmtime、WASI、WIT 或组件模型。
- 证据：`services/m-extension/src/manifest.ts` 第 11 行（禁止字段），`app.ts` 第 63 行（`wasm-placeholder` 字面量）。

### DFW-019：M-Extension Webhook 入口和执行 → 仍然推迟
- M-Extension 支持 `webhook-declared` 作为清单类型，但**无 webhook 入口路由**。
- 无来源验证、重放保护、速率限制或有效负载架构注册。
- 证据：`services/m-extension/src/app.ts`——无 webhook 路由，仅控制平面 REST。

### DFW-020：M-Extension HTTP 回调或云函数运行时 → 仍然推迟
- 支持 `http-callback-placeholder` 作为仅声明类型。
- 无出站 HTTP 回调执行、无重试/超时/幂等性、无脚本/云函数运行时。
- 证据：与 DFW-019 相同——清单中仅占位符类型。

### DFW-021：非系统扩展作用域 → 仍然推迟
- M-Extension 严格强制执行 `system/default`。`assertSystemDefault()` 拒绝任何其他内容。
- 存储始终将 scopeType 固定为 `"system"`，scopeId 固定为 `"default"`。
- 证据：`services/m-extension/src/app.ts` 第 161-165 行，`store.ts` 第 97-98 行。

### DFW-022：M-Extension UI 和 BFF 表面 → 仍然推迟
- M-UI 中无扩展列表、详细信息、注册、启用/禁用屏幕。
- 控制室页面无扩展部分。
- M-UI BFF 无扩展路由。
- 证据：`apps/m-ui/src/routes/`——无扩展路由，`apps/m-ui-bff/` 无扩展处理。

### DFW-023：动态扩展权限注册中心和市场 → 仍然推迟
- 扩展会对照 `packages/contracts/src/literals.ts` 中固定的已知权限集进行验证。
- 清单验证会拒绝未知权限（`app.ts` 第 73 行）。
- 无权限命名空间注册、无市场安装/升级/卸载、无包签名。
- 证据：`services/m-extension/src/manifest.ts` 第 71-74 行。

### DFW-024：运行时 Redis / KeyDB 适配器集成 → 仍然推迟
- Redis 作为可选的编写配置文件存在（Phase 16 交付），但**无服务使用 Redis**。
- 无会话、速率限制、锁、队列、任务协调或缓存状态使用 Redis。
- NATS KV 仍是默认缓存模型。
- 证据：`services/` 下无 `redis` 或 `keydb` 导入，`docker-compose.yml` 中仅编写配置文件。

### DFW-025：生产级 APISIX 网关加固 → 仍然推迟
- APISIX 使用基本 YAML 静态配置的可选编写配置文件存在。
- 无 TLS 终止、无认证预检插件、无生产级速率限制策略、无金丝雀发布、无 webhook 入口。
- 证据：`ops/apisix/apisix.yaml`——仅基本路由和 `request-id` / `limit-count` 插件。

### DFW-026：分离容器服务运行时和镜像发布 → 仍然推迟
- 不存在任何 Meristem 服务的 Dockerfile。
- 全栈示例编写文件使用 `oven/bun:1` + `bun run dev:*`（开发模式），而非生产镜像。
- 文件头明确说明："当前内部服务 URL 在代码中面向回环，因此分离容器运行时需要后续配置工作。"
- 证据：`ops/compose/full-stack.example.yml` 第 3-4 行，缺少 `Dockerfile`。

### DFW-027：生产级身份提供商集成 → 仍然推迟
- Phase 17 实现了 Identity v0.2（本地 JWT、`jti` 撤销、内部令牌自省），但**全部为本地**。
- 身份架构使用 `issuer: "meristem-local"`。
- 无 OIDC、SSO、SAML、MFA、密码认证、cookie 会话、用户管理 UI、组/团队/部门或刷新令牌。
- 证据：`packages/contracts/src/schemas/identity.ts` 第 30 行（`issuer: "meristem-local"`），整个代码库中无 OIDC/SSO 导入。

### DFW-028：生产级密钥后端 → 仍然推迟
- Phase 18 实现了 SecretRef v0.1（Core 拥有元数据、写入一次/轮换路径、M-Policy 授权、M-Log 审计）。
- 但**无 Vault、KMS 或云密钥管理器集成**。
- 无信封加密、密钥租用、自动轮换计划、跨节点分发或备份/恢复。
- 证据：`services/m-log/` 下无 vault/kms 代码，Phase 18 规范明确推迟。

### DFW-029：广泛配置平台和配置编写 UI → 仍然推迟
- Phase 19 实现了最低限度的 Config Lifecycle v0.1（草稿/验证/发布/应用确认/回滚），包含 CLI 命令。
- 但**无协作式配置编辑、M-UI 配置编写工作流、推出阶段、节点级分发、功能标志平台、漂移修复或联邦**。
- 证据：`apps/core/src/routes/config.ts`——仅控制平面 CLI/REST 生命周期，无 UI。

### 总体结论
**所有 16 项推迟项目 (DFW-014 至 DFW-029) 仍然推迟。** 根据各自的阶段规范，这些项目被故意排除在外，没有后续阶段或非计划内工作来解决它们。相应的阶段（Phase 13 M-Net 控制平面、Phase 15 M-Extension 控制平面、Phase 16 可选部署包、Phase 17 Identity v0.2、Phase 18 SecretRef v0.1、Phase 19 配置生命周期 v0.1）全部按照规范交付了它们的最低可行范围，并明确将这些项目推迟给未来的工作。

Phase 20（v0.1 验收关闭）在第 2 节中确认："LLM 辅助审查仍然推迟"、"生产身份提供商仍然推迟"、"真正的 Wasm/webhook/云函数运行时仍然推迟"等。

无任何项目被 PARTIALLY RESOLVED——推迟的边界要么实现（如控制平面），要么未实现（如运行时/UI/生产集成），中间状态为零。
