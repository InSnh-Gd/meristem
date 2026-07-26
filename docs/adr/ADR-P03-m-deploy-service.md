# ADR-P03: M-Deploy GitOps Pull-Reconcile Service

## 状态

Accepted

## 上下文

生产轨道需要在固定 VM 拓扑上部署和回滚 Meristem，同时保留 Git desired-state、M-Policy 授权、M-Log Audit/evidence、SecretProvider 和节点信任边界。让 UI、控制器或人工 SSH 直接修改运行时会绕过 Git、签名、approval、Audit 和可回滚证据，也会让 M-Deploy 膨胀为 identity、policy、network 或 general remote-administration 服务。

`docs/services/m-deploy.md`、`docs/contracts/REST-API-MVP.md`、`docs/contracts/EDEN-MVP.md` 和 `docs/security/SECURITY-MODEL.md` 已定义 M-Deploy 的 versioned route、event、agent、runtime、provenance 和 authority contracts。本 ADR 接受该服务的生产轨道架构；它不表示任何 target VM、registry、OCI publication、Podman rollout 或 evidence archive 已得到 live proof。

## 决策

### Git-authoritative pull-reconcile

- 新增 M-Deploy 作为 internal capability domain service。Git repository 的 commit/digest 与 M-Deploy signed desired-state envelope 是 desired-state 权威；M-Deploy 只 pull/sync，不得编辑或 push Git 文件。
- M-Deploy 保存已验证 Git metadata、operation/proposal/approval linkage、drift report、agent enrollment、evidence metadata 与 previous verified rollback pointer，但不把 OpenTofu/Terraform state、agent last-known state 或 OpenSearch projection 作为 desired-state authority。
- controller scheduler 只安排已批准的 apply/rollback；enrolled agent 通过 pull-reconcile 取得工作，在本地重新验证 canonical envelope bytes、signature、signer/issuer/audience、key fingerprint、trust expiry 和 immutable digest 后，才解析 SecretRef 或调用本地 runtime adapter。
- controller SSH push、arbitrary remote shell、general host administration 和 M-Deploy 发起的 Git write 均被禁止。agent heartbeat 和 evidence 只能暴露健康、digest、typed runtime status、redacted references 与 correlation IDs，不得包含 plaintext secret 或 raw host command output。

### Runtime、IaC 与 OCI provenance

- 固定 VM 生产运行时是 rootless Podman Quadlet units，由 user systemd 监督。Podman runtime health、Quadlet/systemd availability 与 immutable image verification 不满足时，production apply/promotion 必须阻断。
- Docker Compose 仅用于本地 renderer compatibility 和 migration validation；它不能证明 HA、systemd supervision、rollback、runtime health 或 production readiness。
- OpenTofu/Terraform 通过 provider-neutral driver boundary 提供 libvirt topology fixture、plan/apply/drift comparison。IaC state 是 deployment snapshot/read model，不替代 Git desired-state 或 M-Deploy operation authority。
- OCI artifact 仅接受 digest-pinned reference，并要求 image digest、signature、signer、SBOM 与 provenance reference 一致。mutable/tag-only image 或不完整 provenance 必须 typed reject。

### Policy、Audit、evidence 与回滚

- proposal、approval、apply 和 rollback 经由 Core public facade，受 M-Policy 与 Audit 保护。M-Deploy 不拥有最终 authorization、approval quorum 或 Audit authority。
- production apply 需要 M-Policy 提供的、恰好两位 distinct eligible security-admin 且均非 proposer 的 quorum proof。rollback 是独立高风险操作，需要自己的 policy decision 和 Audit chain，不能复用 apply approval。
- high-risk mutation 前后均需要 M-Log Audit/evidence。M-Log 负责 immutable evidence fact/storage reference；M-Deploy 只保存 redacted reference 与 correlation metadata。Audit/evidence、signature、Git snapshot、PostgreSQL、SecretProvider 或 required runtime dependency 不可用时，protected operation fail closed。
- operation state、evidence metadata 和 event intent 在 EventBus dispatch 前原子持久化。dispatch failure 产生可见的 `publicationStatus: pending` 与 retryable intent，而不是将已完成 runtime action 伪装为失败。
- rollback 从 previously verified desired-state digest、OCI artifact 和 runtime combination 恢复；它不是 apply 失败时隐式执行的副作用。in-flight operation 在恢复前必须重新验证 policy、signature、Git digest 和 Audit/evidence availability。

## 结果

- Git、签名 envelope、OCI provenance、policy proof、Audit/evidence 和 agent-local verification 形成可追踪的 deployment authorization chain，而不是依赖 controller shell access。
- M-Deploy 可以报告 drift、agent health、operation/evidence linkage 和 pending publication，同时保持 Core identity、M-Policy decision、M-Log Audit/evidence、M-Net authority 与 SecretProvider ownership 不变。
- Podman/Quadlet 是唯一的 production runtime of record；Docker Compose 和 provider-neutral libvirt fixture 保留可移植验证价值，但不得被解释为 production proof。
- 该选择增加 agent enrollment、controller trust、Git snapshot TTL、signature management、OCI provenance、durable operation/outbox 和 systemd/Podman 运行时的运维复杂度。
- 环境中的 Podman Full-HA、signed registry artifact、agent reconcile、immutable evidence archive 和 rollback drill 仍须按 `docs/operations/RUNBOOK.md` 运行。ADR Accepted 不能替代这些 target-environment proof gates。

## 重访条件

- 已证明 pull-reconcile 无法满足记录的可用性、隔离或恢复目标，且替代模型仍能保留 agent-local verification、Git authority、M-Policy/Audit control 和不可变证据。
- Podman Quadlet/user systemd 无法满足运行时安全或恢复要求，且候选替代运行时不会引入 Kubernetes、Helm、service mesh 或 controller remote-shell semantics。
- provider-neutral IaC boundary 无法支持所需 topology fixture，且扩展 provider 后不会把 IaC state 升格为 desired-state authority。
- OCI signing、SBOM、provenance 或 rollback-pointer contract 出现需要 major-version migration 的兼容性或合规问题。
