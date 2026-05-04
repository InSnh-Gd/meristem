# Phase 1 - Core Microkernel and Base API

> Goal: form the smallest runnable Core with REST/OpenAPI, Eden sample, CLI status, service definition registration, safety placeholders, and dependency readiness.

---

## 1. Scope

Phase 1 includes:

- Core bootstrap.
- Elysia app composition.
- health, readiness, and status endpoints.
- OpenAPI v0 generation.
- internal Eden contract sample for status.
- CLI `meristem status`.
- base configuration loading.
- service definition registration endpoint and validator.
- safety mode placeholder.
- secretRef placeholder.
- PostgreSQL connection check.
- NATS connection check.
- Timeline / Full Log write helpers as placeholders until Phase 4.

Phase 1 excludes:

- real node registration.
- task assignment.
- full RBAC.
- real Audit Log enforcement.
- M-UI.

---

## 2. Target Files

Expected implementation areas:

```text
apps/core/
apps/m-cli/
packages/contracts/
packages/service-definition/
packages/config/
packages/testing/
```

---

## 3. Required API

Defined in `docs/contracts/REST-API-MVP.md`:

- `GET /api/v0/health`
- `GET /api/v0/ready`
- `GET /api/v0/status`
- `POST /api/v0/services`
- `GET /api/v0/services`

---

## 4. Required CLI

Defined in `docs/contracts/CLI-COMMANDS.md`:

```bash
meristem status
```

---

## 5. Completion Criteria

- Core starts with TypeScript strict enabled.
- `GET /api/v0/health` returns alive status.
- `GET /api/v0/ready` reflects PostgreSQL and NATS readiness.
- `GET /api/v0/status` returns Core version, mode, dependency summary, and service count.
- OpenAPI document includes Phase 1 endpoints.
- Eden status sample is callable.
- CLI `meristem status` calls Core and exits non-zero on unreachable Core.
- A sample service definition can be registered and listed.

---

## 6. Verification Checklist

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contracts
pnpm dev:core
meristem status
```

Manual checks:

- stop PostgreSQL and confirm readiness fails
- stop NATS and confirm readiness fails
- register invalid service definition and confirm validation error
