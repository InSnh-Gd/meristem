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

MVP actor selection uses locally signed JWT bearer tokens for local development. This is not a production identity provider model.

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
- Core verifies signature, issuer, audience, expiration, and subject.
- Core sends only the verified actor subject to M-Policy.
- Roles and permissions are read by M-Policy from PostgreSQL seed data.
- Missing or invalid token returns `401`.
- Valid token without required permission returns `403` and records a policy decision.

### 2.2.1 Identity v0.2 Local Mode

Phase 17 hardens local JWT mode without adding OIDC, SSO, browser sessions, MFA, or M-Identity.

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

| Permission | viewer | operator | admin | security-admin |
|------------|--------|----------|-------|----------------|
| `identity:read` | self only | self only | yes | yes |
| `identity:token-inspect` | no | no | yes | yes |
| `identity:token-issue` | no | no | no | yes |
| `identity:token-revoke` | no | no | no | yes |

- `identity:read` for viewer and operator is restricted to their own actor record.
- `identity:token-issue` and `identity:token-revoke` are security-admin only.

**Fail-Closed Rules**:

- Core token introspection unavailable fails protected external M-* routes closed (503).
- Revoked token use fails closed with 403 and writes Full Log; if the actor and `jti` are known, it writes Audit Log.
- Missing or invalid `jti` in a JWT is rejected during verification.
- Expired tokens are treated equivalently to revoked tokens for authorization purposes.

**M-* Service Verification**:

```
external request
→ service verifies JWT signature / iss / aud / exp / sub / jti with packages/auth
→ service calls Core POST /internal/v0/identity/tokens/introspect
→ Core checks actor token state and revocation
→ service calls M-Policy for authorization only if identity is active
```

- M-* services verify JWT shape locally and call Core internal token introspection for revocation state.
- M-* services must not read Core token tables directly.
- Positive-result caching is allowed for at most 30 seconds keyed by `jti`.
- Revoked, denied, expired, or invalid results must not be cached as active.

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

### 2.4 Phase 12 Approval Security

Phase 12 approval flow security rules:

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

### 2.5 Phase 13 Network Profile Security

Phase 13 network profile lifecycle security rules:

- `network:profile-read` allows operator, admin, and security-admin to list and view Regional Network Profile definitions.
- `network:profile-enable` allows admin and security-admin to request M-Net CN enable on one network.
- `network:profile-disable` allows admin and security-admin to disable M-Net CN and roll back to default.
- M-Net CN enable requires Phase 12 approval: the request creates a suspended operation and an approval record; the profile is applied only after security-admin approval and M-Net resume.
- M-Net CN disable is an immediate risk-reduction path guarded by M-Policy allow + Audit Log; it does not require an approval flow.
- disable is allowed from `failed` state as a recovery path.
- M-Policy owns approval records and quorum; M-Net owns suspended operations, profile state, transitions, and per-network applied profile.
- enabling M-Net CN is per network, not global.
- profile transitions write Audit Log for every state change.
- M-Net must not execute real DERP, TCP, UDP, Headscale, or path-selection data-plane behavior.
- profile events are emitted after PostgreSQL state changes and must not be treated as the source of truth.
- Audit must distinguish approval authorization from profile application: an approved M-Policy approval does not imply M-Net successfully applied the profile.
- missing or revoked `network:profile-enable` or `network:profile-disable` returns `403`.
- M-Net CN disabled network must not appear as M-Net CN active in any read path.

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

Phase 15 M-Extension may declare future webhook extension metadata, but it must not expose webhook ingress or execute webhook payloads. Webhook execution requires reopening this section with concrete source verification, replay protection, rate limit, Audit, and failure-mode tests.

---

## 5.1 M-Extension Boundary

Phase 15 M-Extension security rules:

- extensions are untrusted by default.
- M-Extension Manifest v0.1 is a governance declaration only.
- `controlPlaneOnly` must be `true`.
- only `low` and `medium` risk manifests are accepted.
- `high` and `critical` risk manifests are rejected as unsupported.
- unknown requested permissions are rejected.
- extensions cannot create new permissions.
- `register`, `enable`, and `disable` require M-Policy.
- allowed `register`, `enable`, and `disable` write Audit before persistence or transition.
- Phase 15 does not create approval records for extension operations.
- Phase 15 does not execute Wasm, webhook, HTTP callback, script, or cloud-function behavior.

M-Extension manifests must not contain:

- inline code.
- executable command strings.
- secret values.
- raw webhook tokens.
- Wasm binaries or loadable binary paths.
- unversioned config blobs.

---

## 6. Secret Lifecycle

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

Secrets must not appear in Timeline, Full Log payloads, OpenSearch projections, LLM prompts, or error messages.

Phase 18 SecretRef v0.1 rules:

- Core owns secretRef metadata and local v0.1 secret value storage entrypoints.
- M-Policy authorizes create, rotate, disable, metadata read, and reference operations.
- mutating secretRef operations write Audit before mutation.
- external services receive only `secretRef`, not plaintext secret values.
- production KMS / Vault integration is deferred.
- no M-Secret service is created.

---

## 7. Config Lifecycle Boundary

Phase 19 Config Lifecycle v0.1 rules:

- Core owns the generic config lifecycle control plane.
- domain services own domain-specific apply behavior.
- config payloads must be schema validated, versioned, hash-addressed, published, applied, and acknowledged.
- high-risk config publish / rollback requires M-Policy and Audit.
- config payloads must use `secretRef`; plaintext secrets are prohibited.
- M-UI config authoring and broad collaborative config editing are deferred.

### 6.1 Node Agent Tokens

Phase 8 uses per-node opaque tokens for `node-agent` identity.

Rules:

- first-join plaintext enters through the Join Ticket flow: Core issues the ticket, and M-Net returns the runtime token in `join.accepted`.
- `POST /api/v0/nodes/:id/credentials` remains an internal compatibility and operator path for re-issuing a node token; token plaintext is still returned only once per issuance.
- PostgreSQL stores only `token_hash`.
- one node may have only one active token at a time.
- `session.resume` validates the runtime token and establishes the active session lease.
- heartbeat, forwarded log, and task reply validation rely on the authenticated session plus the current `sessionId`; they do not repeat the runtime token in every frame.
- runtime token plaintext is only present in the `join.accepted` handshake and the `session.resume` request that reauthenticates a node.
- invalid or revoked token usage must not update node state and must leave log evidence.
- runtime tokens must never appear in stdout, Timeline, Full Log payloads, Audit payloads, OpenSearch projections, LLM prompts, or error messages.
