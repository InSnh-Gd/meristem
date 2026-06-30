# MERISTEM-ROADMAP - v0.1 Delivery Scope (v0.2 Direction Declared)

> This document is the single active roadmap for Meristem. It replaces the old per-phase files with one v0.1 scope, one acceptance matrix, and one post-v0.1 track list.
>
> If this roadmap conflicts with `MERISTEM.md`, `MERISTEM-DEV.md`, or active contract docs, the root intent and engineering documents win. Deferred work lives in `DEFERRED-WORK.md`.

---

## 1. v0.1 Product Goal

v0.1 proves that Meristem can operate as a lightweight, auditable Meristem network control plane without turning Core into a monolith.

The release is complete only when an operator can:

1. start Core and inspect health through REST, Eden-backed CLI, and transitional M-UI workbench contracts;
2. register and observe Stem / Leaf node records with restricted Leaf semantics;
3. submit a simple task through the canonical task boundary;
4. publish events and correlate them with Timeline / Full / Audit log facts;
5. enforce RBAC and high-risk policy decisions through M-Policy;
6. validate service lifecycle registration and reload behavior;
7. observe traces, failure modes, and documented degraded behavior.

---

## 2. v0.1 Guardrails

v0.1 is intentionally narrow:

```text
Core remains a microkernel.
M-Policy implements RBAC and bounded approval primitives only.
LLM remains auxiliary explanation space, not an authorization root.
M-Net proves control-plane and logical-network behavior; v0.2 data-plane direction is NetBird-only (ADR-N04).
M-Extension is supplemental, not a primary capability host.
PostgreSQL is the authoritative write model.
OpenSearch is a read model / projection target, not authority.
NATS carries events and lightweight KV/cache roles.
APISIX, Redis / KeyDB, Wasm, Zig, and heavier deployment packs stay optional.
```

Any change that expands Core responsibility, creates implicit service coupling, weakens Audit behavior, or bypasses M-Policy is out of scope unless `MERISTEM.md` and the affected contract docs are updated first.

---

## 3. v0.1 Acceptance Matrix

| Area | Required Outcome | Canonical Docs |
|------|------------------|----------------|
| Core bootstrap | Core starts, composes Elysia routes, exposes health and OpenAPI | `MERISTEM-DEV.md`, `docs/services/core.md`, `docs/contracts/REST-API-MVP.md` |
| REST / Eden | REST v0 routes and internal Eden contract stay aligned | `docs/contracts/REST-API-MVP.md`, `docs/contracts/EDEN-MVP.md`, `docs/contracts/CONTRACT-VERSIONING.md` |
| CLI | Official CLI covers health, node, network, task, service, log, and policy flows | `docs/contracts/CLI-COMMANDS.md`, `docs/services/m-cli.md` |
| Service lifecycle | Service definitions, dependency checks, lifecycle events, reload behavior are declared and tested | `docs/services/SERVICE-DEFINITION-TEMPLATE.md`, `docs/contracts/SERVICE-LIFECYCLE-PROTOTYPE.md` |
| Nodes and M-Net | Stem / Leaf records, logical networks, profile lifecycle boundaries, and node-agent sessions are auditable | `docs/services/m-net.md`, `docs/services/node-agent.md`, `docs/adr/ADR-N01-m-net-default-network.md`, `docs/adr/ADR-N02-m-net-cn-profile.md`, `docs/adr/ADR-N03-m-net-production-data-plane.md` |
| M-Task | Task submission and lifecycle state are owned by M-Task, not ad hoc Core fields | `docs/services/m-task.md`, `docs/adr/ADR-T01-m-task-canonical-service.md` |
| Events | Event envelopes, subjects, schema versions, correlation, and causation are stable | `docs/events/EVENT-CATALOG.md`, `packages/events/` tests |
| Logs | Timeline / Full / Audit facts remain distinct and trace-correlated | `docs/services/m-log.md`, `docs/security/SECURITY-MODEL.md` |
| Policy | RBAC and bounded high-risk decisions fail closed and write Audit facts | `docs/services/m-policy.md`, `docs/security/SECURITY-MODEL.md`, `docs/adr/ADR-F02-architecture-organization.md` |
| State | PostgreSQL write model, read model, cache, event state, draft state, and log facts are not conflated | `docs/data/STATE-MODEL.md`, `docs/data/POSTGRES-SCHEMA-MVP.md` |
| Config and secrets | Config lifecycle and SecretRef responsibilities are explicit and auditable | `docs/config/CONFIG-LIFECYCLE.md`, `docs/adr/ADR-F02-architecture-organization.md` |
| UI / BFF | M-UI, BFF, and SDUI organize operational state, command eligibility, and traceable workbench structure through active UI/BFF contracts | `docs/ui/SDUI-SCHEMA.md`, `docs/services/m-ui-bff.md` |
| Operations | Bun-only local operation, optional deployment pack, ports, and degraded modes are documented | `docs/operations/RUNBOOK.md`, `docs/operations/OPTIONAL-DEPLOYMENT-PACK.md` |
| Tests | Typecheck, contracts, failure modes, integration, CLI, e2e, and Node.js-ban gates are selected by boundary | `docs/testing/TESTING.md` |

---

## 4. Implementation Order

The old phase documents are retired. Use this implementation order when planning remaining v0.1 work:

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

## 4.1 v0.2 M-Net Data-Plane Direction

v0.2 数据面方向由 ADR-N04 声明：**NetBird-only at runtime**，排除 NetBird Management。

### 关键 Gate

在 Meristem 对 NetBird 客户端 sidecar 集成做出实施承诺之前，必须先通过 viability proof：

```bash
bun run mnet:v02:sidecar-proof
```

该 proof 验证 NetBird 客户端可在无 Management 模式下运行，并通过 Signal + Relay/STUN 建立 WireGuard 隧道。

### Profile 迁移

- `m-net@0.3.0` 和 `m-net-cn@0.3.0`：NetBird 数据面语义（v0.2 目标 profile）。
- `m-net-cn@0.2.0`（WireGuard + wstunnel）：旧版 profile，供已部署节点迁移窗口内使用（ADR-N03 旧版路径）。
- v0.2 是 breaking change：旧节点获得 typed migration-required / rebuild 指导。

### 回退

如果 sidecar-proof 未通过，回退方案为 Meristem 自有 WireGuard 渲染 + NetBird Signal/Relay/STUN 基础设施，仍排除 NetBird Management。见 ADR-N04 第 4 节。

---

## 5. Post-v0.1 Tracks

These tracks are not default v0.1 scope. Start them only by reopening a specific item in `DEFERRED-WORK.md` or by adding a new root roadmap section with acceptance criteria.

| Track | Boundary |
|-------|----------|
| LLM-assisted review | Auxiliary explanation only; never final authorization |
| Formal approval UI | BFF + SDUI + CommandWell contract first |
| Real M-Net data plane | v0.2 NetBird-only runtime direction per ADR-N04; control-plane profile lifecycle stays separate from endpoint / route / secret data |
| M-Extension runtime depth | Registry, manifest, policy, lifecycle, and sandbox contracts before execution depth |
| Deployment hardening | Optional pack first; no default Kubernetes / Service Mesh assumption |
| Identity hardening | Core-owned local identity lifecycle and revocation before external IdP complexity |
| Secret operations | SecretRef governance through Core + M-Policy + M-Log, no standalone M-Secret module |
| Config operations | Draft, validate, publish, apply, ack, rollback with Audit and failure-mode gates |

---

## 6. Completion Evidence

A v0.1 completion claim must include:

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
