# ADR-P01: OIDC Federation And Local IAM Authority

## 状态

Accepted

## 上下文

生产轨道需要让操作员通过 OIDC 登录 M-UI，同时保持 Meristem 对 principal、角色、权限、账号状态和高风险授权的单一权威。若将 Keycloak 的 group、realm role、client role 或可变 display claim 直接作为 Meristem 权限来源，会产生外部 IdP 与 Core/M-Policy 之间的双重授权事实源，也无法安全处理首次登录、账户冲突、禁用、会话撤销和 IdP 不可用。

当前生产契约已在 `docs/security/SECURITY-MODEL.md`、`docs/services/m-ui-bff.md`、`docs/contracts/REST-API-MVP.md` 和 `packages/contracts/src/schemas/oidc-iam-session.ts` 中定义 OIDC/IAM/session 边界。本 ADR 固化这些边界；它不声称任何 Keycloak、浏览器会话或 target-environment 登录流程已经实际部署或验证。

## 决策

### OIDC 仅用于认证联邦

- Keycloak 是 OIDC Provider，只证明上游认证；Core 中的 local IAM 是 principal、角色、权限、账号状态和 session lifecycle 的权威源。
- principal 的唯一稳定绑定是精确的 `(issuer, subject)`。email、name、`preferred_username` 和外部 claims 仅是 display attributes，不得触发 rebind 或授予 Meristem 权限。
- Keycloak group、realm role、client role 和其他外部 claims 不得直接转换为 Meristem permission。权限由 local IAM role 与 M-Policy 决定。
- 首次出现的 `(issuer, subject)` 由 Core JIT 创建为 `pending` principal，写入 Audit fact 且不得签发 session。仅本地 IAM 的审批路径可批准、拒绝或禁用 principal；issuer/subject 冲突、subject mismatch 和 rebind 请求必须返回 typed conflict 并写入 Audit，而不得静默合并账户。

### BFF 持有浏览器会话

- M-UI BFF 使用 OIDC authorization code flow + PKCE，并在服务端校验 `state`、`nonce` 和 CSRF material；这些一次性材料必须绑定到 server-side login transaction 或 session。
- M-UI frontend 不得接收、存储、缓存或转发 OIDC access token、refresh token 或 ID token。BFF 在 local IAM 已解析为 approved principal 后创建 server-side session，并只向浏览器发放 `__Host-meristem-session` cookie。
- session cookie 必须使用 `HttpOnly`、`Secure`、`path=/` 和 `SameSite=Strict`；若使用 `Lax`，必须由部署配置明确证明回调兼容性。BFF session 在登录和权限变更后轮换；logout、角色撤销和 principal disable 必须撤销 server-side session，而不是就地扩大或收缩权限。
- upstream front-channel logout 可以尽力执行，但无论其结果如何，本地 BFF session 销毁都是必需的。session issue、rotation、revocation、logout、角色撤销、principal disable 和 provider outage 的审计由 Core/M-Log 事实边界完成，BFF 不伪造 Audit fact。

### 失效和紧急访问

- OIDC discovery、JWKS、issuer/audience 验证或 Keycloak 不可用时，OIDC login 必须 fail closed；依赖 provider freshness 的 session 必须失效，不得延长或以外部 claims 兜底。
- 紧急访问只使用 local IAM break-glass 路径，要求 security-admin 发起、独立第二位审批者、M-Policy 决定、成功 Audit 写入和精确 30 分钟 TTL。它仅授予批准的有限范围，不授予读取 plaintext secret 的默认权力，也不绕过 Audit。

## 结果

- Meristem 以 OIDC 获得联邦登录体验，同时保留 local IAM、M-Policy 和 M-Log 的授权与审计权威，避免 Keycloak 与 Core 双重事实源。
- pending、rejected、disabled 和 binding-conflict principal 均不能获得 BFF session，且 role revocation 有明确的 session invalidation 语义。
- BFF 成为唯一浏览器凭据边界，降低 token 泄漏到 frontend storage、日志、事件、UI payload 或 error envelope 的风险。
- 该选择要求维护 server-side session storage、OIDC callback 校验、JWKS freshness 和本地 IAM 审批/撤销流程；多 IdP 编排、SAML、MFA UI 和完整用户管理 UI 不因此被授权。
- 运行时登录、Keycloak 可用性、break-glass 演练和 target-environment OIDC proof 仍是环境门禁，必须按 `docs/security/SECURITY-MODEL.md` 与 `docs/operations/RUNBOOK.md` 执行，不能由本 ADR 的 Accepted 状态替代。

## 重访条件

- 经过版本化迁移设计后，需要支持多个 OIDC issuer、组织级 federation 或 SAML，且仍能保持 `(issuer, subject)` identity binding 与 local IAM authority。
- local IAM 无法满足已证实的 principal lifecycle、授权或审计需求，且替代方案能证明不会把外部 IdP 变成 Meristem 的授权根。
- 浏览器安全、回调兼容性或 session storage 的生产证据表明当前 cookie/session 约束不可行，且替代设计保留 PKCE、server-side state、rotation、revocation 与 fail-closed 语义。
- break-glass 演练证明双人、30 分钟、审计不可绕过的流程无法满足已记录的恢复目标。
