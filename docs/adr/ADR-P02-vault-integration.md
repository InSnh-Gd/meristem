# ADR-P02: Vault Integration And SecretProvider Boundary

## 状态

Accepted

## 上下文

生产轨道需要 HA secret backend、工作负载认证、轮换、吊销和密钥托管，但 `MERISTEM.md` 与 ADR-F02 已确定不创建独立 M-Secret 功能域。将 secret value 放入 Git desired-state、环境文件、服务间契约、日志或 BFF payload 会破坏 Core/M-Policy/M-Log 的职责边界，并使部署、OIDC、M-Net 和 session 密钥出现不一致的 secret path。

`docs/security/SECURITY-MODEL.md` 定义 `SecretProvider v0.2` 和 Vault KV v2-compatible 首个生产 backend；`docs/operations/RUNBOOK.md` 定义 Vault HA、key custody、bootstrap 和恢复顺序。本 ADR 记录采用的架构和 fail-closed 语义，不主张 target environment 的 Vault HA、auto-unseal、Vault ceremony 或恢复演练已经完成。

## 决策

### Vault HA 与密钥托管

- 生产 secret value backend 采用运行在三台 control/state VM 上、使用 Integrated Storage / Raft 的 Vault HA。quorum、leader identity 和 seal state 必须可通过 `vault-health@0.2.0` 观察。
- 生产架构为受控 key custody 下的 auto-unseal 预留位置，但不因此引入 cloud KMS，也不把 auto-unseal 当作已验证运行时能力。provider-neutral libvirt validation fixture 继续使用人工 Shamir unseal ceremony；unseal shard 由不同 security-admin 分离保管，任一操作者不得持有 quorum。
- Vault root token、unseal shard、AppRole secret ID、OIDC client secret、registry credential、NetBird credential 和 node credential 均不得进入 Git、配置文件、环境文件、测试、日志、trace、event、evidence 或 operator-facing error envelope。

### SecretRef 是唯一应用边界

- Core 继续拥有 SecretRef metadata 与管理入口，M-Policy 授权 secret use/rotate/revoke，M-Log 写入审计；不创建 M-Secret 服务。
- `SecretProvider v0.2` 是所有运行时 consumer 的共同接口，只暴露 `read(ref)`、`list(prefix)` 和 `write(ref, value)`。runtime `SecretRef` 为 `{ provider, keyPath, version?, metadata? }`，跨服务、UI、日志与失败结果只允许暴露 `{ provider, keyPath, version? }` 的 redacted form。
- `vault-kv-v2` 是首个生产 backend，`local-dev-env` 只用于显式 local development。未来 KMS 或 cloud secret manager 可以实现相同接口与 redaction 规则，但不得新增绕过 SecretRef 的身份、网络或部署 secret path。
- 工作负载通过 AppRole 或等效 workload identity 使用默认拒绝、path-scoped Vault policy。服务间结果只携带 provider/method status、redacted role/secret references、TTL、renewable flag、opaque lease handle 与 Audit ID；明文仅可在本地 workload environment injection 的最后一步短暂使用。

### Secret-zero、轮换与故障语义

- secret-zero 是一次受控 ceremony：root token 仅初始化最小 Vault policy、workload identity 与 bootstrap SecretProvider credential，随后必须撤销或封存。它不得成为运行时 credential 或长期运维捷径。
- OIDC/JWKS、local IAM/Core signing、BFF session、NetBird、registry、node sidecar 和 M-Deploy env-secret binding 统一使用 Vault-backed SecretRef。轮换创建新 active KV v2 version，在新 signing/use 前停用旧 version，并以 `secret-rotation@0.2.0` 记录 actor、old/new version、Audit ID 和时间。
- revoke 使用 `secret-revoke@0.2.0`；撤销或过期的 workload credential 返回 typed authentication failure，绝不回退到 local storage。自动轮换调度仍被明确推迟。
- Vault sealed、unavailable、quorum-lost、permission denied、missing、stale、expired 或 revoked 时，secret read/write/rotate/revoke、new session/token issue/rotation 和需要 secret material 的 deploy/config operation 必须 fail closed。现有 workload 仅可使用未到期 cached secret；TTL 到期后必须返回 `stale_secret`，不得读取 plaintext fallback。

## 结果

- Vault HA 负责 secret value，PostgreSQL 保持 SecretRef metadata 权威，M-Policy 与 M-Log 保持授权和审计职责；OpenSearch 不是 secret 或审计权威源。
- M-Deploy agent 能在本地 runtime action 前通过 SecretProvider 解析 SecretRef，而控制器、Git desired-state、证据和服务间契约只保留 redacted reference、version 与 Audit linkage。
- sealed、denied 和失去 quorum 的状态会阻断受保护操作，而不是静默使用本地明文、过期缓存或 `local-dev-env` 兜底。
- 该选择增加 Vault Raft、custody ceremony、workload policy、SecretRef reconciliation、rotation 与灾备运维成本；生产部署仍须按照 `docs/operations/RUNBOOK.md` 执行 Vault health、custody、restore 和 fail-closed 环境门禁。

## 重访条件

- 经过独立 ADR 和演练证据证明的 self-hosted auto-unseal 方案可以满足 key custody、审计和恢复要求，且不把未批准的 cloud KMS 变成默认依赖。
- Vault HA 或 KV v2 无法满足已记录的可用性、恢复、租约或合规需求，而替代 backend 能实现相同 `SecretProvider v0.2`、SecretRef-only 和 fail-closed 语义。
- 需要自动 rotation scheduling、跨区域复制或新的 workload auth method，并且其契约、Audit、rollback 与泄漏防护已版本化。
- Vault restore 或 sealed-state 演练证明当前 RPO/RTO、custody 分离或 stale-secret 处理无法满足 `docs/operations/RUNBOOK.md` 的生产目标。
