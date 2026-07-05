# Security Model

> Meristem treats distributed nodes, extensions, webhooks, and LLM outputs as untrusted by default.

---

## 1. Security Principles

- Leaf Node defaults to minimum permission.
- M-Extension defaults to low permission.
- High-permission capability defaults to deny and must be explicitly authorized.
- High-risk operation must go through M-Policy.
- Audit Log is independent and high-trust.
- LLM is not an authorization root.
- Webhook source must be verified.
- Secret access must go through M-Policy.
- Public DERP fallback must be disableable.
- M-Net CN must be auditable.

---

## 2. RBAC Baseline

| Role | Purpose | Initial Permissions |
|------|---------|---------------------|
| `viewer` | read-only operational visibility | `core:read`, `node:read`, `service:read`, `timeline:read` |
| `operator` | routine operations | viewer + `node:operate`, `service:reload`, `log:read-full` |
| `admin` | privileged administration | operator + `service:register`, `config:publish`, `policy:manage` |
| `security-admin` | audit and secret governance | admin + `audit:read`, `secret:reference`, `policy:risk-manage` |

Rules:

- Roles are additive only through explicit assignment.
- High-risk actions still require M-Policy even for admin roles.
- Audit Log access is not implied by general Full Log access.

### 2.1 MVP RBAC Matrix

MVP uses a narrower permission set than the long-term baseline:

| Permission | viewer | operator | admin | security-admin |
|------------|--------|----------|-------|----------------|
| `core:read` | yes | yes | yes | yes |
| `node:register` | no | yes | yes | yes |
| `node:issue-token` | no | yes | yes | yes |
| `network:read` | yes | yes | yes | yes |
| `network:create` | no | yes | yes | yes |
| `network:join` | no | yes | yes | yes |
| `task:submit` | no | yes | yes | yes |
| `timeline:read` | yes | yes | yes | yes |
| `log:read-full` | no | yes | yes | yes |
| `audit:read` | no | no | no | yes |
| `service:register` | no | no | yes | yes |
| `service:reload` | no | yes | yes | yes |
| `projection:read` | no | yes | yes | yes |
| `projection:backfill` | no | no | yes | yes |
| `projection:dlq-manage` | no | no | yes | yes |
| `extension:read` | yes | yes | yes | yes |
| `extension:register` | no | no | yes | yes |
| `extension:enable` | no | no | yes | yes |
| `extension:disable` | no | no | yes | yes |
| `identity:read` | self | self | yes | yes |
| `identity:token-inspect` | no | no | yes | yes |
| `identity:token-issue` | no | no | no | yes |
| `identity:token-revoke` | no | no | no | yes |
| `secret:read-metadata` | no | no | yes | yes |
| `secret:create` | no | no | no | yes |
| `secret:rotate` | no | no | no | yes |
| `secret:disable` | no | no | no | yes |
| `secret:reference` | no | no | yes | yes |
| `config:read` | yes | yes | yes | yes |
| `config:draft` | no | no | yes | yes |
| `config:validate` | no | yes | yes | yes |
| `config:publish` | no | no | yes | yes |
| `config:rollback` | no | no | yes | yes |
| `policy:approval-read` | no | no | yes | yes |
| `policy:approval-approve` | no | no | no | yes |
| `policy:approval-reject` | no | no | no | yes |
| `policy:approval-manage` | no | no | no | yes |
| `network:profile-read` | no | yes | yes | yes |
| `network:profile-enable` | no | no | yes | yes |
| `network:profile-disable` | no | no | yes | yes |
| `deploy:desired-state-read` | no | yes | yes | yes |
| `deploy:desired-state-propose` | no | no | yes | yes |
| `deploy:desired-state-approve` | no | no | no | yes |
| `deploy:desired-state-apply` | no | no | no | yes |
| `deploy:desired-state-rollback` | no | no | no | yes |
| `deploy:drift-read` | no | yes | yes | yes |
| `deploy:evidence-read` | no | yes | yes | yes |
| `node:switch-role` | no | no | yes | yes |
| `node:disable` | no | no | yes | yes |
| `node:isolate` | no | no | yes | yes |
| `node:recover` | no | no | yes | yes |

MVP actor selection still supports locally signed JWT bearer tokens for local development. This remains a local-only provider and is not a production identity provider model.

Production identity provider integration now has an OIDC/JWKS access-token verification foundation for service-to-service and API bearer validation. Browser sessions, SSO UX, SAML, MFA, refresh-token handling, and user-management UI remain deferred.

### 2.2 MVP JWT Model

MVP JWTs use HS256 with `MERISTEM_JWT_SECRET`.

Required claims:

```ts
type MvpJwtClaims = {
  sub: "viewer" | "operator" | "admin" | "security-admin";
  iss: "meristem-local";
  aud: "meristem-core";
  iat: number;
  exp: number;
  jti: string;
};
```

Rules:

- CLI sends `Authorization: Bearer <jwt>`.
- The JWT `sub` is the actor ID literal in the current local seed set (`viewer`, `operator`, `admin`, `security-admin`).
- Core verifies signature, issuer, audience, expiration, and subject.
- Core sends only the verified actor subject to M-Policy.
- Roles and permissions are read by M-Policy from PostgreSQL seed data.
- Missing or invalid token returns `401`.
- Valid token without required permission returns `403` and records a policy decision.

### 2.2.1 Identity v0.2 Local Mode

Identity v0.2 hardens local JWT mode without adding OIDC, SSO, browser sessions, MFA, or M-Identity.

**Token Lifecycle**:

```text
Issue (security-admin, writes Audit)
  → status: "active"
  → expiresAt elapses
    → status: "expired"
  OR revoke (security-admin, writes Audit)
    → status: "revoked"
```

- Token plaintext exists only in the `POST /api/v0/identity/tokens` 201 response.
- Token plaintext is returned only once and must never be stored, logged, or echoed in any other response.
- Core stores only `token_hash` in PostgreSQL.
- Mutations (issue, revoke) write Audit Log before state change.
- If Audit Log is unavailable, the mutation fails closed and no token state change occurs.

**Permission Model**:

- identity permissions inherit from the MVP RBAC matrix in `2.1`.
- `identity:read` for viewer and operator is restricted to their own actor record.
- `identity:token-issue` and `identity:token-revoke` are security-admin only.

**Fail-Closed Rules**:

- Core token introspection unavailable fails protected external capability domain routes closed (503).
- Revoked token use fails closed with 403 and writes Full Log; if the actor and `jti` are known, it writes Audit Log.
- Missing or invalid `jti` in a JWT is rejected during verification.
- Expired tokens are treated equivalently to revoked tokens for authorization purposes.

**Capability Domain Service Verification**:

```
external request
→ service verifies JWT signature / iss / aud / exp / sub / jti with packages/auth
→ service calls Core POST /internal/v0/identity/tokens/introspect
→ Core checks actor token state and revocation
→ service calls M-Policy for authorization only if identity is active
```

- Capability domain services verify JWT shape locally and call Core internal token introspection for revocation state.
- Capability domain services must not read Core token tables directly.
- Positive-result caching is allowed for at most 30 seconds keyed by `jti`.
- Revoked, denied, expired, or invalid results must not be cached as active.

### 2.2.2 OIDC/JWKS Provider Foundation

Production-shaped bearer-token verification uses OIDC discovery plus JWKS-backed signature validation, while local development may continue using the `local-dev` provider explicitly.

Rules:

- discovery validation requires exact `issuer` match plus non-empty `authorization_endpoint`, `token_endpoint`, and `jwks_uri` values.
- accepted signing algorithms are allowlisted asymmetric algorithms only: `RS256`, `RS384`, `RS512`, `ES256`, `ES384`. `none` is always rejected.
- services accept access tokens only. Refresh tokens must not be accepted, persisted, logged, or forwarded.
- JWT verification enforces configured issuer and audience allowlists with 30-second clock tolerance for expiry checks.
- JWKS cache uses stale-while-revalidate semantics: serve cached keys during refresh window, refresh in background, and fail closed with typed `stale_jwks` once cache TTL is exceeded and refresh cannot recover.
- explicit claims mapping exports only `{ subject, groups, issuer, expiresAt }` to Meristem actor/session consumers. Raw JWTs and unmapped claims must not cross the provider boundary.
- verification failures are typed and consumable by route handlers: `stale_jwks`, `bad_issuer`, `bad_audience`, `unsupported_algorithm`, `expired_token`, `missing_claim`, `revoked_token`, and `introspection_required`.
- logs, Audit payloads, Full Log payloads, events, and UI/BFF responses must redact bearer tokens and raw claims. Only explicitly mapped actor/session fields may appear.

### 2.3 MVP Internal Service Authentication

Internal sync calls use loopback-only HTTP + Eden with a shared internal token.

Rules:

- `Core -> M-Policy`, `Core -> M-Log`, and `Core -> M-EventBus` must send `x-meristem-internal-token`.
- Internal services listen on loopback-only ports in local MVP runs.
- `MERISTEM_INTERNAL_TOKEN` is required for Core and all internal services.
- Missing or invalid internal token is treated as service unavailability from the caller's perspective.
- Internal service identity is separate from external JWT actor identity.

---

## 3. High-Risk Operations

| Operation | Required Controls |
|-----------|-------------------|
| register Core / Stem node | M-Policy, Audit Log |
| expand Leaf Node permissions | M-Policy, Audit Log, limited scope |
| publish M-Net policy | M-Policy, config lifecycle, Audit Log |
| enable M-Net CN | M-Policy, Audit Log, rollback path |
| disable a node | M-Policy, Audit Log |
| isolate a node | M-Policy, Audit Log |
| recover a node from administrative state | M-Policy, Audit Log |
| rotate secretRef | M-Policy, Audit Log |
| register M-Extension | M-Policy, service definition, low default permission |
| disable Audit Log | must be blocked unless in documented emergency recovery |
| change contract major version | ADR, migration plan, tests |

MVP protected operations:

| Operation | Minimum Role | Audit Requirement |
|-----------|--------------|-------------------|
| register Stem / Leaf node | operator | required |
| issue or rotate node agent token | operator | required |
| create logical node network | operator | required |
| join node to logical network | operator | required |
| submit noop task through M-Task | operator | required |
| read projection health / DLQ | operator | none |
| run projection backfill | admin | required before execution |
| replay or skip projection DLQ | admin | required before execution |
| read Audit Log | security-admin | Full Log on denied access |
| register service definition | admin | required |
| reload internal service prototype | operator | required |
| list pending approvals | admin / security-admin | none |
| approve pending approval | security-admin | required |
| reject pending approval | security-admin | required |
| resume suspended operation | system | required |
| register M-Extension manifest | admin | required |
| enable M-Extension instance | admin | required |
| disable M-Extension instance | admin | required |
| issue actor token | security-admin | required before returning plaintext token |
| revoke actor token | security-admin | required before status change |
| create / rotate / disable secretRef | security-admin | required before mutation |
| publish / rollback high-risk config | admin | required before mutation |
| list / view network profile definitions | operator | none |
| enable M-Net CN on a network | admin / security-admin | required (suspended operation + approval) |
| disable M-Net CN on a network | admin / security-admin | required before execution |
| propose M-Deploy desired-state change | admin / security-admin | required before proposal persistence |
| approve M-Deploy desired-state proposal | security-admin | required; proposer cannot self-approve |
| apply M-Deploy desired-state digest | security-admin + two-person approval | required before execution and after result |
| rollback M-Deploy desired-state digest | security-admin + separate policy decision | required before execution and after result |
| read M-Deploy drift / evidence metadata | operator | none unless denied access is audit-worthy by policy |
| disable a node | admin / security-admin | required before state change |
| isolate a node | admin / security-admin | required before state change |
| recover a node from administrative state | admin / security-admin | required before state change |

### 3.1 Approval Security

Approval flow security rules:

- approval queue ownership stays in M-Policy.
- approval REST routes use Bearer auth (not internal token).
- `policy:approval-read` allows admin and security-admin to list and view approvals.
- `policy:approval-approve` and `policy:approval-reject` are security-admin only.
- original actor cannot approve or reject their own pending operation.
- duplicate vote from same actor is rejected.
- approval timeout transitions to `expired`, not `rejected`.
- quorum is fixed: manual review requires one security-admin; multi-approval requires two distinct security-admin actors.
- approval state transitions and origin resume attempts write Audit Log.
- list and detail reads do not write Audit Log.
- M-Policy must not execute M-Task operations or hold M-Task business payloads.
- M-Task must not decide approval quorum or mutate approval status directly.

### 3.2 Network Profile Security

Network profile lifecycle security rules:

- `network:profile-read` allows operator, admin, and security-admin to list and view Regional Network Profile definitions.
- `network:profile-enable` allows admin and security-admin to request M-Net CN enable on one network.
- `network:profile-disable` allows admin and security-admin to disable M-Net CN and roll back to default.
- M-Net CN enable requires approval flow integration: the request creates a suspended operation and an approval record; the profile is applied only after security-admin approval and M-Net resume.
- M-Net CN disable is an immediate risk-reduction path guarded by M-Policy allow + Audit Log; it does not require an approval flow.
- disable is allowed from `failed` state as a recovery path.
- M-Policy owns approval records and quorum; M-Net owns suspended operations, profile state, transitions, and per-network applied profile.
- enabling M-Net CN is per network, not global.
- profile transitions write Audit Log for every state change.
- M-Net/Core must not forward packets or implement transport protocols; M-Net orchestrates data-plane control metadata (identity, topology, ACL intent, relay selection, key metadata, status, audit). Packet path is owned by node-agent and host-local sidecars (WireGuard, wstunnel relay).
- profile events are emitted after PostgreSQL state changes and must not be treated as the canonical authority.
- Audit must distinguish approval authorization from profile application: an approved M-Policy approval does not imply M-Net successfully applied the profile.
- missing or revoked `network:profile-enable` or `network:profile-disable` returns `403`.
- M-Net CN disabled network must not appear as M-Net CN active in any read path.

### 3.3 M-Net Data-Plane Security Model

M-Net CN data-plane security is fail-closed by default and must preserve the boundary that Core and M-Net orchestrate metadata only, while node-agent and host-local sidecars own packet movement.

Rules:

- Core and M-Net publish signed topology, ACL intent, relay selection, ticket state, and key metadata only. They must not store, return, log, emit, project, or surface through UI / evidence payloads plaintext WireGuard private keys, node runtime tokens, ACME account keys, or sidecar secret fields.
- Duplicate public keys across nodes are rejected as `key.duplicate` before the network-map is refreshed.
- Join ticket redemption and key registration reject control-plane clock skew above five minutes with `clock.skew_exceeded`.
- Expired or revoked join tickets must not issue credentials, session state, or replacement secrets.
- Concurrent credential rotation on the same node is single-winner: one rotation may succeed, and the losing request must surface a typed conflict instead of silently replacing the winner.
- ACME directory failure must return a typed `acme.directory_unavailable` result. Fallback to `local-dev` is allowed only when the caller explicitly permits it; otherwise the relay path fails closed.
- node-agent sidecar crash, stale signed map, invalid signature, or control-channel partition must drive degraded or `fail_closed` state and prepare tunnel teardown rather than claiming healthy forwarding.
- Signed map TTL expiry must surface `network_map.stale` first and then move to fail-closed enforcement if refresh does not recover.
- Audit unavailability blocks high-risk CN operations before state mutation. Policy denial blocks the operation with no state change.
- Event-bus publish failure must surface a typed unavailable outcome and must not create false success in state, UI, or audit trails.
- Relay outage may fall back to a direct path only when a direct path is already available and policy allows it; otherwise the data plane must fail closed.
- Overlay CIDR exhaustion must return typed `address.exhausted` results rather than reusing an existing address or inventing an out-of-range address.
- Offline leaf migration must remain `pending` until all required leaf members are reachable; partial progress must not be reported as complete.
- Break-glass disable is a higher-precedence safety action: it may preempt in-flight apply or migration work, but it still requires the full audit chain and fail-closed handling if audit cannot be written.

---

## 4. LLM Boundary

LLM may:

- summarize logs
- explain risk factors
- produce incident narratives
- suggest remediation
- assist approval review

LLM must not:

- make final authorization decisions
- bypass M-Policy
- modify Audit Log
- directly execute high-permission operations
- replace audit facts
- consume secrets unless explicitly scoped and audited

---

## 5. Webhook Boundary

Every webhook must define:

- source system
- verification method
- allowed event types
- payload schema version
- replay protection
- rate limit
- audit requirement

Minimum checks:

- signature or token verification
- timestamp freshness
- idempotency key
- schema validation
- Full Log for all rejected requests
- Audit Log for rejected high-risk requests

M-Extension may declare future webhook extension metadata, but it must not expose webhook ingress or execute webhook payloads. Webhook execution requires reopening this section with concrete source verification, replay protection, rate limit, Audit, and failure-mode tests.

---

## 6. M-Extension Boundary

M-Extension is the canonical extension control-plane boundary, but its concrete acceptance and runtime restrictions are owned by `docs/services/m-extension.md`.

Security interpretation rules:

- extensions are untrusted by default.
- control-plane-only manifests remain governance declarations, not executable runtime payloads.
- unknown permissions, unsupported risk classes, and unauthorized mutations fail closed.
- allowed mutating operations still require Audit before persistence or transition.
- execution runtimes (Wasm, webhook, HTTP callback, script, cloud-function) remain outside the current baseline.

---

## 7. Secret Lifecycle

Core owns:

- secretRef creation
- service credentials
- node credentials
- API token entrypoint
- load and rotation entrypoint

M-Policy owns:

- authorization for read, use, export, and rotate operations
- high-risk secret operation decisioning

M-Log owns:

- audit of secret operations

Secrets must not appear in Timeline, Full Log payloads, Audit payloads, OpenSearch projections, LLM prompts, CLI stdout/stderr, or error envelopes.

SecretRef v0.1 rules:

- Core owns secretRef metadata and local v0.1 secret value storage entrypoints.
- M-Policy authorizes create, rotate, disable, metadata read, and reference operations.
- mutating secretRef operations write Audit before mutation.
- external services receive only `secretRef`, not plaintext secret values.
- production KMS / Vault / cloud key-manager integration was deferred in v0.1, but v0.2 now defines the first production SecretProvider backend contract: Vault KV v2-compatible. This is the first production backend, not the only allowed future backend.
- envelope encryption, key leasing, automatic rotation schedules, cross-node distribution, and backup/recovery are deferred.
- no M-Secret service is created.

SecretProvider v0.2 rules:

- Meristem exposes a shared `SecretProvider` runtime interface with `read(ref)`, `list(prefix)`, and `write(ref, value)` only.
- `SecretRef` runtime shape is `{ provider, keyPath, version?, metadata? }`; redaction output is `{ provider, keyPath, version? }` only.
- local development uses the `local-dev-env` provider with explicit env-var mappings.
- first production backend is `vault-kv-v2`; future KMS / cloud secret manager backends remain allowed if they satisfy the same boundary and redaction rules.
- provider failures are typed as `provider_unavailable`, `secret_missing`, `permission_denied`, `unsupported_backend`, and `stale_secret`.
- `stale_secret` is fail-closed: an expired cached secret must not be reused when the provider refresh is unavailable.
- provider errors, Audit payloads, Full Log payloads, UI/BFF responses, and failure-mode evidence must never contain plaintext secret values.
- OIDC client secret / JWKS material, NetBird Signal / Relay / STUN credentials, node sidecar credentials, and deployment env-secret bindings all consume the same SecretProvider boundary.

---

## 8. Config Lifecycle Boundary

`docs/config/CONFIG-LIFECYCLE.md` is the canonical config lifecycle contract. This section keeps only the security interpretation:

- config lifecycle routes must fail closed when M-Policy or required Audit writes are unavailable.
- config payloads must use `secretRef`; plaintext secrets are prohibited.
- domain services may apply config, but Core remains the generic control-plane entrypoint.
- collaborative authoring and broad UI editing remain deferred until they reopen the same security controls.

### 8.2 M-Net Runtime Config SecretRef Boundary

M-Net runtime transport, interconnect, and routing configuration uses `secretRef` exclusively for all credential-bearing fields (these are active for `m-net-cn@0.2.0` profiles, no longer deferred):

- `derpRelay` — DERP relay endpoint credentials.
- `tcpInterconnect` — TCP interconnect credentials.
- `udpPath` — UDP path / STUN / TURN credentials.
- `headscaleEndpoint` — Headscale control endpoint credentials.
- `routingTable` — Routing table credentials or peer auth keys.

Every field uses the `SecretRefFieldSchema` (`{ secretRefId: string }`) pattern. Plaintext TLS certificates, STUN passwords, TURN shared secrets, Headscale preauth keys, and routing pre-shared keys are rejected at the schema level. The `MNetRuntimeConfigSchema` Effect Schema `Struct` strips unknown keys by default, so even an injection attempt that includes plaintext fields alongside valid `secretRef` entries produces only redacted output. `JSON.stringify()` of a decoded runtime config contains only `secretRefId` values.

Redaction contract:
- Plaintext secret fields fail decode/validation.
- `secretRef` fields decode and redact correctly — only `secretRefId` survives.
- Redaction covers log output, UI error envelopes, projection payloads, and approval LLM context inputs.

### 8.3 Runtime SecretProvider Consumers

The v0.2 SecretProvider foundation defines the following consumer bindings even where the final caller wiring lands in later tracks:

- OIDC client/JWKS secret bindings are defined now so T3 can consume the same redacted SecretRef contract without inventing a second identity-only secret path.
- NetBird Signal / Relay / STUN credentials use SecretRefs instead of inline deployment values.
- node-agent sidecar auth/config credentials use SecretRefs instead of host-local plaintext values crossing service boundaries.
- deployment configuration secrets are expressed as env-var-to-SecretRef bindings so NixOS / bare-metal / OCI tracks can share one contract.

### 8.1 Node Agent Tokens

`docs/services/node-agent.md` is the canonical node-agent runtime contract. Security-critical consequences are:

- first-join plaintext enters through the Join Ticket flow, not through reusable public credentials.
- PostgreSQL stores only `token_hash`.
- one node may have only one active token at a time.
- `session.resume` re-establishes the active session lease and supersedes the previous live session.
- runtime token plaintext must never appear in stdout, Timeline, Full Log payloads, Audit payloads, OpenSearch projections, LLM prompts, or error messages.

---

## 9. Production Authority Boundaries

> 本节定义 post-v0.1 生产轨道中各域的 authority 安全边界。完整的 authority matrix 定义在 `docs/data/STATE-MODEL.md §12`。本节只记录安全解释和 fail-closed 规则。

### 9.1 Authority Ownership Rules

每个生产轨道域必须声明其权威源，且不允许跨域写入权威状态：

| 域 | 权威源 | 禁止行为 |
|---|---|---|
| Identity | PostgreSQL（local IAM） | Keycloak / 外部 IdP 不得成为授权根；capability domain 服务不得直接读取 Core token 表 |
| Deployment | Git 仓库 + M-Deploy | M-UI 不得直接写入 live state；M-Deploy 不得拥有 policy 授权 |
| Network | PostgreSQL（M-Net） | NetBird sidecar 仅作为数据面，不得持有网络生命周期控制；Core/M-Net 不得转发数据包 |
| Audit | PostgreSQL（审计元数据） + 不可变对象归档（raw evidence） | OpenSearch 不得成为审计权威源；审计不可绕过 |
| Search | 无（OpenSearch 是投影/辅助） | OpenSearch/Dashboards 不得成为任何域的权威源 |
| Observability | 无（Prometheus/Grafana/Alertmanager/OTel 是监控栈） | 可观测性数据不得成为业务状态权威 |
| Secret | Vault HA（secret 值） + PostgreSQL（secretRef 元数据） | Vault sealed 时不得降级到本地存储或返回明文 secret |
| Desired State | Git commit/digest + M-Deploy 签名 envelope | 未签名或签名验证失败的 desired-state 不得 reconcile |
| Evidence | 分层: PostgreSQL（元数据） → 不可变对象归档（raw blob） → OpenSearch（查询投影） | OpenSearch 作为 evidence 查询投影，不是权威源 |

### 9.2 Fail-Closed Hierarchy

生产轨道 fail-closed 优先级从高到低：

1. **Audit**（最高优先级）：审计写入失败时所有高风险操作 fail-closed。审计日志禁用仅限紧急恢复，且强制 Audit。
2. **Control**：控制操作（identity、network、deployment、secret、desired-state）在权威存储不可用时 fail-closed。
3. **Secret**：Vault sealed/不可达时 fail-closed，禁止降级。
4. **Search / Observability**（最低优先级）：可降级，不影响控制操作。

### 9.3 M-Deploy Authority Constraints

M-Deploy 是 desired-state 的 reconcile 执行者，受以下安全约束：

- M-Deploy 对 desired-state envelope 进行签名验证；签名验证失败必须阻塞 reconcile。
- M-Deploy 不得绕过 M-Policy 做授权决策；所有 deploy 触发需通过 Core 边界。
- M-Deploy 记录所有 reconcile 操作的 evidence，且 evidence 本身不可变。
- M-Deploy 不得修改 Git 仓库中的 desired-state 定义文件（只 pull，不 push）。
- M-Deploy 正常路径禁止 controller SSH push；部署 agent 只能通过 pull-reconcile 获取已签名 desired-state，并在本地验证签名后执行运行时动作。
- M-Deploy 不拥有 identity、policy decision、network authority、source authoring truth 或 general SSH remote control。
- `deploy:desired-state-propose`、`deploy:desired-state-approve`、`deploy:desired-state-apply`、`deploy:desired-state-rollback` 是高风险或关键操作，必须走 Core + M-Policy + Audit；生产 rollout apply 需要双人 approval，原 proposer 不能批准自己的 proposal。
- `deploy:drift-read` 和 `deploy:evidence-read` 是只读权限，但返回内容必须去除 plaintext secret、token、host-local secret path、raw private key 和 unrestricted command output。

### 9.3.1 M-Deploy Permission Vocabulary

| Permission | Purpose | Risk | Required Control |
|------------|---------|------|------------------|
| `deploy:desired-state-read` | 读取 desired-state sync status、proposal、apply status、rollback pointer 和 agent 摘要 | medium | Core auth + M-Policy read allow |
| `deploy:desired-state-propose` | 通过 Git ref/digest 提议 desired-state 变更，不直接写 Git | high | M-Policy allow + Audit before persistence |
| `deploy:desired-state-approve` | 通过 Core/M-Policy 批准 desired-state proposal | high | security-admin；禁止 self-approval；写 Audit |
| `deploy:desired-state-apply` | 将已批准且签名验证通过的 desired-state digest 应用到 VM runtime | critical | 两人 approval + Audit + evidence before/after execution |
| `deploy:desired-state-rollback` | 恢复 previous verified digest / runtime artifact combination | critical | 独立 policy decision + Audit + rollback evidence |
| `deploy:drift-read` | 读取或触发 drift scan；不得修改 live state | medium | read permission + redaction |
| `deploy:evidence-read` | 读取 evidence metadata 和 immutable evidence reference | medium | read permission + redaction；raw blob access 另受 Audit/evidence policy 约束 |

### 9.4 M-UI / BFF Authority Boundaries

M-UI 和 M-UI BFF 的安全边界保持现有 `§2` 和 M-UI BFF 服务定义中的规则：

- M-UI → M-UI BFF → Core public facade → M-* 服务数据流不得被绕过。
- M-UI BFF 不拥有最终事实、最终授权、最终策略决策。
- BFF 不缓存 Core 数据跨请求。
- BFF 不创建审计事实。
- BFF 调用仅限于 Core public REST 边界，不访问任何服务的 `/internal/v0/*` 路由。

### 9.5 OpenSearch / Dashboards Classification

OpenSearch 和 OpenSearch Dashboards 在 authority matrix 中分类为：

- **投影/辅助系统**：不是任何域的权威源。
- **搜索可降级**：不可达时不影响控制操作。
- **审计投影只读**：审计查询投影使用 OpenSearch，但 PostgreSQL 是权威审计元数据存储。
- **不参与 fail-closed 决策**：OpenSearch 不可达不触发任何控制路径的 fail-closed 行为。

---

## 10. Bootstrap / DR Trust Chain Security Contract

生产 bootstrap 与灾备恢复的安全边界由 `docs/operations/RUNBOOK.md §8` 承载；本节定义安全解释：

- Root-of-trust custody 使用 offline root CA / root key ceremony。Root key material 必须离线保存并由多名 security-admin 分离保管；Meristem 仓库只允许保存 custody policy、public certificate、key ID、fingerprint 和 evidence digest。
- Internal PKI 必须从 offline root 签发 intermediate CA，再由 intermediate CA 签发 service、mTLS、M-Deploy controller 和 M-Deploy agent identity certificate。Root CA 不直接签发运行时 workload certificate。
- Vault HA 默认使用 Integrated Storage / Raft。libvirt validation fixture 使用人工 Shamir unseal ceremony；除非同一变更引入 self-hosted auto-unseal 机制，否则不得要求 cloud KMS。
- Unseal shard、Vault root token、AppRole secret、registry credential、OIDC client secret、NetBird credential 和 node runtime credential 不得进入 Git、测试夹具、example config、日志、evidence、OpenSearch projection、M-UI payload 或 error envelope。
- Secret-zero handoff 只能用于初始化 Vault policy、workload identity、最小 SecretProvider credential 和 M-Deploy bootstrap identity；初始化完成后 root token 必须撤销或封存。
- Break-glass 在 IdP unavailable 或控制面恢复场景中仍必须经过 local IAM + M-Policy two-person approval，TTL 30 分钟，并写 Audit。Break-glass 不得绕过 Audit，也不得授予读取 plaintext secret 的默认权力。
- Vault sealed 时 secret operation fail-closed：禁止 secret create / rotate / read、禁止新部署读取 secret，禁止降级到本地明文存储。已运行服务只可使用未过期 cached secret；缓存过期后返回 `stale_secret`。
- Git desired-state 与 registry trust 是部署授权链的一部分：M-Deploy 必须验证 signed envelope、digest pin、rollback pointer、image signature 和 image digest；验证失败阻塞 reconcile 并写 Audit。
- PostgreSQL authority 必须先于 OpenSearch projection 恢复；OpenSearch 不得作为审计、identity、secretRef、desired-state 或 deployment 的事实源。
- Keycloak 只恢复 OIDC authentication provider config；本地 IAM / PostgreSQL 仍是 identity authorization authority。Keycloak client secret 和 JWKS material 必须从 Vault reload。
