# Config Lifecycle

> Hot reload is only safe when configuration changes are versioned, validated, published, acknowledged, and rollbackable.

This document applies to authoritative configuration changes. The current service reload prototype is a narrower runtime control path and does not replace this state machine; see `docs/contracts/SERVICE-LIFECYCLE-PROTOTYPE.md`.

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
