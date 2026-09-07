---
name: meristem-testing-gates
description: Use when implementing, reviewing, or claiming completion for Meristem features, fixes, contracts, services, CLI, BFF, UI, migrations, failure modes, or phase acceptance work.
---

# Meristem Testing Gates

## Use With

Use after `meristem-context-protocol` and `meristem-engineering-guardrails`. M-UI ownership, SDUI, CommandWell, and frontend review rules live in `meristem-ui-contract`; defer to it for those boundaries.

Primary source documents:

- `docs/testing/TESTING.md`
- `package.json` scripts
- Relevant contract, service, roadmap, security, state, and operations docs for the touched area

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

Bun-only gate commands:

```bash
bun run format:check
bun run lint
bun run depcruise
bun run typecheck
bun run typecheck:e2e
bun run typecheck:m-ui
bun run test
bun run test:contracts
bun run test:failure-modes
bun run test:integration
bun run test:cli
bun run test:ui-contract
bun run test:e2e
bun run test:agent-submit
```

- `bun run test:v02-gates` chains the full gate set behind a frozen-lockfile install; use it for release-grade verification.
- The pre-push hook (`scripts/git-hooks/pre-push`) runs `format:check`, all three typechecks, and `test:agent-submit`.
- Runner split: root `bun run test` owns Bun-compatible `*.test.ts`; `cd apps/m-ui && bun run test` owns M-UI Vitest `*.vitest.ts`; `bun run test:playwright` owns `*.playwright.ts`. Do not collapse these layers.

For OpenSearch projection work also run or justify:

```bash
bun run test:opensearch-failure-modes
bun run test:opensearch-contracts
bun run test:opensearch-integration
```

`test:opensearch-integration` may skip gracefully when OpenSearch is not running; failure-mode and contract tests should not require OpenSearch.

## Enforced Repository Gates

These gates are wired into `lint`, `test:contracts`, git hooks, or `test:v02-gates`. Keep them green; do not bypass them locally.

- File-size ratchet: `tests/contracts/file-size-budget.contract.test.ts` caps `.ts`/`.svelte` files at 500 lines across `apps`, `services`, `packages`, `scripts`, `tests`; exceptions only via the registered oversize allowlist with a recorded reason.
- Packet forwarding: `tests/contracts/packet-forwarding-guard.contract.test.ts` statically guards Core and M-Net control-plane code against packet-forwarding boundary violations.
- Boundary imports: `bun run lint` runs Biome plus `scripts/boundary-import-check.ts --enforce`.
- Postgres doc parity: `tests/contracts/postgres-schema-doc-drift.contract.test.ts` fails when Drizzle schema tables drift from the data docs.
- Schema coverage / agent submit: `bun run test:agent-submit` runs the schema-coverage drift and M-Task draft alignment contract tests; it also runs in pre-push.
- Public API boundary: `tests/contracts/public-api-boundary.contract.test.ts` checks APISIX, route, and NixOS config so public join/relay/UI routes are exposed and `/internal/v0/*` plus the node-agent control channel stay private.
- Workspace hygiene: `bun run workspace-hygiene` keeps local runtime directories out of tracked source and review surfaces.
- Skill hygiene: `bun run skill-hygiene` enforces the SKILL.md frontmatter contract (only `name`/`description`, "Use when" trigger) and the 150-line body cap; `tests/contracts/skill-hygiene.test.ts` runs it repo-wide.
- Dependency rules: `bun run depcruise` enforces the dependency-cruiser architecture rules over `apps`, `services`, and `packages`.

## Minimum Coverage Rules

Every new capability needs:

- One happy-path test through REST or CLI when externally visible.
- One auth failure-mode test for insufficient permissions.
- One boundary test for documented state or input restrictions.
- Contract tests if a versioned contract changes.
- Failure-mode tests for degraded dependencies and fail-closed policy/audit behavior.
- Effect success and typed failure-path tests when complex workflows move into Effect.
- When a refactor extracts a new seam (new file, support helper, workflow helper, client factory, runtime adapter), add at least one direct test for that seam; do not rely only on older indirect coverage.

### Refactor Follow-Up Gates

For refactors, splits, or helper extractions, verify before claiming completion:

1. Behavior parity: the original high-value regression tests still pass.
2. Direct seam coverage: new extracted files/helpers have at least one focused test covering success and/or failure mapping.
3. No harness conflict: real-environment orchestration does not double-start services that a test harness already manages.
4. Environment fit: if a test requires toolchain assets such as `openssl`, the real-environment entrypoint must provide them (prefer `nix develop -c`).

Do not claim a capability complete until the relevant gates pass or a documented exception names the failing gate and reason.

## Hard Gates

- Repository code remains Bun-only; scripts, tests, services, and tooling run through Bun. `node:` standard-library imports are allowed only when executed by Bun without a Node.js runtime prerequisite.
- Source comments satisfy `MERISTEM-DEV.md §8.2`; Elysia method chains explain auth, policy, lifecycle, logging, and error mapping where non-obvious.
- Contract docs, tests, and implementation are updated together.
- Type safety: no `as unknown as` in production code outside documented ORM/runtime limits; no `as any`, `@ts-ignore`, `@ts-expect-error`; cross-service HTTP responses decoded via Effect Schema or TypeBox, not cast; support helpers return tagged failure unions, never `as never` short-circuits; `typecheck`, `typecheck:e2e`, and `typecheck:m-ui` all pass.
- Route architecture: handlers stay thin (schema + auth + orchestration + response); business logic lives in support/workflow files; TypeBox `t.*` is the primary input validator; the 500-line file cap above applies.
- M-UI, SDUI, BFF display contract, CommandWell, and extension-UI-adjacent changes must pass the ownership, route, CommandWell, and runner-split gates in `meristem-ui-contract`.

## Review Stage Integration

- `review-work`: the Code Quality Review agent (Agent 3) prompt must include the Hard Gates above as an extra review dimension; its verdict is FAIL if any hard gate is violated, regardless of other dimensions.
- `scrutinize`: load `meristem-engineering-guardrails` first and check the diff against the same hard gates.

## Timeout Rule

- Keep default `bun test` per-test timeout at `5000ms`.
- Only real TLS, WebSocket, or subprocess integration tests may opt into longer per-test timeout.
- Prefer test-level timeout over widening the whole suite or script timeout.

## Real-Environment Orchestration Rule

- `test:integration` and `test:e2e` do not share runtime assumptions; never run a self-starting integration file behind a dev stack that occupies the same ports.
- `test:e2e` self-manages the full stack via `tests/e2e/_shared.ts#startFullStack()`; real-environment wrapper scripts must not independently start `dev:all` / `dev:m-ui-bff` for the same run.
- Optional infra profiles (OpenSearch, Redis, APISIX) are best-effort extras, not prerequisites for the standard gate.
- Real-environment wrapper scripts execute Bun subcommands under `nix develop -c` so subprocesses inherit toolchain binaries.
