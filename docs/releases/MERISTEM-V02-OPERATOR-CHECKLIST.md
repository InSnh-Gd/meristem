# Meristem v0.2 Operator Checklist

> v0.2 发布操作者清单。按顺序执行，每一项通过后再进入下一项；任何一项失败时停止并按对应文档回退。
>
> 证据文件（如有）统一放在 `tests/evidence/`，命名 `<feature>-<scenario>.<ext>`。

---

## 1. 前置依赖

- [ ] Bun 1.x 可用；确认不依赖 Node.js 运行时执行仓库代码。
- [ ] PostgreSQL 16+ 可达（`docs/operations/RUNBOOK.md` §依赖矩阵）。
- [ ] NATS 可达；OpenSearch 仅在读模型 / 投影验收时需要。
- [ ] M-Net 数据面验证主机具备 NetBird 客户端 artifacts（sidecar proof 与 harness 用）。

## 2. 数据库初始化

- [ ] `bun run db:migrate` — 建立或更新权威 schema（含 Identity v0.2、SecretRef、Config Lifecycle 表组）。
- [ ] `bun run db:seed` — 写入本地演示所需的固定用户、角色与权限矩阵。

## 3. 代码质量门禁

- [ ] `bun run lint`
- [ ] `bun run typecheck`（含 `typecheck:e2e`、`typecheck:m-ui`）
- [ ] `bun run test`
- [ ] `bun run test:contracts`
- [ ] `bun run test:cli`
- [ ] `bun run test:failure-modes`
- [ ] `bun run test:integration`
- [ ] `bun run test:e2e`
- [ ] `bun run test:agent-submit` — schema coverage map drift 与 M-Task cutover 对齐守卫。

## 4. M-Net v0.2 数据面专项

- [ ] `bun run mnet:v02:sidecar-proof` — NetBird 无 Management 模式 viability gate。
      未通过时：记录 typed fallback 输出，按 `docs/adr/ADR-N04-netbird-runtime-integration.md` §4 回退方案执行，不得宣称数据面就绪。
- [ ] `bun run mnet:harness:preflight` — multihost harness 前置检查。
- [ ] `bun run mnet:harness:start` → `status` → `stop`（需要时 `reset`）— 多主机组网演练。
- [ ] 三节点验证：按 `docs/operations/M-NET-THREE-NODE-VALIDATION.md` 执行并记录结果。
- [ ] `bun run mnet:v02:deploy-proof` — 部署形态验证（NixOS / OCI 双轨见 `ops/nixos/` 与 `ops/compose/`）。

## 5. 服务与运行验收

- [ ] `bun run dev:all` 启动标准本地栈；Core 健康、OpenAPI 可访问。
- [ ] CLI 走通 health / node / network / task / service / log / policy 流（`docs/contracts/CLI-COMMANDS.md`）。
- [ ] M-UI workbench：审批 approve / reject 与网络 profile enable / disable 的 CommandWell preview + execute 全链路；高风险操作显示确认与审计证据（correlationId / policyDecisionId）。
- [ ] profile 状态显示 `m-net@0.3.0` / `m-net-cn@0.3.0` 为目标 profile；legacy `m-net-cn@0.2.0` 节点显示 migration-required 指导。

## 6. 降级与故障路径抽查

- [ ] Audit Log 写失败阻断节点注册与任务提交（fail-closed）。
- [ ] OpenSearch 不可用时写模型不受影响，查询降级。
- [ ] M-Policy 不可用时高权限操作默认拒绝；安全管理员 break-glass 路径先写 Audit 再变更（`docs/security/SECURITY-MODEL.md`）。
- [ ] sidecar 凭证轮换与降级状态显示正确（node-agent）。

## 7. 收尾

- [ ] 对照 `MERISTEM-ROADMAP.md` §3 验收矩阵逐行确认。
- [ ] 对照 `docs/releases/MERISTEM-V02-RELEASE-NOTES.md` §2 确认破坏性变更已向受影响节点传达迁移指引。
- [ ] 未通过项按 `docs/testing/TESTING.md` 记录：跳过的门禁、缺失依赖、替代证据。
