# Effect Projection Hardening Plan

> Status: Accepted plan. This document records the decisions from the 2026-05-23 architecture grilling session before implementation.

## 1. Goal

Harden the Projection Platform Track by making projection permissions explicit, auditing mutating projection operations, and starting the contract migration toward Effect-first internal executable contracts.

This is not a rewrite of Phase 10.1. `docs/roadmap/PHASE-10.1.md` remains the historical completion checklist for the first Projection Platform Track slice. This plan defines the follow-up hardening slice.

## 2. Accepted Decisions

### 2.1 Contract Model

- Effect Schema is the source for complex internal executable contracts.
- Elysia TypeBox remains the REST/OpenAPI adapter until each route is deliberately migrated.
- Where both exist, add Contract Drift Checks instead of relying on manual review.
- Do not introduce a broad Effect Schema to TypeBox conversion layer in this slice.

### 2.2 Contract Package Layout

Use domain files under `packages/contracts/src/schemas/` instead of one large schema file:

```text
packages/contracts/src/
  literals.ts
  types.ts
  schemas/
    identity.ts
    policy.ts
    logs.ts
    projection.ts
    nodes.ts
    networks.ts
    services.ts
    tasks.ts
    errors.ts
  index.ts
```

`literals.ts` owns shared literal vocabularies such as actor IDs, permissions, log levels, and projection statuses. New or modified key types should derive from Effect Schema or the shared literal source.

### 2.3 Projection Permissions

Add explicit Projection Platform permissions:

- `projection:read` for projection health and DLQ listing.
- `projection:backfill` for projection backfill.
- `projection:dlq-manage` for DLQ replay and skip.

Default RBAC matrix:

| Actor | Projection permissions |
|-------|------------------------|
| `viewer` | none |
| `operator` | `projection:read` |
| `admin` | `projection:read`, `projection:backfill`, `projection:dlq-manage` |
| `security-admin` | `projection:read`, `projection:backfill`, `projection:dlq-manage` |

### 2.4 Audit, Timeline, And Full Log Rules

Projection Read Actions do not write Audit Log:

- `GET /api/v0/projection/health`
- `GET /api/v0/projection/dlq`

Projection Control Actions must write Audit Log before execution and fail closed if Audit Log is unavailable:

- `POST /api/v0/projection/backfill` uses action `projection:backfill`, resource `projection:<index>`, and payload with `batchSize`, `from`, `to`, and `targetVersion` when present.
- `POST /api/v0/projection/dlq/:id/replay` uses action `projection:dlq-manage`, resource `projection-dlq:<id>`, and payload `{ operation: "replay" }`.
- `POST /api/v0/projection/dlq/:id/skip` uses action `projection:dlq-manage`, resource `projection-dlq:<id>`, and payload `{ operation: "skip" }`.

Successful Projection Control Actions write Timeline Log. Failed or degraded projection operations write Full Log. Timeline Log is operational visibility; Audit Log remains the high-trust fact.

### 2.5 Ownership Layering

Core owns public REST entry, M-Policy authorization, Audit Log fail-closed behavior, Timeline / Full Log observability, and the `ProjectionPort` call.

M-Log owns the projection engine implementation: job, cursor, DLQ, backfill, health, PostgreSQL fact reads, OpenSearch adapter calls, and typed Effect errors.

Core must not directly know projection job/cursor/DLQ storage details.

## 3. Implementation Slices

### Slice 1: Projection Permission Hardening

- Add shared literal source and Effect Schema for `ActorId`, `Permission`, and projection-related contracts.
- Add projection permissions to contract types, M-Policy schemas, Core schemas, and seed data.
- Update Core projection routes to use `projection:read`, `projection:backfill`, and `projection:dlq-manage`.
- Add Audit Log fail-closed behavior for backfill, replay, and skip.
- Add Timeline / Full Log behavior for Projection Control Actions.
- Update CLI contract and CLI commands only if existing projection commands need permission/error text changes.

### Slice 2: M-Log Projection Effect Workflow

- Split `services/m-log/src/projection.ts` into deeper internal modules.
- Model projection workflow errors with typed Effect errors.
- Use Effect workflow boundaries for backfill, retry/DLQ, and projection health.
- Preserve the existing M-Log internal HTTP surface unless a contract change is explicitly required.

### Slice 3: M-Task Draft Alignment

- Keep current MVP `POST /api/v0/tasks` behavior stable.
- Record the future task-domain split in `docs/roadmap/PHASE-11.md` as `M-Task`.
- Do not introduce `M-Task` in Slice 1 or Slice 2.
- If Core task orchestration must be touched before Phase 11, preserve compatibility and avoid creating task-domain state that contradicts the Phase 11 draft.

### Slice 4: M-UI BFF CommandWell Eligibility

- Add Effect Schema for CommandWell Eligibility, Disabled Command Explanation, and Minimal Policy Decision Summary.
- Keep M-UI BFF as a display-shaping boundary derived from Core-visible facts.
- Do not let BFF become a policy fact source.

## 4. Transition End State

The temporary migration shape is intentional: Effect Schema becomes the source for internal executable contracts while Elysia TypeBox remains the HTTP/OpenAPI adapter. The final target is not two independent schema systems maintained by memory.

End state for this migration:

- `packages/contracts/src/literals.ts` owns shared literal vocabularies.
- Complex shared contracts live under `packages/contracts/src/schemas/` as Effect Schema modules.
- Public TypeScript types for migrated contracts are derived from Effect Schema or from the shared literal source.
- Elysia TypeBox schemas either derive from shared contract data or have Contract Drift Checks proving adapter parity.
- Core route handlers are thin HTTP adapters around pure domain functions or Effect workflows.
- M-Log owns projection internals behind its internal route interface; Core never imports projection job/cursor/DLQ storage details.
- Projection Read Actions and Projection Control Actions use separate permissions and log/audit behavior.

Temporary allowance during migration:

- Existing TypeScript union types may remain when untouched by the current slice.
- Existing TypeBox schemas may remain when they are needed for Elysia/OpenAPI output.
- New or changed security-sensitive literals must not be added only to route-local schemas.
- Any temporary duplication must be protected by a Contract Drift Check or listed in the Deferred Work Register below.

## 5. Deferred Work Register

Use this register instead of scattered `TODO` comments for known future work. Code comments should only use `FIXME` when the incomplete state creates a local safety, correctness, or operational risk as defined by `MERISTEM-DEV.md §8.3`.

### D-001 Full Contract Type Migration

- Status: deferred after Slice 1.
- Current temporary state: only identity, permission, and projection-critical contracts must move first; other `packages/contracts/src/types.ts` declarations may remain hand-written.
- Final state: all complex cross-service contracts that cross service, node, runtime, or time boundaries are backed by Effect Schema or a shared literal source.
- Trigger: touch a contract for policy, logs, projection, events, service definition, config lifecycle, webhook, or BFF command state.
- Verification: Effect Schema decode/encode tests and TypeScript type derivation tests exist for the touched contract.

### D-002 TypeBox Adapter Derivation

- Status: deferred until duplication becomes repetitive enough to justify tooling.
- Current temporary state: Elysia route files may keep TypeBox schemas for REST/OpenAPI output.
- Final state: route adapter schemas are derived from shared contract data where practical, or covered by Contract Drift Checks when direct derivation is not worth the complexity.
- Trigger: the same literal vocabulary or object shape is duplicated in three or more route/service files.
- Verification: adapter parity tests fail when a shared literal is added without updating the route adapter.

### D-003 M-Log Projection Workflow Split

- Status: Slice 2.
- Current temporary state: `services/m-log/src/projection.ts` owns job, cursor, DLQ, retry, health, mapping, and backfill in one module.
- Final state: M-Log projection internals are split into deeper modules for job/cursor storage, DLQ/retry, backfill runner, health calculation, document mapping, and typed Effect errors.
- Trigger: after Slice 1 projection permission hardening lands.
- Verification: existing projection integration tests still pass, and new workflow tests cover typed success/failure paths without relying on route-level behavior only.

### D-004 M-Task Future Domain Draft

- Status: moved to `docs/roadmap/PHASE-11.md` as an `M-Task` draft.
- Current temporary state: Core owns the MVP `noop` task route and task record, while M-Net delivers `task.execute` over the node-agent session.
- Final state: task lifecycle, scheduling, retry, cancellation, timeout, priority, task type registry, and task observability move behind an explicit `M-Task` domain when promotion triggers are met.
- Trigger: task behavior extends beyond MVP `noop`, or task lifecycle needs durable domain semantics beyond a Core control workflow.
- Verification: Phase 11 implementation preserves MVP `task:assign` compatibility and adds tests for new M-Task permissions, events, logs, and lifecycle state.

### D-005 M-UI BFF CommandWell Eligibility Contract

- Status: Slice 4.
- Current temporary state: CommandWell Eligibility is derived inside BFF route code from Core-visible facts and permissions.
- Final state: `CommandWellEligibility`, `DisabledCommandExplanation`, and `MinimalPolicyDecisionSummary` are Effect Executable Contracts, with BFF route code acting as adapter/display shaping only.
- Trigger: after Projection Control Actions are hardened or when M-UI Functional Demo Shell adds another command type.
- Verification: BFF contract tests prove disabled command explanations, command eligibility, and minimal policy summaries are derived from Core-visible facts and do not create policy/audit facts.

### D-006 Projection CLI Contract Parity

- Status: conditional Slice 1 work.
- Current temporary state: CLI projection commands may already call Core projection routes, but permission/error copy may not reflect the new projection permission split.
- Final state: CLI command docs and output distinguish projection read permission failures from projection control permission failures.
- Trigger: if Slice 1 changes CLI command behavior, error text, or documented permissions.
- Verification: CLI contract tests cover operator read-only access and admin/security-admin control access.

### D-007 Phase 10.1 Historical Checklist

- Status: intentionally not reopened.
- Current temporary state: `docs/roadmap/PHASE-10.1.md` remains a completed historical phase checklist even though this hardening plan adds follow-up work.
- Final state: Phase 10.1 stays historical; this plan tracks the hardening work. If the hardening grows beyond the accepted slices, create a new phase or ADR rather than rewriting completed history.
- Trigger: if implementation discovers a broad Projection Platform scope expansion.
- Verification: docs reference this plan for hardening work and Phase 10.1 only for original scope.

## 6. First Slice Test Boundary

Contract tests:

- Effect Schema decode success and failure for `ActorId` and `Permission`.
- Shared permission literals include `projection:read`, `projection:backfill`, and `projection:dlq-manage`.
- Contract Drift Checks cover shared permission literals against M-Policy and Core route adapter schemas where duplicated TypeBox schemas still exist.

Policy tests:

- `viewer` has no projection permissions.
- `operator` has only `projection:read`.
- `admin` and `security-admin` have all projection permissions.

Failure-mode tests:

- `viewer` gets `403` for projection health, DLQ list, backfill, replay, and skip.
- `operator` can read projection health and DLQ but gets `403` for backfill, replay, and skip.
- Audit Log write failure makes backfill, replay, and skip fail closed without calling `ProjectionPort`.
- Projection unavailable returns `503` and writes Full Log.

Success-path tests:

- `admin` or `security-admin` can run backfill, replay, and skip.
- Projection Control Actions write Audit Log before execution.
- Projection Control Actions write Timeline Log on success.

Real OpenSearch integration is out of scope for Slice 1; it belongs to Slice 2 or existing Phase 10 integration tests.

## 7. Out Of Scope

- Full migration of all `packages/contracts/src/types.ts` types to Effect Schema.
- Automatic Effect Schema to TypeBox conversion.
- Rewriting every Elysia route schema.
- M-Log projection engine module split in Slice 1.
- M-Task implementation in Slice 1.
- M-UI BFF CommandWell Eligibility migration in Slice 1.
- Reopening `docs/roadmap/PHASE-10.1.md` completed checklist.

## 8. Commit Boundary

Use two atomic commits:

1. `docs(architecture): make effect-first contracts explicit`
   - ADR-016
   - `MERISTEM-DEV.md`
   - `docs/contracts/CONTRACT-VERSIONING.md`
   - `docs/testing/TESTING.md`
   - `docs/README.md`
   - `CONTEXT.md`
   - this plan document

2. `feat(core): harden projection permissions and audit controls`
   - shared literals and Effect Schema for identity / permission / projection contracts
   - RBAC seed and M-Policy defaults
   - Core projection routes
   - CLI contract and command changes if needed
   - tests listed in this plan
