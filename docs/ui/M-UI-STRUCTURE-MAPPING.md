# M-UI Structure Mapping

> Wave 4 Task 7 of the M-UI Transitional Workbench Design Activation Plan.
>
> This document records the first landed file-level `layout / modules / ui`
> split for `apps/m-ui/src/lib/components/` and tracks the remaining gates before
> any deeper route/module extraction. It follows the **Focus-Flow Ledger** concept
> selected in [`M-UI-DESIGN-EXPLORATION-DECISION.md`](./M-UI-DESIGN-EXPLORATION-DECISION.md).

---

## 1. Landed State

The first M-UI structural step has landed as a **file-level component split**.
The previous flat component directory is gone: `apps/m-ui/src/lib/components/`
now contains only subdirectories, and route/page behavior is unchanged.

```text
apps/m-ui/src/lib/components/
├── layout/
├── modules/
│   ├── audit/
│   ├── command/
│   ├── control-room/
│   ├── network/
│   ├── nodes/
│   └── policy/
└── ui/
```

This step intentionally does **not** introduce final domain module entry
components, a runtime renderer, service/plugin-supplied UI, or a new page layout
model. It is a safe import-path and file-ownership split that prepares later M-UI
work without changing the Transitional Workbench product shape.

### 1.1 `layout/` — shell chrome

| Component | Current landed responsibility |
|---|---|
| `NavRail.svelte` | Left navigation rail consuming the SDUI route registry. |
| `RouteHeader.svelte` | Per-route header with title, permissions, and state-source attribution. |
| `FilterBar.svelte` | Reusable route-level filter chrome currently shared by list/timeline routes. |

### 1.2 `ui/` — domain-agnostic primitives

| Component | Current landed responsibility |
|---|---|
| `InlineOperationalAlert.svelte` | Reusable operational/degraded-state alert primitive. |
| `KeyValueInspector.svelte` | Key-value inspector for detail surfaces. |
| `RawEnvelopeView.svelte` | Raw envelope/source view for traceability-heavy surfaces. |
| `StateSourceBadge.svelte` | State-source attribution badge used by headers and panels. |
| `TokenInput.svelte` | JWT/Authorization-header input and bearer normalization primitive. |

### 1.3 `modules/` — current domain component grouping

The first split groups existing components by domain ownership. It does not yet
extract full per-route module entry components from `+page.svelte` files.

| Directory | Components |
|---|---|
| `modules/audit/` | `AuditLedger.svelte`, `TimelineStream.svelte`, `TraceLink.svelte` |
| `modules/command/` | `CommandWell.svelte` |
| `modules/control-room/` | `NodeMap.svelte`, `ServiceRegistryTable.svelte` |
| `modules/network/` | `DataplaneStatusPanel.svelte`, `GlobalProfileControls.svelte`, `JoinTicketPanel.svelte`, `NetworkDetailPanel.svelte`, `NetworkListPanel.svelte`, `NetworkProfileDetailPanel.svelte`, `NetworkProfileListPanel.svelte` |
| `modules/nodes/` | `NodeCredentialPanel.svelte` |
| `modules/policy/` | `ApprovalDetailPanel.svelte`, `ApprovalQueuePanel.svelte`, `DecisionQueueSummary.svelte`, `OperationalCommandPreview.svelte`, `PolicyDecisionPanel.svelte` |

---

## 2. Guardrails Preserved by the Split

The landed split preserves the ownership principles from
[`M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md`](./M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md):

- M-UI owns route surfaces, Svelte components, layout decisions, and interaction
  structure.
- M-* services own facts and capabilities; they do not provide frontend pages or
  components.
- M-UI BFF adapts facts into UI-facing data; it does not own UI structure.
- SDUI remains a route/component contract registry, not a runtime page renderer.
- M-Extension and plugin UI contribution remain deferred architecture.
- Frontend modularity happens inside M-UI under `layout / modules / ui`.

---

## 3. Remaining Gates Before Deeper Restructuring

The file-level split is complete, but deeper structure work is still gated.

### 3.1 Route/module extraction complete for priority routes

The four priority route `+page.svelte` files have been refactored into thin glue
code, delegating entirely to route-domain entry modules (Workspaces):

- `modules/control-room/ControlRoomWorkspace.svelte`
- `modules/policy/ApprovalDetailWorkspace.svelte`
- `modules/network/NetworkProfileWorkspace.svelte`
- `modules/network/BreakGlassWorkspace.svelte`

Each Workspace owns `<svelte:head>` / `<title>`, inline command/approval logic,
and every DOM landmark previously in its route file. The route files themselves
contain only workspace import and render — no inline logic, no inline markup.

**Parity preserved during extraction:**
- **Route URL**: Unchanged.
- **Route title**: Unchanged (`<title>` moved intact to Workspace).
- **Data flow**: Stores and component props wire identically.
- **Visible landmarks**: ARIA headings and primary content regions are present.
- **Command/degraded landmarks**: CommandWell, disabled reasons, and operational alerts are present where applicable.
- **BFF-only boundary**: All data fetching remains routed via the BFF.
- **Direct seam tests**: Each Workspace has a focused component test (`*-workspace.vitest.ts`) covering initial mount, landmarks, and regression parity.
- **Existing runtime suite**: `priority-routes.runtime.vitest.ts` still passes without changes, confirming DOM hierarchy was preserved.

### 3.2 Drift reconciliation status

The first split uncovered several SDUI/render drift items. Their current status:

**Resolved (Tasks 2, 3, 4):**

- **TraceLink fabricated route drift** — resolved. `TraceLink.svelte` no longer
  contains navigable `href` values to undefined routes. Correlation evidence is
  exposed via non-navigating `span` and `title` affordances.
- **Orphan SDUI kinds without backing component files** — resolved.
  `NodeListPanel`, `NodeDetailPanel`, `ServiceListPanel`, and `TimelinePanel`
  have been permanently excluded from the SDUI v0.2 component kind schema, the
  route registry, and contract-level forbidden-kind lists. Three-layer
  enforcement (schema literal, source drift test, contract test) prevents
  re-entry.
- **Swallowed degraded/fail-closed failures** — resolved. Previously silent
  `catch {}` paths in routes and stores now surface BFF errors via
  `formatBffError` and render visible `<InlineOperationalAlert>` content within
  `CommandWell`, `DataplaneStatusPanel`, and related surfaces. Fail-closed
  behavior is text-visible, not color-only.

**Deferred or blocked:**

- **Inline command convergence for `policy/approvals` and `network/profiles`**
  — blocked by DFW-030 overlap gate. The inline CommandWell surfaces implement
  side-by-side multi-button flows, distinct risk colors, disabled-as-button
  rendering, and custom confirmation details that the shared `CommandWell.svelte`
  does not support. Non-overlapping convergence is not feasible without either
  stripping UX semantics or introducing new abstractions. These surfaces remain
  inline to preserve DFW-030 mutation semantics.
- **`GlobalProfileControls` and `JoinTicketPanel` classification** — deferred.
  Whether these components qualify as registry-backed route components or
  internal M-UI module utilities remains a future-facing classification question
  that does not block the current split or Workspace extraction.

### 3.3 Final primitive layer remains deferred

Bits UI, Tailwind, charting, advanced motion, and project-level `DESIGN.md`
decisions remain conditional future tracks. The current split does not introduce
those dependencies.

---

## 4. Test Foundation Now Protecting This Split

The split and subsequent extraction are protected by a growing M-UI test foundation.

Runner ownership is now explicit:

- root `bun test` owns Bun-compatible `*.test.ts` source-contract suites
- `bun --cwd apps/m-ui run test` owns the Vitest / `happy-dom` M-UI runtime and component suites (`*.vitest.ts`)
- `bun run test:ui-contract` owns repo-root UI-boundary enforcement in `tests/ui-contract/`

**Source contract tests:**

- `src/routes/priority-routes.contract.test.ts` protects high-risk route source
  contracts for `control-room`, `policy/approvals`, `network/profiles`, and
  `mnet/break-glass`.
- `src/lib/components/modules/command/commandwell.contract.test.ts` protects
  CommandWell branching, semantic tokens, and test ids.
- `src/lib/components/modules/network/global-profile-controls.contract.test.ts`
  protects degraded-BFF/fail-closed visibility source contracts.
- `src/lib/components/ui/inline-operational-alert.contract.test.ts` protects
  alert severity token mapping and accessibility attributes.
- `src/lib/bff.vitest.ts` protects configurable BFF URL behavior (default and
  override paths via `VITE_MERISTEM_MUI_BFF_URL`).

**Runtime characterization tests:**

- `tests/runtime/priority-routes.runtime.vitest.ts` acts as the characterization
  suite ensuring Workspace extraction parity for layout, command states, and
  landmarks.
- `tests/runtime/commandwell.behavior.vitest.ts`,
  `tests/runtime/degraded-bff.behavior.vitest.ts`,
  `tests/runtime/dataplane-degraded.behavior.vitest.ts`,
  `tests/runtime/fail-closed-command.behavior.vitest.ts`, and
  `tests/runtime/token-presence.behavior.vitest.ts` cover fail-closed command
  visibility, degraded state, and token behavior.

**Workspace seam tests (Task 8):**

- `src/lib/components/modules/control-room/control-room-workspace.vitest.ts`
- `src/lib/components/modules/policy/approval-detail-workspace.vitest.ts`
- `src/lib/components/modules/network/network-profile-workspace.vitest.ts`
- `src/lib/components/modules/network/break-glass-workspace.vitest.ts`

Each seam test covers initial mount, landmark presence, and regression parity
for its extracted Workspace component.

**UI contract boundary test:**

- `tests/ui-contract/m-ui-bff-boundary.test.ts` enforces that UI logic only
  talks to the BFF.

---

## 5. Verification Commands

After any follow-up change to this split, run:

```bash
# Source contract tests
bun --cwd apps/m-ui run test -- priority-routes.contract.test.ts commandwell.contract.test.ts inline-operational-alert.contract.test.ts global-profile-controls.contract.test.ts bff.vitest.ts
# Workspace seam tests
bun --cwd apps/m-ui run test -- control-room-workspace.vitest.ts approval-detail-workspace.vitest.ts network-profile-workspace.vitest.ts break-glass-workspace.vitest.ts
# Runtime characterization suite
bun --cwd apps/m-ui run test -- tests/runtime/priority-routes.runtime.vitest.ts tests/runtime/commandwell.behavior.vitest.ts tests/runtime/degraded-bff.behavior.vitest.ts tests/runtime/dataplane-degraded.behavior.vitest.ts tests/runtime/fail-closed-command.behavior.vitest.ts tests/runtime/token-presence.behavior.vitest.ts
# UI contract boundary
bun run test:ui-contract
bun run typecheck:m-ui
bun run lint
bun run typecheck
bun run test:agent-submit
```

---

## 6. Deferred Decisions

These decisions are still intentionally left to later M-UI implementation work:

- Whether the `network/` profile routes remain in `modules/network/` or later
  split into a dedicated profile/M-Net submodule.
- Whether detail surfaces stay route-based or become inline expansions.
- When to evaluate Bits UI inside `ui/` primitives.
- Whether to introduce a sticky CommandWell footer wrapper.
- Whether `+layout.svelte` keeps its current grid or delegates to a
  `layout/Shell.svelte` wrapper.

Do not treat those deferred choices as blockers for the current file-level split.
