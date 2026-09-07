# Config Lifecycle

> Hot reload is only safe when configuration changes are versioned, validated, published, acknowledged, and rollbackable.

This document applies to authoritative configuration changes. The current service reload prototype is a narrower runtime control path and does not replace this state machine; see `docs/contracts/SERVICE-LIFECYCLE.md`.

Config Lifecycle v0.1 implements the first subset of this lifecycle. It is intentionally narrower than a broad configuration platform or UI authoring system.

What Config Lifecycle v0.1 already delivers:

- generic config records for multiple domains (`core`, `m-net`, `m-policy`, `m-log`, `m-extension`, `m-ui`).
- executable subset: draft → validated → published → applied → rolled_back.
- hash-versioning, secretRef compliance, and M-Policy support.

What remains deferred:

- node-level apply acknowledgements (distributed ack from multiple nodes).
- absorbing M-Net profile lifecycle into the generic config lifecycle.

---

## 1. State Machine

```text
draft
-> validate
-> commit
-> version
-> hash/sign
-> publish
-> apply
-> ack
-> rollback
```

No implementation may skip validation, versioning, publish, apply, and ack.

Config Lifecycle v0.1 supports this executable subset:

```text
draft
-> validated
-> published
-> applied

validated -> failed
published -> failed
applied -> rolled_back
failed -> rolled_back
```

---

## 2. Config Record

```ts
type MConfigRecord = {
  configVersion: string;
  configHash: string;
  schemaVersion: string;
  targetScope: string[];
  publishedBy?: string;
  publishedAt?: string;
  appliedNodes: string[];
  failedNodes: string[];
  rollbackVersion?: string;
};
```

Config Lifecycle v0.1 config payloads must not contain plaintext secret values. Use `secretRef` for secret-bearing configuration.

---

## 3. Applicable Configs

- M-Net policy
- M-Net CN profile
- M-Policy rule
- microservice config
- M-UI SDUI schema
- M-Extension config
- Webhook config
- OpenTelemetry config

---

## 4. Policy and Audit

| Change | M-Policy | Audit Log |
|--------|----------|-----------|
| low-risk service config | optional in v0 | Timeline + Full |
| high-risk service config | required | required |
| M-Net policy | required | required |
| M-Net CN profile | required | required |
| M-Policy rule | required | required |
| secret-related config | required | required |
| SDUI schema | required if it exposes privileged action | Full, Audit if high-risk |

Config Lifecycle v0.1 ownership rules:

- Core owns generic config records, versions, transitions, and apply acknowledgements.
- domain services own domain-specific apply behavior.
- M-Policy authorizes protected publish / rollback.
- M-Log records Timeline, Full, and Audit facts.

---

## 5. Failure Behavior

| Failure | Behavior |
|---------|----------|
| validation fails | do not commit; write Full Log |
| publish fails | config remains previous version |
| node apply fails | mark node failed; do not assume convergence |
| ack missing | mark pending or failed after timeout |
| rollback fails | enter degraded mode and require manual review |

---

## 6. Done Criteria

- Schema validation is test-covered.
- Config hash is deterministic.
- Publish writes an event.
- Target nodes ack or fail explicitly.
- Rollback target version is known.
- High-risk config goes through M-Policy and Audit Log.

---

## 7. Production Bootstrap / DR Config Constraints

生产 bootstrap 和 DR 场景中的配置仍受本生命周期约束，不能用手工文件或临时 env 绕过 validation、hash、publish、apply、ack 和 rollback。

### 7.1 Secret-zero and SecretRef Rules

- Secret-zero 只允许作为受控 handoff：Vault root token、initial AppRole / workload credential、registry credential、OIDC client secret、NetBird credential 和 node runtime credential 不得写入 config payload、Git desired-state、example env、测试夹具或 evidence。
- 生产配置中的 secret-bearing 字段必须使用 `secretRef`。SecretProvider v0.2 解析失败时返回 typed failure，config apply 不得回退到 plaintext env。
- Vault sealed / unavailable 时，secret-related config publish、rollback 和 deployment apply fail-closed；已发布配置不因为 Vault 不可达而被自动改写。

SecretProvider v0.2 / Vault 配置约束：

- `vault-ha@0.2.0` 描述 Vault HA 拓扑：它保留 `backend: vault-kv-v2`、address、mount path 和 auth method reference，因此仍是现有 `SecretProviderConfig` 的 additive backend form；HA metadata 增加 3 个 control/state VM、Integrated Storage / Raft、unseal mode、key custody reference、secret-zero ceremony reference 和 workload auth reference。该契约不包含 root token、unseal shard、AppRole secret ID value 或任何 client secret 明文。
- `vault-workload-auth@0.2.0` 描述 M-Deploy agent 等 workload 如何认证到 Vault：AppRole 或等价 workload identity、redacted role ID / secret ID refs、policy ref、TTL、renewable 标志和 audit ID。credential 过期或撤销时，config apply 与 deploy-secret resolution 返回 closed typed failure 并 fail-closed；failure payload 不携带自由文本或 credential material。
- `vault-policy@0.2.0` 是 default-deny policy model。secret-bearing config publish / apply 只能引用具备对应 path capability 的 workload；缺少 permission 时返回 `permission_denied`，不得由 M-Deploy 或 Core 绕过。
- M-Deploy agent 在执行 signed desired-state apply 前解析 env-var-to-SecretRef binding。解析结果只能跨边界携带 redacted ref、resolved version、status、closed failure reason 和 audit ID；secret 值只进入本地 workload 注入点，不进入 config record、desired-state Git、event、log、trace 或 error response。
- rotation 使用 `secret-rotation@0.2.0`，记录 secret ID、old version、new version、actor、audit ID 和 timestamp；成功后旧版本 deactivated，新版本 active。revoke 使用 `secret-revoke@0.2.0`，记录 secret ID、actor、audit ID、revoked version 和 timestamp。
- Vault health 使用 `vault-health@0.2.0` 显式报告 `healthy | sealed | unavailable | quorum_lost` status、sealed、leader、quorum 与 Raft applied index。`vault_sealed`、`vault_unreachable` 或 `vault_quorum_lost` 时，secret-bearing config publish、rollback、apply、rotation、revoke 和 deploy-secret resolution 均 fail-closed。
- 已运行服务只可使用未过期 cached secret 到 TTL；缓存过期且 Vault 不可用时返回 `stale_secret`，不得回退到 env、local-dev provider 或旧明文配置。
- 生产 OIDC client secret、Core/local IAM signing secret、BFF session signing/encryption secret 必须使用 Vault-backed SecretRef。rotation 后旧版本 deactivated，新版本 active；revoke 或 TTL 到期后不得继续签发或轮换 session，必须返回 typed failure，并按对应身份/session 契约执行撤销或重新认证。

### 7.2 Desired-state and Registry Trust

- M-Deploy desired-state 是配置来源之一，但必须通过 Git signed envelope、commit digest pin、rollback pointer 和 schema validation 后才能进入 apply。
- Registry image reference 必须包含 digest pin，并通过 image signing verification；mutable tag 只能作为人类可读提示，不能作为生产 apply authority。
- Git desired-state unavailable 时，M-Deploy 只能使用 last successful sync snapshot；超过 TTL 的 snapshot 拒绝 reconcile，且不得由 operator 手工 live-edit 代替 Git。

### 7.3 Degraded Apply Rules

| Degraded Dependency | Config Behavior |
|---|---|
| IdP unavailable | protected publish / rollback 只能通过 local IAM break-glass；TTL 30m、双人 approval、强制 Audit |
| Vault sealed | secret-bearing apply fail-closed；无新部署；cached secret 过期后不得复用 |
| M-Net degraded | network config apply / node join 暂停；M-UI 显示 degraded；已有 signed map 到 TTL 后 fail-closed |
| M-Deploy agent disconnected | 不执行新的 desired-state apply；保留 last-known state；reconnect 后重新校验 envelope 和 digest |
| Git desired-state unavailable | last successful snapshot 只在 TTL 内有效；过期后拒绝 reconcile |
| OpenSearch degraded | config control path 不受阻；projection rebuild 延后，查询显示 degraded |
