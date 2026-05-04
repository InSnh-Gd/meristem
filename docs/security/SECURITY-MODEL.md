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
| `network:read` | yes | yes | yes | yes |
| `network:create` | no | yes | yes | yes |
| `network:join` | no | yes | yes | yes |
| `task:assign` | no | yes | yes | yes |
| `timeline:read` | yes | yes | yes | yes |
| `log:read-full` | no | yes | yes | yes |
| `audit:read` | no | no | no | yes |
| `service:register` | no | no | yes | yes |

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
| create logical node network | operator | required |
| join node to logical network | operator | required |
| assign noop task | operator | required |
| read Audit Log | security-admin | Full Log on denied access |
| register service definition | admin | required |

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
