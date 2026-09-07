# Meristem v0.2 Release Notes

> 产品当前版本：**v0.2**（基线：`v0.1.0`）。本文档记录 v0.2 相对 v0.1 基线的交付内容、破坏性变更与迁移指引。
>
> 版本词汇约定：`Identity v0.2`、`SecretProvider v0.2`、`SDUI v0.2`、`m-net@0.3.0` 是子契约版本号；产品发布版本以根目录 `MERISTEM-ROADMAP.md` 的声明为准（v0.2）。

---

## 1. 交付亮点

### M-Net 数据面（NetBird-only 方向，ADR-N04）

- 数据面运行时方向确定为 **NetBird-only**，排除 NetBird Management（`docs/adr/ADR-N04-netbird-runtime-integration.md`）。
- Profile 契约升级：`m-net@0.3.0` / `m-net-cn@0.3.0` 承载 NetBird 数据面语义；`m-net-cn@0.2.0`（WireGuard + wstunnel）保留为迁移窗口内的 legacy 路径（ADR-N03）。
- M-Net 新增 NetBird adapter、operational read model、forced-relay workflow 与 v0.3 profile lifecycle。
- node-agent 新增 sidecar lifecycle 管理：凭证轮换（credential rotation）与降级状态（degraded states）。
- 数据面基础硬化：signing key、P2P WireGuard + STUN、force-relay、运行时持久化。

### 身份与密钥

- **Identity v0.2** 本地身份硬化：本地 actor token 模型、权限继承与身份表组（`docs/security/SECURITY-MODEL.md` §2.2.1）。
- 新增 **OIDC / JWKS provider** 契约与实现边界。
- **SecretProvider v0.2**：Vault KV v2 兼容的生产 SecretProvider backend 契约；SecretRef 规则与 redaction 测试保持不变。
- Core 新增节点凭证 issue / revoke facade 路由。

### M-UI / BFF

- **SDUI v0.2** 路由注册表扩展：operational state、dataplane 与 CommandWell BFF 路由（`docs/ui/SDUI-SCHEMA.md`）。
- CommandWell mutation 执行流全链路：审批 approve / reject、网络 profile enable / disable 的 preview + execute（BFF → Core public facade → M-Policy / M-Net）。
- M-UI 新增 operational progress feed、credential lifecycle panel、节点控制状态展示；transitional workbench 结构保持（`CONTEXT.md` 词汇）。

### 契约与策略

- `packages/contracts` 新增 v0.3 profile、operational、deployment、auth、secret schema 组。
- M-Policy approval readers 与 seed 数据对齐 v0.3 profiles。
- 事件目录保持权威：profile lifecycle 与 vote-level 事件均为 active publisher（`docs/events/EVENT-CATALOG.md`）。

### 部署与验证工具

- **Dual-track 部署配置**：NixOS / OCI 双轨（`ops/nixos/`、`ops/compose/`）。
- 新增 proof 与 harness 脚本：
  - `bun run mnet:v02:sidecar-proof` — NetBird 无 Management 模式 viability gate。
  - `bun run mnet:v02:deploy-proof` — 部署形态验证。
  - `bun run mnet:harness:preflight|start|status|stop|reset` — M-Net multihost harness。
- 测试面新增 v0.2 contract、failure-mode、integration、Playwright、UI-contract、service 测试组。

---

## 2. 破坏性变更与迁移

| 变更 | 影响 | 迁移指引 |
|------|------|----------|
| M-Net profile cutover 到 `m-net@0.3.0` / `m-net-cn@0.3.0` | legacy `m-net-cn@0.2.0` 节点不再是目标 profile | 旧节点获得 typed `migration-required` 指导；迁移窗口内仍可运行 legacy 路径（ADR-N03）；按 rebuild 指导重建 |
| 数据面运行时排除 NetBird Management | 依赖 NetBird Management 的部署不被支持 | 使用 Signal + Relay/STUN 无 Management 模式；sidecar-proof 未通过时按 ADR-N04 §4 回退 |
| 文档集重组 | `REST-API-MVP.md` → `REST-API.md`、`EDEN-MVP.md` → `EDEN.md`、`POSTGRES-SCHEMA-MVP.md` → `POSTGRES-SCHEMA.md`、`SERVICE-LIFECYCLE-PROTOTYPE.md` → `SERVICE-LIFECYCLE.md`；historical M-UI 设计探索文档移除 | 按新路径引用契约文档；当前 UI 边界以 `docs/ui/SDUI-SCHEMA.md` 与 `docs/services/m-ui-bff.md` 为准 |

---

## 3. 完成证据门禁

发布声明必须附以下门禁结果（见 `MERISTEM-ROADMAP.md` §6 与操作者清单 `MERISTEM-V02-OPERATOR-CHECKLIST.md`）：

```text
bun run test:v02-gates
```

该门禁串联 frozen-lockfile 安装、format、lint、依赖图、三道 typecheck、contract / failure-mode / integration / CLI / UI-contract 测试与 agent-submit 漂移守卫；发布级验证再叠加 live proof：

```text
bun run test:v02-release
```

---

## 4. 延后工作

延后工作记录于根目录 `DEFERRED-WORK.md`（DFW-001 ~ DFW-030）。v0.2 明确不在本版本的：真实 NetBird 数据面 rollout 的全域迁移、LLM-assisted approval review、M-Extension runtime、production secret backend 实施。

---

## 5. Verification Gates

### 5.1 Deterministic CI and local gate split

Regular CI remains deterministic and fast. It must not depend on host-specific
capabilities such as Docker, NetBird, or elevated network permissions.

For the full local deterministic gate set, run:

```bash
bun run test:v02-gates
```

This gate covers install, formatting, linting, dependency graph checks,
typecheck, contract coverage, failure-mode coverage, integration coverage, CLI
coverage, UI contract coverage, and the agent-submit drift guard.

### 5.2 Release acceptance gate

The release acceptance command is:

```bash
bun run test:v02-release
```

`test:v02-release` runs the deterministic gate set and then executes the live
proof command:

```bash
bun run mnet:v02:live-proof --topology=three-host --oidc=keycloak
```

The release is not accepted unless live proof completes with success evidence.
Typed `prerequisite-missing` is not release success; it documents missing host
capabilities and must be treated as a blocked release path, not a deployable
result.
