# Review Checklists

Detailed verification tables for reviewing or claiming completion. The orchestrating rule: a review verdict must be FAIL if any Hard Gate item in the relevant checklist is violated, regardless of other quality dimensions.

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

M-UI visual/style direction is currently reset. When reviewing or claiming completion for frontend work, verify active contract behavior (historical design exploration docs were removed in the v0.2 documentation restructure):

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

## Review Stage Integration

When running `review-work` (5-agent parallel review), the orchestrator must ensure the Code Quality Review agent (Agent 3) receives the Meristem-specific type safety and route architecture checklist. Do this by:

1. Load `meristem-engineering-guardrails` and `meristem-testing-gates` skills before launching review agents.
2. In the Agent 3 prompt, append the "Type Safety & Route Architecture Review Checklist" table above to the existing `REVIEW DIMENSIONS` section, under a new dimension: **"11. Meristem Type Safety & Route Architecture"**.
3. The Agent 3 verdict must be FAIL if any Hard Gate item in the checklist is violated, regardless of other quality dimensions.

When running `scrutinize` on a Meristem PR or diff, load `meristem-engineering-guardrails` first, and check the diff against the same checklist.
