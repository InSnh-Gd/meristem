# Contract Authority Baseline: Refactoring Readiness Repair Wave

> **Status**: Active authority for Wave 1A–Wave 5  
> **Scope**: Active contract drift only; deferred items are explicitly named below.  
> **Authority**: This document overrides any conflicting draft or roadmap wording for the duration of the repair wave.

## Decisions

### 1. Public REST route canonical prefix

The canonical public REST route prefix is **`/api/v0`**.

All active public route contracts, tests, and documentation must align to this prefix. The deprecated v0.2-style public prefix and any other variant are considered drift and must be reconciled now. Internal routes remain under `/internal/v0` unless an explicit contract mismatch is found and resolved separately.

### 2. Phase 12 roadmap-only wording drift

Phase 12 roadmap-only wording drift is **excluded** from this repair wave.

The project is at Phase 19; Phase 12 text is historical context, not an active contract or implementation source. No task in this wave shall edit, update, or reconcile Phase 12 roadmap documents. Any reference to Phase 12 in active code or contracts must still be evaluated for drift, but the roadmap text itself is out of scope.

### 3. DB schema documentation drift

DB schema documentation drift is **deferred to Phase 20**.

Backfilling or reconciling database schema documentation is not part of this wave. It is recorded as a Phase 20 follow-up and must not be started silently.

### 4. No wholesale Elysia-to-Effect route validation rewrite

This wave **does not** include a wholesale rewrite of Elysia route validation to Effect Schema.

Effect Schema is used to add missing contracts for active route responses, event payloads, and config shapes that currently lack an executable schema. Existing Elysia route handlers and their inline validation remain unchanged unless a minimal, compatibility-preserving wrapper is already present.

### 5. OpenAPI work is conditional

OpenAPI completion is **conditional**.

Before any OpenAPI implementation, evaluate against the following thresholds:

- The fix is limited to plugin configuration, docs endpoint exposure, dependency cleanup, and documented public route visibility.
- No route validation rewrite is required.
- No endpoint shape change is required.
- `/internal/v0` routes must not leak into public OpenAPI output.
- The change can be verified with a single generated or fetched OpenAPI output.

If any threshold fails, the OpenAPI work is deferred and the blocker must be named explicitly.

## Deferred backlog

- DB schema documentation backfill → Phase 20
- `packages/db` ownership split → Phase 20
- Full non-active event catalog parity → Phase 20
- OpenAPI completion (if conditional thresholds fail) → follow-up task

## Exclusions

- Phase 12 roadmap text edits
- Deployment / CD rollout
- Broad behavior changes hidden inside cleanup tasks
