# Phase 17 - Identity v0.2 Local Mode Hardening

> Goal: harden the Core-owned local identity baseline so external M-* services can share one actor-token contract without introducing OIDC, SSO, browser sessions, MFA, or a new M-Identity service.

---

## 1. Scope

Phase 17 upgrades the current local JWT model into `Identity v0.2 local mode`:

```text
Core-owned actor records
Core-owned local actor token lifecycle
jti issuance and revocation
internal token introspection for M-* services
shared packages/auth verification contract
identity REST and CLI control plane
Audit for token issue / revoke / denied revoked token use
```

Phase 17 keeps ADR-020 intact: identity belongs to Core; authorization and risk remain in M-Policy.

---

## 2. Accepted Decisions

- No `M-Identity` service is created.
- No OIDC, SSO, cookies, MFA, groups, teams, departments, browser session store, refresh tokens, or token family model is introduced.
- Core owns identity authoritative state and token lifecycle.
- M-Policy owns role assignments, permission assignments, and policy decision records only.
- M-* services verify local JWT shape with shared `packages/auth` primitives and use Core internal introspection for revocation state.
- M-* services must not read Core token tables directly.
- Token revocation is by `jti` only.
- Runtime token issue and revoke require `security-admin`.
- Local bootstrap token minting may remain as a seed/dev script, but it is not a runtime API bypass.

---

## 3. Out Of Scope

Phase 17 excludes:

- production identity provider integration.
- OIDC / SAML / SSO.
- browser cookies or web sessions.
- MFA.
- refresh tokens.
- token family rotation.
- device binding.
- password authentication.
- user management UI.
- group / team / department ownership.
- configurable approval policy based on groups.

---

## 4. Target Files

Expected implementation targets:

```text
packages/auth/**
apps/core/src/routes/identity.ts
apps/core/src/storage-adapter.ts
apps/m-cli/src/**
packages/db/src/schema.ts
packages/db/src/migrate.ts
tests/contracts/identity-v02.test.ts
tests/cli/cli-identity.test.ts
tests/failure-modes/identity-revocation.test.ts
tests/integration/identity-introspection.test.ts
```

Required documentation targets:

```text
docs/contracts/REST-API-MVP.md
docs/contracts/CLI-COMMANDS.md
docs/data/STATE-MODEL.md
docs/security/SECURITY-MODEL.md
docs/services/core.md
docs/testing/TESTING.md
```

---

## 5. Identity Contract

```ts
type IdentityActorV02 = {
  id: "viewer" | "operator" | "admin" | "security-admin";
  displayName: string;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
};

type ActorTokenV02 = {
  jti: string;
  actor: IdentityActorV02["id"];
  issuer: "meristem-local";
  audience: "meristem-core" | "meristem-service";
  issuedAt: string;
  expiresAt: string;
  issuedBy: IdentityActorV02["id"];
  purpose: string;
  status: "active" | "revoked" | "expired";
  revokedAt?: string;
  revokedBy?: IdentityActorV02["id"];
  revokeReason?: string;
};
```

JWT verification must check:

- signature.
- issuer.
- audience.
- expiration.
- subject.
- `jti` presence.
- Core-owned revocation state.

---

## 6. State Model

Core owns these authoritative PostgreSQL tables:

```text
actors
actor_tokens
actor_token_revocations
```

Suggested fields:

```text
actors:
  id
  display_name
  status
  created_at
  updated_at

actor_tokens:
  jti
  actor_id
  issuer
  audience
  issued_at
  expires_at
  issued_by
  purpose
  status
  created_at
  updated_at

actor_token_revocations:
  jti
  revoked_at
  revoked_by
  reason
  correlation_id
```

Token plaintext is never stored.

---

## 7. Permissions

Phase 17 introduces:

```text
identity:read
identity:token-issue
identity:token-revoke
identity:token-inspect
```

Role defaults:

```text
viewer: identity:read self only
operator: identity:read self only
admin: identity:read, identity:token-inspect
security-admin: identity:read, identity:token-inspect, identity:token-issue, identity:token-revoke
```

Rules:

- runtime issue / revoke requires `security-admin`.
- `admin` and `operator` must not mint actor tokens.
- token issue writes Audit before returning plaintext token.
- token revoke writes Audit before changing token status.
- denied invalid / revoked token use writes Full Log; revoked token use writes Audit when actor and `jti` are known.

---

## 8. REST API

Core owns the identity control-plane API:

```text
GET  /api/v0/identity/actors
GET  /api/v0/identity/actors/:id
POST /api/v0/identity/tokens
GET  /api/v0/identity/tokens/:jti
POST /api/v0/identity/tokens/:jti/revoke
POST /internal/v0/identity/tokens/introspect
```

External routes require bearer auth and M-Policy authorization. The internal introspection route requires `x-meristem-internal-token` and never returns token plaintext.

---

## 9. CLI Commands

```text
meristem identity actor list
meristem identity actor show <actor-id>
meristem identity token issue --actor <actor-id> --ttl <duration> --purpose <text>
meristem identity token inspect <jti>
meristem identity token revoke <jti> --reason <text>
```

`token:mint` may remain for local seed/bootstrap, but runtime tests and operator docs must prefer `meristem identity token issue` after Phase 17.

---

## 10. M-* Service Verification Flow

```text
external request
-> service verifies JWT signature / iss / aud / exp / sub / jti with packages/auth
-> service calls Core /internal/v0/identity/tokens/introspect
-> Core checks actor token state and revocation
-> service calls M-Policy for authorization only if identity is active
```

Rules:

- Core introspection unavailable fails closed for protected external service routes.
- optional positive-result cache is allowed for at most 30 seconds and keyed by `jti`.
- revoked, denied, expired, or invalid results must not be cached as active.
- M-* services must not copy Core-private middleware.

---

## 11. Completion Criteria

- Core owns actor and token authoritative state.
- `packages/auth` exposes shared Identity v0.2 verification primitives.
- token issue / inspect / revoke REST and CLI contracts are implemented.
- M-* external services have a documented path to Core introspection.
- revoked token use fails closed.
- token plaintext is returned only once and never logged.
- Audit and Full Log behavior matches the security model.

---

## 12. Verification Checklist

```text
identity contract decode / encode tests
token issue happy path as security-admin
operator/admin token issue denial tests
token revoke happy path
revoked token denied test
missing jti denied test
introspection unavailable fail-closed test
token plaintext redaction tests
CLI identity smoke test
M-* service introspection contract test
```

