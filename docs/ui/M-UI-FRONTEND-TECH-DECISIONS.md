# M-UI Frontend Tech Decisions

> Wave 4 Task 9 of the M-UI Transitional Workbench Design Activation Plan.
>
> This is a **documentation-only deliverable**. It captures the conditional
> frontend technology decisions needed to implement the Focus-Flow Ledger
> direction selected in
> [`M-UI-DESIGN-EXPLORATION-DECISION.md`](./M-UI-DESIGN-EXPLORATION-DECISION.md).
> It depends on the structure mapping (Task 7 —
> [`M-UI-STRUCTURE-MAPPING.md`](./M-UI-STRUCTURE-MAPPING.md)) and the Bits UI
> evaluation (Task 8 — [`M-UI-BITS-UI-EVALUATION.md`](./M-UI-BITS-UI-EVALUATION.md)),
> and it respects the test-foundation prerequisites from
> [`M-UI-STRUCTURE-AND-TEST-GAP-AUDIT.md`](./M-UI-STRUCTURE-AND-TEST-GAP-AUDIT.md) §8.
>
> This document does not install dependencies, write M-UI code, restructure
> components, or mutate any tracked file other than itself. Every decision is
> **conditional** — each states the trigger that would reopen it.

---

## 1. Executive Summary

The Focus-Flow Ledger direction does not require new layout abstractions. The
current M-UI app is already a SvelteKit 5 (Svelte 5.37.0) static-adapter
application whose 27 components are flat under `apps/m-ui/src/lib/components/`
and are already built on Svelte 5 runes with token-driven CSS custom properties.
The transitional workbench therefore converges on the *existing* technology
choices, formalizing them as conditional defaults rather than introducing new
frameworks.

The six concrete conditional decisions for the transitional workbench are:

1. **Svelte 5 runes remain the component model.** No Svelte 4 class-based
   components for new code. Status: already in use (`svelte@5.37.0`).
2. **CSS custom properties remain the token layer.** No Tailwind, no CSS-in-JS.
   `DESIGN.md` defines semantic tokens; modules import `app.css`.
3. **State shape stays per-module Svelte 5 runes stores.** A thin
   `stores.svelte.ts` holds global shell state; per-module state lives in
   `lib/modules/<domain>/state.ts`. No global mega-store, no cross-domain
   coupling.
4. **Bits UI adoption is gated on the `layout / modules / ui` split.** Do not
   add `bits-ui` until after the structural split. Adoption order: Skeleton →
   Dialog → Table → Command/Combobox. Primitives stay inside `ui/`.
5. **BFF/SDUI consumption remains contract-first.** M-UI calls the BFF via the
   existing `lib/bff.ts`; new SDUI routes must be added to `lib/types.ts` and
   the route registry reader.
6. **The `layout / modules / ui` restructure is gated on the test foundation.**
   Route-render smoke tests, token-presence checks, CommandWell behavior tests,
   degraded-BFF scenarios, and registry↔renderer reconciliation tests must be
   green before any file moves.

All six decisions are reversible under stated conditions; the triggers are
recorded per decision below.

---

## 2. Decision 1 — Svelte 5 Runes as the Component Model

**Status: already in use.**

`apps/m-ui/package.json` pins `svelte@5.37.0`. All 27 existing components under
`apps/m-ui/src/lib/components/` are already runes-based (`$props`, `$derived`,
`$state`), and the app state store (`stores.svelte.ts`) is a Svelte 5 runes
class. `@sveltejs/vite-plugin-svelte@5.0.3` and `@sveltejs/kit@2.25.0` are the
matching toolchain. There is no legacy Svelte 4 slot/class-based pattern to
reconcile.

**Decision:** Stay on Svelte 5 runes. All new components — shell chrome in
`layout/`, per-domain modules in `modules/`, and reusable primitives in `ui/`
— use runes (`$props`, `$state`, `$derived`, `$effect`) exclusively. No
class-based Svelte 4 components are introduced for new code.

**Rationale:**
- The reactive primitives (`$state`, `$derived`) match the store-driven shell
  and per-module store pattern already in `stores.svelte.ts`.
- Migration cost is zero: the entire surface is already runes-based, so staying
  on runes introduces no conversion work and no mixed-paradigm surface.
- Runes compose cleanly with the planned `layout / modules / ui` split: each
  module owns its local `$state`, and the shell owns shared session/overview
  state, without a global reactivity framework.
- The Bits UI evaluation (Task 8 §7) confirms the adoption path assumes a
  runes-compatible surface; staying on runes keeps that path open.

**Conditions for revisiting:**
- **Svelte 6** ships and changes the runes model or deprecates APIs M-UI relies
  on. Re-evaluate the component model at the Svelte 6 upgrade window.
- A module needs a **class-based state machine** (e.g., a command lifecycle
  with explicit states/transitions) that runes cannot express cleanly. Then
  consider a dedicated state-machine library scoped to that module (see
  Deferred Decisions §9), not a revert to Svelte 4 class components.
- A future workbench redesign requires an interaction model that runes cannot
  support. This is out of scope for the transitional workbench.

---

## 3. Decision 2 — CSS Custom Properties as the Token Layer (No Tailwind, No CSS-in-JS)

**Status: current components already use CSS custom properties.**

The existing 27 components use token-driven CSS custom properties in their
`<style>` blocks. The visual-contract test
(`tests/ui-contract/m-ui-visual-contract.test.ts`) is a static source-file scan
that asserts no raw color values appear inside component `<style>` blocks —
confirming the token-driven convention is already enforced.
`apps/m-ui/package.json` declares no Tailwind, no CSS-in-JS library, and no CSS
framework. `DESIGN.md` §4–§6 defines the semantic token scale.

**Decision:** Keep token-driven CSS custom properties as the token layer.
`DESIGN.md` defines the semantic tokens; modules and primitives consume them by
importing `app.css` (the global token sheet) and referencing the custom
properties. No Tailwind, no CSS-in-JS runtime, no CSS-modules abstraction is
introduced for the transitional workbench.

**Rationale:**
- Matches current practice — zero migration cost, zero new bundle cost.
- CSS custom properties are natively understood by the browser with no runtime;
  this keeps the static-adapter (`@sveltejs/adapter-static`) bundle minimal.
- The token-driven approach is easy to migrate later: Tailwind v4 is itself
  built on CSS variables, and Figma variables map 1:1 to custom properties, so
  a future design-system handoff or framework migration is a token rename, not
  a rewrite.
- The static visual-contract scan already enforces the "no raw colors" rule;
  staying on custom properties keeps that gate meaningful.

**Conditions for revisiting:**
- **Theming (dark mode)** is required. CSS custom properties support dark mode
  via `prefers-color-scheme` overrides, but if a multi-theme system beyond
  light/dark is needed, evaluate a token pipeline (Style Dictionary, Tailwind
  v4 variables) at that point.
- **Design-system handoff to Figma variables** formalizes the token contract.
  At handoff time, regenerate `app.css` from the Figma variable source so the
  two stay in sync; the custom-property *consumption* layer does not change.
- A module needs utility-class ergonomics that custom properties alone cannot
  provide (e.g., rapid layout iteration). Then scope a Tailwind v4 evaluation
  to that module's prototypes, not the production token layer.

---

## 4. Decision 3 — State Shape: Per-Module Svelte 5 Runes Stores, No Global Mega-Store

**Status: current `stores.svelte.ts` is a single lightweight `AppState` class.**

The audit (§5) records that `stores.svelte.ts` is a single Svelte 5 runes-based
`AppState` class exported as the `appState` singleton. It mixes session state,
global load/error flags, domain data caches, per-domain loading/error flags, and
the command surface. The audit notes this is "acceptable for the transitional
surface but is a structural seam that future `layout / modules / ui` mapping
must account for."

**Decision:** Keep a thin `stores.svelte.ts` for **global shell state only** —
session (`token`, `actor`, `permissions`), the route registry (`routes`), and
shell-level degraded flags. Per-domain state moves into
`lib/modules/<domain>/state.ts` as module-scoped runes stores. No global
mega-store aggregates all domain caches after the split.

Specifically:
- `stores.svelte.ts` retains: `token`, derived `actor`/`permissions`, `routes`,
  the shell `refresh()` orchestrator, and shell-level `loading`/`error`.
- Each `lib/modules/<domain>/state.ts` owns: its domain data cache, its
  per-domain loading/error flags, and its domain fetch logic (delegating to
  `lib/bff.ts`).
- The command surface stays accessible to modules that render `CommandWell`, but
  its eligibility data is BFF-derived and display-only (per the contract skill).

**Rationale:**
- Aligns with the `modules/` split from the structure mapping (Task 7 §2.2):
  each module owns its complete vertical content, including its state.
- Avoids cross-domain coupling — a change to the audit module's state shape
  cannot break the nodes module.
- Keeps M-UI owning UI state; services own facts (the BFF remains the only data
  source, per Decision 5).
- The shell store stays thin enough that the existing BFF boundary
  (`M-UI → M-UI BFF → Core → M-*`) is preserved without a central state
  god-object.

**Conditions for revisiting:**
- **Cross-domain correlation** is needed (e.g., a network event should trigger a
  node-list refresh). Then route the correlation through **BFF events or a
  BFF-derived refresh signal**, not a shared global store. The store shape stays
  per-module; the correlation is a side-effect orchestrator in the shell, not a
  cross-domain data dependency.
- A module's state grows complex enough to need a state machine (command
  lifecycle, multi-step approval flow). Then introduce a scoped state machine
  *inside that module's `state.ts`* (see Deferred Decisions §9), not a global
  pattern.
- Realtime UI transport is added to the contract (currently out of scope). Then
  re-evaluate the shell store's role as the event-subscription hub.

---

## 5. Decision 4 — Bits UI Adoption Is Gated on `layout / modules / ui` Split

**Status: `bits-ui` is not installed** (Task 8 §2 confirms no declaration in
`apps/m-ui/package.json`, root `package.json`, or `bun.lock`; no imports
repo-wide).

**Decision:** Do **not** add `bits-ui` until after the `layout / modules / ui`
structural split and the test-foundation prerequisites (audit §8 items 1–4) are
green. Bits UI is a headless (unstyled) Svelte component library that ships
behavior and accessibility without styles, so it composes with the existing
token-driven CSS layer without imposing a visual language.

**Adoption order** (sequenced by the audit's degraded-visibility priority and
the Focus-Flow Ledger's surfaces):

1. **Skeleton (degraded states)** — addresses drift D10 (silent error
   swallowing in `fetchDataplaneStatus`/`fetchGlobalDefaults`) and pairs with
   the degraded-BFF test scenario (audit §8 item 4). Adopted first because
   degraded-state visibility is a required workbench rule and the
   highest-severity gap in the current surface.
2. **Dialog (command confirmation)** — wraps destructive/high-risk command
   confirmation in the shared `CommandWell`. Brings focus-trap,
   escape-to-cancel, backdrop, and scroll-lock for free, directly strengthening
   the conservative-action contract. The single highest-value primitive per
   Task 8.
3. **Table (ledgers)** — backs `AuditLedger` and `ServiceRegistryTable` when
   sorting/pagination/keyboard navigation is needed. For the current read-only
   ledger view the gain is modest; revisit when ledger interactivity expands.
4. **Command/Combobox (command search)** — drives CommandWell eligibility search
   over BFF-derived eligible commands. New capability (not a replacement),
   supporting the orient→evaluate→execute workflow.

**Containment rule:** Bits UI primitives stay inside the `ui/` primitive layer
only. Wrappers (`ui/ConfirmDialog.svelte`, `ui/Skeleton.svelte`,
`ui/LedgerTable.svelte`, `ui/CommandSearch.svelte`) enforce the workbench rules
(Chinese disabled reasons, impact summaries, non-icon-only destructive actions,
non-dismissible alerts) — the headless primitive never receives domain semantics
directly. Bits UI shapes must **never** leak into BFF contracts or SDUI schemas;
contract tests should assert no `bits-ui` import paths appear outside
`apps/m-ui/src/lib/ui/`.

**Rationale:**
- Task 8 §6 explicitly recommends adopting after the split so primitives can be
  swapped inside `ui/` without disturbing module composition, and so
  regressions are attributable (adding a dependency in the same window as a
  structure move multiplies risk).
- Task 8 §5 confirms adoption is boundary-safe provided Bits UI is confined to
  `ui/` and wrapped to enforce workbench invariants.
- The headless/unstyled nature means zero conflict with the Control Room Ledger
  aesthetic and the token-driven CSS layer (Decision 2).

**Conditions for revisiting:**
- A primitive's behavior (focus trap, a11y, scroll-lock) is needed **before**
  the split lands. Then consider an **isolated prototype** in a throwaway branch
  to validate the behavior, not a production adoption that bypasses the gate.
- Bits UI's Svelte 5 runes compatibility breaks at a future `svelte` version.
  Re-verify with a mount smoke test against the then-current Svelte version
  before pinning (Task 8 §7 flags this as a High-severity risk).
- A different headless library (e.g., shadcn-svelte, melt-ui) offers better
  fit. Re-evaluate at the adoption gate if the Svelte 5 ecosystem has shifted.

---

## 6. Decision 5 — BFF/SDUI Consumption Remains Contract-First

**Status: M-UI calls the BFF via `lib/bff.ts`; SDUI registry consumed for navigation labels only.**

The audit (§2.1, §4) confirms M-UI calls only the M-UI BFF at `localhost:3200`
via `lib/bff.ts` (24 endpoint methods + 3 helpers). No page fetches directly.
The SDUI v0.2 route registry is consumed in `+layout.svelte` for navigation
labels; the per-route `components` and `stateSources` fields are validated by
contract tests but are not used to drive rendering (each page hand-picks
components and hardcodes `stateSources` — drift D8).

**Decision:** M-UI continues to call the BFF through the existing `lib/bff.ts`
client. New SDUI routes must be added to `lib/types.ts` and the route registry
reader (`ROUTE_PATH_MAP` in `+layout.svelte`) so navigation stays in sync with
the registry. M-UI does not call Core or M-* services directly; the
`M-UI → M-UI BFF → Core public facade → M-*` boundary is preserved.

**Rationale:**
- Preserves the ownership boundary: services own facts; M-UI BFF adapts; M-UI
  owns rendering. The BFF is the contract-decoded boundary; `bff.ts` is a thin
  typed client.
- Keeps SDUI as a contract registry (navigation + component-kind contracts),
  not a runtime renderer — consistent with the ownership rule.
- Centralizing BFF access in `lib/bff.ts` means drift D9 (available-but-unused
  endpoints) remains observable and the boundary test
  (`tests/ui-contract/m-ui-bff-boundary.test.ts`) stays enforceable.

**Conditions for revisiting:**
- **SDUI v0.3** changes the route shape. Then update `lib/types.ts` and the BFF
  client (`lib/bff.ts`), not M-UI's rendering assumptions. The rendering layer
  consumes the typed client, not the raw registry shape.
- The registry's `components`/`stateSources` fields become runtime-rendering
  directives (a future ADR would be required — currently SDUI is a registry,
  not a renderer). Then the route reader expands, but the BFF remains the data
  source.
- A module needs an endpoint not yet in `bff.ts`. Add it to `bff.ts` as a typed
  method; do not fetch directly from a component or module state file.

---

## 7. Decision 6 — Testing Strategy for the Split

**Status: no Svelte component render tests exist today** (audit §7.2: no `test`
script, no vitest, no `@testing-library/svelte` in `apps/m-ui/package.json`;
all 15 existing test files are BFF/contract/boundary/failure-mode/e2e tests,
none mount a Svelte component).

**Decision:** Gate the `layout / modules / ui` restructure on the following test
foundation (the audit §8 prerequisites, restated as hard gates). No file moves
until items 1–4 are green; item 5 should accompany Wave 1.

1. **Route-render smoke tests** for every route (all 18 SvelteKit pages). Each
   test mounts the page with a stubbed BFF and asserts the expected primary
   components are present. Priority routes: `control-room.overview`,
   `policy.approvals.detail`, `network.profiles.detail`, `mnet.break-glass`.
   Locks the rendered surface so file moves cannot silently drop a component.

2. **Token-presence / auth-context tests.** Render representative components and
   assert styles resolve to CSS custom properties from `MERISTEM-DESIGN.md`
   tokens (no raw color values) at render time — extending the current static
   scan into a rendered-DOM assertion. Also assert token/session context is
   present before privileged surfaces render.

3. **CommandWell behavior tests.** Component-level tests for the shared
   `CommandWell.svelte` covering: disabled-reason visibility, confirmation step
   before execution, inline Core error-envelope rendering on failure, and
   post-action refresh trigger. Protects the converged behavior once D4
   (inline CommandWells) is resolved.

4. **Degraded-BFF scenario tests.** Mount a route with a BFF stub that fails one
   endpoint (e.g. `fetchDataplaneStatus` or `fetchGlobalDefaults`, which
   currently swallow errors) and assert the UI surfaces a visible degraded
   state — via `InlineOperationalAlert` or an explicit disabled reason — rather
   than silently hiding the failure. Directly addresses D10 and the
   degraded-state visibility rule.

5. **Registry↔renderer reconciliation tests (recommended).** For each registry
   route, assert the components the page actually renders are a superset of (or
   equal to) the registry's `components` array — or explicitly records a
   justified divergence. Would have caught D2/D3/D8 and should accompany any
   drift reconciliation.

These prerequisites align with the Meristem testing gates: route-render smoke
and token checks map to UI contract tests; CommandWell behavior and
degraded-BFF map to failure-mode tests; reconciliation maps to contract tests.
The structure-mapping task (Task 7) must not move files until at least items
1–4 are green. See the audit §8 for the authoritative prerequisite list.

---

## 8. Deferred Tech Decisions

The following are intentionally **not decided** by this document. Each is
deferred with the trigger that would bring it back into scope.

- **CSS framework migration (Tailwind v4).** Deferred until `DESIGN.md` tokens
  stabilize and a concrete need (theming, utility-class ergonomics) appears.
  The current CSS custom-property layer (Decision 2) migrates cleanly to
  Tailwind v4's CSS-variable foundation when the trigger fires; no preemptive
  migration is warranted.

- **PWA / offline behavior.** Out of scope for v0.1. The transitional workbench
  assumes an online operator with a live BFF. Revisit only if a control-room
  offline mode becomes a product requirement, at which point a service-worker
  strategy and BFF-cache contract would be needed.

- **Animation library for degraded banners / transitions.** No animation
  library is adopted. Degraded-state banners and command confirmations use CSS
  transitions only. Revisit if transitions become complex enough that hand-rolled
  CSS is harder to maintain than a focused motion utility (e.g., Svelte's
  built-in transitions suffice for most cases).

- **Server-side rendering strategy for the control-room.** Currently
  `@sveltejs/adapter-static` with SPA fallback (`svelte.config.js`). The
  control-room is operator-facing and session-bound, so SSR offers little value
  in v0.1. Revisit if SEO/public-facing surfaces are added, or if a future
  workbench ADR requires server-rendered shell chrome for first-paint
  performance.

- **Whether to introduce a lightweight state machine library for command
  lifecycle.** The command surface (eligibility → confirmation → execution →
  result → refresh) is currently modeled with runes flags in `stores.svelte.ts`.
  A dedicated state machine (e.g., XState, or a hand-rolled finite state
  machine) is deferred. Revisit if the command lifecycle gains non-trivial
  states (e.g., async approval polling, multi-step param collection) that runes
  flags cannot express safely. Any adoption would be scoped to the command
  module's `state.ts`, not a global pattern (per Decision 3).

---

## Cross-References

- Concept selection: [`M-UI-DESIGN-EXPLORATION-DECISION.md`](./M-UI-DESIGN-EXPLORATION-DECISION.md) (Task 9 implications)
- Structure mapping: [`M-UI-STRUCTURE-MAPPING.md`](./M-UI-STRUCTURE-MAPPING.md) (Task 7 — `layout / modules / ui` split, migration waves)
- Bits UI evaluation: [`M-UI-BITS-UI-EVALUATION.md`](./M-UI-BITS-UI-EVALUATION.md) (Task 8 — candidate primitives, boundary compliance, adoption sequencing)
- Structure & test gap audit: [`M-UI-STRUCTURE-AND-TEST-GAP-AUDIT.md`](./M-UI-STRUCTURE-AND-TEST-GAP-AUDIT.md) (§7 test gaps, §8 test-foundation prerequisites, D1–D10 drift)
- Design system / tokens: [`DESIGN.md`](./DESIGN.md) §4–§6, §8
- Workbench brief & ownership rules: [`M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md`](./M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md)
- SDUI contract: [`SDUI-SCHEMA.md`](./SDUI-SCHEMA.md)
- Testing gates: [`docs/testing/TESTING.md`](../testing/TESTING.md)
