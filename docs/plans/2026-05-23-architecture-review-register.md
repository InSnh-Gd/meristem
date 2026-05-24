# Architecture Review Register

> Status: Accepted register. This document records the architecture review findings from 2026-05-23 and routes each item to an implementation plan, roadmap draft, or future slice.

---

## A-001 Projection Permission Hardening

Status: implemented.

Primary plan: `docs/plans/2026-05-23-effect-projection-hardening.md`.

Problem:

- Projection Platform public Core routes used broad read permission for operations that can change OpenSearch Read Model Projection operating state or visible repair outcome.

Accepted decision:

- Add explicit permissions: `projection:read`, `projection:backfill`, `projection:dlq-manage`.
- Projection Read Actions do not write Audit Log.
- Projection Control Actions must pass M-Policy, write Audit Log before execution, fail closed if Audit Log is unavailable, and write Timeline / Full Log according to outcome.

Final state:

- Core owns public permission/audit/log orchestration.
- M-Log owns projection implementation details.
- Operators get projection read visibility without projection control authority.

Verification:

- Contract, policy, failure-mode, and success-path tests listed in the primary plan.
- Implemented by `feat(core): harden projection permissions and audit controls`.

---

## A-002 Contract Locality And Drift

Status: implemented.

Primary references:

- `docs/adr/ADR-016-effect-without-effect-everywhere.md`
- `docs/plans/2026-05-23-effect-projection-hardening.md`

Problem:

- Contract literals and runtime schemas are repeated across Core, M-Policy, M-Log, and CLI/BFF adapters.
- The current Interface is shallow: every caller must remember the same actor, permission, log, policy, and projection vocabularies.

Accepted decision:

- Effect Schema is the internal source for complex executable contracts.
- Elysia TypeBox remains the REST/OpenAPI adapter until routes are deliberately migrated.
- Where both exist, add Contract Drift Checks.
- Do not introduce a broad Effect Schema to TypeBox conversion layer until duplication justifies it.

Final state:

- `packages/contracts/src/literals.ts` owns shared literal vocabularies.
- `packages/contracts/src/schemas/` owns domain-specific Effect Schema modules.
- Migrated public TypeScript types derive from Effect Schema or the shared literal source.

Verification:

- Effect Schema decode/encode tests.
- Drift tests between shared Effect Schema/literals and TypeBox/OpenAPI adapters.
- Implemented by `docs(architecture): make effect-first contracts explicit` and projection hardening contract tests.

---

## A-003 M-Task Future Domain

Status: drafted for future phase.

Primary roadmap: `docs/roadmap/PHASE-11.md`.

Problem:

- `POST /api/v0/tasks` orchestration is too thick for a route handler, but promoting task handling immediately to a new M-* domain would be premature unless task behavior expands beyond MVP `noop`.

Accepted decision:

- Record `M-Task` as a future Phase 11 draft.
- Do not introduce `M-Task` in the current projection hardening slice.
- Current MVP `noop` behavior and `task:assign` compatibility remain stable.

Final state:

- If promotion triggers are met, M-Task owns task lifecycle, task type registry, scheduling, retry, cancellation, timeout, priority, execution coordination, and task observability.
- M-Net still owns transport/session state; node-agent still owns local execution; M-Policy still owns authorization; M-Log still owns log facts.

Verification:

- Phase 11 readiness criteria in `docs/roadmap/PHASE-11.md`.

---

## A-004 M-Log Projection Module Depth

Status: implemented.

Problem:

- `services/m-log/src/projection.ts` owns job, cursor, DLQ, retry, health, backfill, document mapping, and OpenSearch writes in one broad Module.
- The Interface exposes many internal operations and tests must mock too much Drizzle shape.

Accepted decision:

- Keep M-Log as owner of Projection Platform internals.
- Split projection implementation into deeper internal Modules without changing Core's external Interface or creating a new M-* domain.

Target structure:

```text
services/m-log/src/projection/
  engine.ts
  job-store.ts
  cursor-store.ts
  dlq-store.ts
  retry.ts
  backfill.ts
  health.ts
  document-map.ts
  errors.ts
```

Implementation note:

- `services/m-log/src/projection.ts` remains the public facade for existing imports.
- Projection internals now live under `services/m-log/src/projection/` with separate modules for engine assembly, job storage, cursor storage, DLQ, retry, backfill, health, document mapping, typed errors, and shared table/type helpers.

Rules:

- `engine.ts` keeps the outside-facing projection engine facade equivalent to current `createProjectionEngine(...)`.
- M-Log routes call only `engine.ts`.
- Core continues to call M-Log internal HTTP through `ProjectionPort`.
- Core must not import projection job/cursor/DLQ internals.
- Effect workflows belong in backfill/retry/engine paths; simple row mapping may remain pure.

Final state:

- Backfill, retry/DLQ, health, and document mapping each have locality.
- Tests can target workflow interfaces without route-only coverage or fragile large mocks.

Verification:

- Existing `tests/integration/opensearch-projection.test.ts` continues to pass.
- New lower-level tests cover typed projection errors and workflow success/failure paths.

---

## A-005 M-UI BFF CommandWell Eligibility

Status: implemented.

Problem:

- CommandWell Eligibility is currently derived inside BFF route code, which makes display rules harder to test and easier to duplicate in the frontend.

Accepted decision:

- Create a BFF-internal display-shaping Module.
- Do not move this to M-Policy.
- Do not let the frontend derive eligibility rules.

Target structure:

```text
services/m-ui-bff/src/command-well/
  eligibility.ts
  schemas.ts
  errors.ts
```

Implementation note:

- `services/m-ui-bff/src/command-well/eligibility.ts` owns CommandWell Eligibility display shaping.
- BFF routes call the module after reading session and node facts from Core REST.
- Missing permission and missing target are returned as disabled display states without creating PolicyDecision or Audit Log facts.

Rules:

- BFF derives CommandWell Eligibility only from Core-visible facts: session permissions and node details from Core REST.
- BFF must not call M-Policy directly.
- BFF must not create Audit Log or PolicyDecision facts.
- Frontend renders BFF output and does not duplicate eligibility logic.
- Phase 9 may keep Chinese disabled copy in BFF output because visible Chinese copy is part of the demo shell contract.
- If more command types appear, move schemas to `packages/contracts/src/schemas/command.ts`.

Final state:

- CommandWell Eligibility, Disabled Command Explanation, and Minimal Policy Decision Summary have a stable Interface.
- M-UI BFF remains a permission-aware display seam, not a policy fact source.

Verification:

- BFF contract tests cover missing permission, target missing, non-Leaf target, unreachable target, enabled command, and frontend-only rendering behavior.

---

## A-006 Workspace Hygiene And Backup/Generated Artifacts

Status: implemented.

Problem:

- `.bak`, generated Svelte output, `.svelte-kit`, and local source mirrors can pollute search, audits, and agent exploration when they appear as untracked workspace noise.

Accepted decision:

- Treat this as a repository hygiene gate, not a product refactor.
- Add ignore rules and a Bun-only hygiene script.

Target changes:

```text
.gitignore
scripts/workspace-hygiene.ts
package.json script: workspace-hygiene
optional tests/contracts/workspace-hygiene.test.ts
```

Implementation note:

- `.gitignore` ignores backup, temporary, merge backup, and local agent source mirror artifacts.
- `scripts/workspace-hygiene.ts` provides a Bun-only scanner and exported pure classification function.
- `package.json` exposes `bun run workspace-hygiene`.
- Existing `.bak` files were removed before implementation.

Ignore candidates:

```gitignore
*.bak
*.tmp
*.orig
.agent-sources/
```

Rules:

- The script should fail if tracked source paths contain `*.bak`, generated build output, `.svelte-kit`, or `node_modules`.
- Existing backup files should be cleaned in an explicit implementation slice, not silently deleted as part of planning.
- Agents should not treat `.bak` files as source of truth.

Final state:

- Common generated and backup artifacts do not appear in normal `rg`, git status, or review paths.
- Hygiene failure is actionable through one command.

Verification:

- `bun run workspace-hygiene`.
- Optional contract test for the hygiene scanner core function.

---

## A-007 DynamicRouteAdapter For Eden/REST Dynamic Paths

Status: implemented.

Problem:

- CLI and Core adapters use local casts or raw fetch for dynamic Eden paths such as node credentials, network members, service reload, and projection DLQ replay/skip.
- Each caller currently repeats URL encoding, headers, JSON parsing, error envelope extraction, and response typing.

Accepted decision:

- Define a `DynamicRouteAdapter` seam for Meristem dynamic REST paths.
- Keep static Eden routes on Eden.
- Use the adapter only where Eden inference is brittle or raw dynamic path calls are needed.

Target location:

```text
packages/internal-http/src/dynamic-routes.ts
```

Implementation note:

- `packages/internal-http/src/dynamic-routes.ts` owns dynamic route path expansion, path parameter encoding, query serialization, header injection, JSON parse failure, and Meristem error envelope extraction.
- CLI projection DLQ replay/skip and Core-to-M-Log projection DLQ replay/skip now use the adapter instead of local raw fetch glue.

Target Interface:

```ts
type DynamicRouteAdapter = {
  postJson<TResponse>(
    path: string,
    input: {
      headers?: Record<string, string>
      body?: unknown
      expected?: unknown
    }
  ): Promise<Result<TResponse, ServiceError>>

  getJson<TResponse>(
    path: string,
    input?: {
      headers?: Record<string, string>
      query?: Record<string, string | number | boolean | undefined>
      expected?: unknown
    }
  ): Promise<Result<TResponse, ServiceError>>
}
```

Rules:

- Adapter owns URL encoding, query serialization, bearer/internal headers, trace header injection, JSON parse failure, and Meristem error envelope extraction.
- Callers must not inline raw fetch for dynamic Meristem routes unless they document an exception.
- Later, `expected` should use Effect Schema decoding for response validation.

Final state:

- CLI bearer-auth calls and Core internal-token calls share the same dynamic route behavior.
- Dynamic route glue becomes a real seam with production and test adapters.

Verification:

- Unit tests for path encoding, query serialization, header injection, JSON failure, Meristem error envelope extraction, and typed success.
- CLI/Core adapter tests prove dynamic routes use the adapter instead of raw fetch/casts where applicable.
