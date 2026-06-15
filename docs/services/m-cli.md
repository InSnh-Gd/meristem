# M-CLI Service Definition

## 1. Identity

| Field | Value |
|-------|-------|
| name | `m-cli` |
| version | `0.1.0` |
| domain | `m-cli` |
| kind | `internal` |
| owner | Meristem CLI maintainers |

---

## 2. Responsibility

M-CLI is the operator-facing command-line entrypoint. It resolves the Core URL, forwards actor context, invokes Core contracts, and renders human-readable or JSON output.

What this service owns:

- command parsing and flag validation
- Core URL resolution
- actor context and Bearer token forwarding
- human-readable and JSON output rendering
- non-zero exit codes on command failure

What this service must not own:

- authorization decisions
- database writes
- event publication
- Audit Log writes
- secret persistence or token mutation

---

## 3. Contracts

CLI behavior is defined in `../contracts/CLI-COMMANDS.md`.

| Contract | Path / Subject | Version | Notes |
|----------|----------------|---------|-------|
| Eden | `@meristem/contracts/core` | `0.1.0` | CLI prefers Eden clients for Core calls |
| REST | `/api/v0/*` | `v0` | Fallback surface when Eden is not used directly |

---

## 4. Permissions

M-CLI does not enforce permissions locally. Core and M-Policy enforce all authorization server-side; the CLI only forwards the caller token.

| Permission | Required For | Risk |
|------------|--------------|------|
| N/A | N/A | N/A |

---

## 5. Dependencies

| Dependency | Type | Failure Behavior |
|------------|------|------------------|
| meristem-core | service | command fails non-zero and surfaces the Core error envelope |
| `packages/contracts` | shared package | CLI loses Eden client and shared schema helpers |

---

## 6. Configuration

| Key | Type | Required | Hot Reload | Notes |
|-----|------|----------|------------|-------|
| `MERISTEM_CORE_URL` | URL | no | n/a | defaults to `http://localhost:3000` |
| `MERISTEM_TOKEN` | string | no | n/a | caller Bearer token; high sensitivity |
| `MERISTEM_OUTPUT` | enum | no | n/a | `human` or `json`; defaults to `human` |

---

## 7. Health

Not applicable. M-CLI is a short-lived process and does not expose long-running health checks.

---

## 8. Lifecycle

Not applicable. M-CLI does not support reload, rollback, or degraded service semantics.

---

## 9. Logs

| Log | When Written | Required Fields |
|-----|--------------|-----------------|
| Timeline | not written directly | — |
| Full | not written directly; Core errors may be rendered to stderr | — |
| Audit | not written directly | — |

M-CLI does not emit canonical log facts. Operation facts are written by Core, M-Policy, and M-Log.

---

## 10. Policy Requirements

- M-CLI must not make authorization decisions.
- M-CLI must forward the caller token unchanged.
- M-CLI must not cache or persist sensitive tokens locally.
- High-risk commands must rely on Core-side M-Policy checks; the CLI only renders the result.

---

## 11. Done Criteria

- `meristem status` works against the local Core.
- node register/list commands work.
- logical network create/list/join/member commands work.
- noop task submission commands work.
- timeline and audit list commands work and respect permission failures.
- failures print a clear error and exit non-zero.
- CLI commands and output stay aligned with `../contracts/CLI-COMMANDS.md`.
