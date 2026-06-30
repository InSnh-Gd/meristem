---
name: meristem-testing-gates
description: Use when implementing, reviewing, or claiming completion for Meristem features, fixes, contracts, services, CLI, BFF, UI, migrations, failure modes, or phase acceptance work.
---

# Meristem Testing Gates

## Use With

Use after `meristem-context-protocol` and `meristem-engineering-guardrails`. Use `superpowers:verification-before-completion` before claiming work is complete.

Primary source documents:

- `docs/testing/TESTING.md`
- Relevant contract, service, roadmap, security, state, and operations docs for the touched area
- `package.json` scripts

## Required Test Types

Select tests by boundary touched:

- `typecheck`: TypeScript strictness and contract type coverage.
- `unit`: pure logic, Effect Schema decode/encode, schema narrowing.
- `contract`: API, Eden, event, service definition compatibility.
- `integration`: Core with service, NATS, PostgreSQL, OpenSearch, or internal HTTP boundaries.
- `failure-mode`: degraded behavior and fail-closed behavior.
- `e2e`: Core REST, BFF, CLI, auth, RBAC, and full request path.
- `migration`: old and new contract versions.
- `UI contract`: SDUI schema and forbidden component rules.

## TDD Loop For Core Logic

1. Write the failing test.
2. Run it and confirm failure.
3. Implement minimum code.
4. Run the test and confirm pass.
5. Add failure-path test.
6. Update docs if the contract changed.

## Baseline Commands

Use Bun-only commands:

```bash
bun run lint
bun run typecheck
bun run test
bun run test:contracts
bun run test:cli
bun run test:failure-modes
bun run test:integration
bun run test:e2e
```

For Phase 10 OpenSearch work also run or justify:

```bash
bun run test:opensearch-failure-modes
bun run test:opensearch-contracts
bun run test:opensearch-integration
```

`test:opensearch-integration` may skip gracefully when OpenSearch is not running; failure-mode and contract tests should not require OpenSearch.

## Minimum Coverage Rules

Every new capability needs:

- One happy-path test through REST or CLI when externally visible.
- One auth failure-mode test for insufficient permissions.
- One boundary test for documented state or input restrictions.
- Contract tests if a versioned contract changes.
- Failure-mode tests for degraded dependencies and fail-closed policy/audit behavior.
- Effect success and typed failure-path tests when complex workflows move into Effect.
- When a refactor extracts a new seam (new file, support helper, workflow helper, client factory, runtime adapter), add at least one **direct** test for that seam; do not rely only on older indirect coverage from the source file it came from.

### Refactor Follow-Up Gates

When the change is primarily a refactor, split, or helper extraction, verify all of the following before claiming completion:

1. **Behavior parity**: the original high-value regression tests still pass.
2. **Direct seam coverage**: new extracted files/helpers have at least one focused test covering success and/or failure mapping.
3. **No harness conflict**: real-environment orchestration does not double-start services that a test harness already manages.
4. **Environment fit**: if a test requires toolchain assets such as `openssl`, the real-environment entrypoint must provide them (for this repo, prefer `nix develop -c`).

Do not claim a capability complete until the relevant gates pass or a documented exception names the failing gate and reason.

## Hard Gates

- Repository code remains Bun-only.
- Scripts, tests, services, and tooling run through Bun rather than the Node.js executable.
- Node-compatible standard-library imports may use the `node:` protocol when required by Biome or TypeScript tooling, provided they are executed by Bun and do not introduce a Node.js runtime prerequisite.
- Source comments satisfy `MERISTEM-DEV.md §8.2` for touched code.
- Elysia method chains explain auth, policy, lifecycle, logging, and error mapping where non-obvious.
- Contract docs, tests, and implementation are updated together.

### M-UI Ownership Hard Gates

For M-UI, SDUI, BFF display contract, CommandWell, or M-Extension UI-adjacent changes:

- M-UI owns route surfaces, Svelte components, layout decisions, interaction structure, and the `layout / modules / ui` split.
- Capability domain services, M-Extension, and plugins must not supply M-UI pages, components, layouts, or runtime frontend modules.
- SDUI remains a route/component contract registry; it must not become a runtime page renderer or composition engine without a new ADR and contract migration.
- M-UI BFF remains a UI-facing adaptation layer; it must not own UI component structure, final business facts, final authorization, or final policy decisions.
- Design exploration, tests, and implementation must respect `M-UI -> M-UI BFF -> Core public facade -> capability domain services`.

### Type Safety Hard Gates

- No `as unknown as` double assertions in production code except documented ORM/runtime limitations with inline justification (see guardrails §类型断言边界).
- No `as any`, `@ts-ignore`, or `@ts-expect-error` in production code.
- Cross-service HTTP boundaries use Effect Schema decode or TypeBox validation, not `result.data as { ... }` casts.
- Support helpers return tagged failure unions, not `as never` short-circuits (see guardrails §Support helper 错误传播).
- `bun run typecheck`, `bun run typecheck:e2e`, and `bun run typecheck:m-ui` all pass.

### Route Architecture Hard Gates

- Route handlers stay thin: schema + auth + orchestration + response (see guardrails §路由层职责).
- Business logic (state machines, event sequences, audit chains) lives in support/workflow files, not in route handlers.
- TypeBox `t.*` is the primary input validator; no manual body parsers in route handlers.
- Files do not exceed 500 lines (see guardrails §文件模块化规则).
- No `externalApiError(...) as never` or similar never-return patterns inside support helpers.

## Type Safety & Route Architecture Review Checklist

When reviewing or claiming completion, verify each item against the changed files:

| # | Check | Pass Criteria |
|---|-------|---------------|
| 1 | Double assertions | No `as unknown as` in production code, or inline-justified ORM/runtime exception |
| 2 | Type suppression | No `as any`, `@ts-ignore`, `@ts-expect-error` in production code |
| 3 | HTTP boundary decode | Cross-service responses decoded via Effect Schema or TypeBox, not cast |
| 4 | Support helper failure | Helpers return tagged failure unions; route layer does final `return`/`status` |
| 5 | Input validation | TypeBox `t.*` schema drives body/params/response types; no manual parsers |
| 6 | Route thinness | Handler body is schema + auth + call + return; no multi-step business logic inline |
| 7 | File size | No changed file exceeds 500 lines |
| 8 | Type gate coverage | `typecheck` + `typecheck:e2e` + `typecheck:m-ui` all pass |
| 9 | Pre-push gate | `scripts/git-hooks/pre-push` includes typecheck (not just format + drift) |
| 10 | Test helper integrity | Test mocks use structural construction, not whole-object double assertions |

## M-UI Ownership Review Checklist

When reviewing or claiming completion for M-UI, SDUI, BFF display contracts, CommandWell, or extension-UI-adjacent changes, verify:

| # | Check | Pass Criteria |
|---|-------|---------------|
| 1 | UI ownership | M-UI-owned files implement route surfaces, components, layout, and interaction structure |
| 2 | Service boundary | Capability domain services expose facts/capabilities/contracts only; they do not declare or ship frontend pages/components |
| 3 | BFF boundary | BFF adapts UI-facing data but does not own UI structure, final facts, final authorization, or final policy decisions |
| 4 | SDUI boundary | SDUI changes update route/component inventory and validation only; runtime rendering/composition is not introduced without ADR |
| 5 | Plugin boundary | M-Extension/plugin UI contribution remains deferred unless a dedicated ADR, security model, and SDUI extension track are present |
| 6 | Data flow | M-UI calls M-UI BFF only; BFF uses Core public facades for Core and capability domain facts/capabilities |
| 7 | Modular frontend | New frontend modularity happens inside M-UI `layout / modules / ui`, not through service/plugin-supplied runtime UI |

### M-UI Frontend Review Gates

M-UI visual/style direction is currently reset. When reviewing or claiming completion for frontend work, treat preserved design exploration docs as historical context only and verify active contract behavior:

| # | Gate | Pass Criteria |
|---|------|---------------|
| 1 | SDUI registry | Route/component/state-source contract remains valid and fail-closed. |
| 2 | BFF boundary | M-UI calls M-UI BFF only; BFF does not own final facts or authorization. |
| 3 | CommandWell | High-risk or destructive actions remain explicit, confirmed, and auditable. |
| 4 | State visibility | Critical state remains visible, traceable, and not color-only. |
| 5 | Runner split | M-UI DOM tests stay under the Vitest runner with `*.vitest.ts`; root Bun tests stay Bun-compatible. |

Hard rules for frontend review:

- New M-UI runtime/component tests go under `apps/m-ui/tests/runtime/`, not under production `src/**` paths unless they are source-contract tests.
- No frontend expansion may weaken the existing M-UI ownership, SDUI registry, CommandWell, policy/audit/log visibility, or route-boundary hard gates above.

## Timeout Rule

- Keep default `bun test` per-test timeout at `5000ms`.
- Only real TLS, WebSocket, or subprocess integration tests may opt into longer per-test timeout.
- Prefer test-level timeout over widening the whole suite or script timeout.

## Real-Environment Orchestration Rule

- `test:integration` and `test:e2e` do **not** have the same runtime assumptions. If an integration file self-starts mocks or services, do not run it behind an already-running dev stack that occupies the same ports.
- `test:e2e` in this repo self-manages the full stack via `tests/e2e/_shared.ts#startFullStack()`. Real-environment wrapper scripts must not independently start `dev:all` / `dev:m-ui-bff` for the same run.
- Optional infra profiles (OpenSearch, Redis, APISIX) are best-effort extras for real-environment verification, not prerequisites for the standard gate.
- Real-environment wrapper scripts should execute Bun subcommands under `nix develop -c` so subprocesses inherit required toolchain binaries.

## Review Stage Integration

When running `review-work` (5-agent parallel review), the orchestrator must ensure the Code Quality Review agent (Agent 3) receives the Meristem-specific type safety and route architecture checklist. Do this by:

1. Load `meristem-engineering-guardrails` and `meristem-testing-gates` skills before launching review agents.
2. In the Agent 3 prompt, append the "Type Safety & Route Architecture Review Checklist" table above to the existing `REVIEW DIMENSIONS` section, under a new dimension: **"11. Meristem Type Safety & Route Architecture"**.
3. The Agent 3 verdict must be FAIL if any Hard Gate item in the checklist is violated, regardless of other quality dimensions.

When running `scrutinize` on a Meristem PR or diff, load `meristem-engineering-guardrails` first, and check the diff against the same checklist.
