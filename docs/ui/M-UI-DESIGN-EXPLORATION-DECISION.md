# M-UI Design Exploration Decision

> Wave 2 Task 4 of the M-UI Transitional Workbench design activation plan.  
> This document records the convergence decision after comparing the two concepts in [`M-UI-STITCH-CONCEPTS.md`](./M-UI-STITCH-CONCEPTS.md).

## Executive summary

**Selected concept: Concept 2 — Focus-Flow Ledger.**

The Focus-Flow Ledger is chosen as the convergent direction for the M-UI Transitional Workbench because it minimizes the structural gap from the current flat `apps/m-ui/src/lib/components/` implementation to the future `layout / modules / ui` split, respects all M-UI/service ownership boundaries, and is the easiest to test before further restructuring.

## Selection criteria

The following criteria were used to compare the two concepts. The order reflects the priorities stated in [`M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md`](./M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md):

1. **Workflow fit** — covers all six core workflows (orient, inspect, evaluate eligibility, execute, trace, handle degraded).
2. **Information hierarchy** — clear, scannable structure that works across the eight information domains.
3. **Multi-domain extensibility** — can serve platform, security/policy, network, and read-only auditor contexts without becoming a one-off per domain.
4. **Boundary correctness** — M-UI owns UI structure; services own facts; BFF adapts; SDUI is registry not renderer; no plugin UI; no service-provided components.
5. **Traceability** — surfaces state sources and action lineage before and after commands.
6. **Failure / degraded visibility** — fail-closed and degraded states are hard to miss.
7. **Implementation path to SvelteKit** — maps cleanly to a future `layout / modules / ui` split.
8. **Testability** — can satisfy the test-foundation prerequisites from [`M-UI-STRUCTURE-AND-TEST-GAP-AUDIT.md`](./M-UI-STRUCTURE-AND-TEST-GAP-AUDIT.md).
9. **Visual quality** — considered only after the above.

## Concept comparison

| Criterion | Concept 1: Spatial Three-Zone Console | Concept 2: Focus-Flow Ledger |
|---|---|---|
| Workflow fit | Excellent for platform/network topology workflows; strong orient/inspect/execute | Excellent for trace/degraded/eligibility; strong across all six workflows |
| Information hierarchy | Spatial: left nav, center stage, right inspector/command | Vertical: header → alert → filter → content stream → sticky command footer |
| Multi-domain extensibility | Requires every domain to fit center-stage + inspector model; awkward for list/ledger domains | Any domain can render as a vertical stack; uniform across nodes, policy, audit, timeline, mnet |
| Boundary correctness | High | High |
| Traceability | Good (TraceLink/RawEnvelopeView in right panel) | Excellent (ledger-native, state-source stream is the primary surface) |
| Failure / degraded visibility | Good (InlineOperationalAlert in primary zone) | Excellent (full-width banner below header) |
| Implementation path to SvelteKit | Medium risk: new three-zone grid shell, persistent right column, center↔inspector coordination | Low risk: header + nav + primary + sticky footer map directly to current `+layout.svelte` and per-page vertical stacks |
| Testability | Medium (spatial grid, responsive sidebars, cross-panel selection state) | High (linear stacks, single shared footer, simple route-render smoke tests) |
| Visual quality | Dense SCADA-like control surface | Clean document/ledger surface |

## Decision rationale

**Concept 2 is selected.**

The deciding factors are structural, not aesthetic:

- **Smallest gap from current implementation.** Current M-UI pages are already inline vertical stacks inside a header + nav-rail + primary shell. Concept 2 formalizes exactly this pattern: the shell gains a sticky CommandWell footer and a full-width degraded-state banner, while each route remains a vertical stack of domain modules. Moving from today's flat `lib/components/` to `layout/modules/ui` is therefore a reorganization of existing patterns, not a layout-model change.

- **Lowest implementation risk.** Standard CSS vertical stacking is natively responsive and avoids the responsive-sidebar tuning required by a persistent right inspector column.

- **Best testability.** The test-foundation prerequisites from the audit—route-render smoke tests, token-presence checks, CommandWell behavior tests, and degraded-BFF scenarios—are all simpler with a linear, per-route stack model than with a three-zone spatial model that introduces shared selection/inspector state.

- **Strongest traceability and degraded visibility.** The audit identified traceability as a high-severity drift (D2: seven routes declare `TraceLink` but do not render it). A ledger model makes traceability a first-class, primary-surface concern rather than a side panel, directly supporting the brief's goal to strengthen traceability before and after actions.

- **Uniform multi-domain fit.** All eight information domains (nodes, networks, policy, approvals, audit, timeline, services, mnet) can be expressed as vertical workspace modules. No domain is forced into a center-stage/inspector model that fits some but not all contexts.

- **Ownership preserved.** Both concepts respect the boundary rules; Concept 2 makes them easier to enforce in code because each domain module owns its complete vertical content and only the shell provides shared navigation and command footer chrome.

## Rejected concept

**Concept 1 — Spatial Three-Zone Console** was rejected as the convergent base for the transitional workbench.

It is a valid concept for topology-heavy operator contexts and may become the right model for a dedicated network-operations view in the future. However, as the base for the entire transitional workbench it introduces a larger structural delta and forces list/ledger domains (audit, timeline, approvals) into a center-stage + persistent-inspector layout that is less natural for them.

**Conditions under which Concept 1 could be reconsidered:**
- A future scoped redesign targets a dedicated platform/network operations workspace.
- The SDUI contract gains explicit layout-region semantics that are consumed by the renderer (currently the registry is consumed for navigation labels only).
- The test foundation is mature enough to cover cross-route persistent inspector state.

## Implications for subsequent tasks

### Task 5 — Root `DESIGN.md`
The root `DESIGN.md` should describe a **ledger-oriented workbench system** rather than a multi-pane control surface:
- Tokens for vertical rhythm, typography, and full-width banners take precedence over dense grid/spacing tokens.
- The primitive layer centers on stream/list/detail panels (AuditLedger, TimelineStream, DecisionQueueSummary, KeyValueInspector) and command affordances (CommandWellPanel).
- The design language emphasizes state-source attribution, lineage, and conservative action.

### Task 6 — Figma context validation
Figma MCP is unavailable. Validation is deferred to a later phase when:
- A Figma file exists for the workbench.
- The Figma MCP server (`https://mcp.figma.com/mcp`) is registered in OpenCode with a `FIGMA_OAUTH_TOKEN`.
- Only read-only tools are used for validation.

For this plan, Task 6 will document the missing Figma context and the exact activation steps, rather than performing live validation.

### Task 7 — Structure mapping to `layout / modules / ui`
Concept 2 maps cleanly:
- `layout/` — NavRail, RouteHeader, StateSourceBadge (shell), InlineOperationalAlert banner, sticky CommandWell footer.
- `modules/` — per-domain vertical workspace modules: `control-room/`, `nodes/`, `networks/`, `policy/`, `mnet/`, `audit/`, `timeline/`, `services/`.
- `ui/` — reusable primitives: KeyValueInspector, TraceLink, RawEnvelopeView, FilterBar, AuditLedger, TimelineStream, DecisionQueueSummary, NetworkProfileListPanel, etc.

The current flat `lib/components/` components are redistributed along these lines; no new layout model is introduced.

### Task 8 — Bits UI evaluation
Because Concept 2 is a vertical-stack/ledger model, Bits UI primitives should be evaluated for:
- Lists, tables, accordion, and disclosure primitives (content streams).
- Button, command-menu, and dialog primitives (command footer and detail panels).
- Alert, badge, and skeleton primitives (degraded states).
- Resizable/splitter is lower priority than in Concept 1.

### Task 9 — Frontend tech decisions
The selected concept does not require new layout abstractions. Decisions should focus on:
- Svelte 5 runes patterns for the shell and per-module stores.
- How the sticky CommandWell footer communicates command state and eligibility without crossing into service-owned facts.
- Whether to introduce a lightweight module barrel pattern under `lib/modules/`.
- CSS approach for vertical rhythm and full-width banners.

### Task 10 — Docs/contracts sync
The sync should update `docs/ui/SDUI-SCHEMA.md` to:
- Remove the legacy `MUiRouteSchema` (regions/layout/version) drift identified in D1.
- Document `SduiV02Route` as the canonical shape.
- Clarify that the SDUI registry drives navigation and component-kind contracts, not runtime page layout.
- Add `GlobalProfileControls` and `JoinTicketPanel` to the component-kind allowlist if they are intended to be SDUI-contributable, or document them as internal-only M-UI primitives.

## Deferred decisions

The following details are intentionally left open for implementers after design convergence:

- Exact pixel values for spacing, typography scale, and color tokens.
- Whether the sticky CommandWell footer is always visible or appears only when a command is eligible.
- Filter bar placement and behavior per module.
- Animation/transition details for degraded-state banners.
- Whether detail panels are inline expandable sections or separate routes.
- Final naming of module subdirectories.
- Whether to adopt Bits UI or another primitive layer.

These decisions are deferred because the plan must stay at outcome/stage/architecture level, per the brief.

## Risk note

This decision is based on written architectural analysis, not generated visual artifacts. Stitch generation, Claude Design, and Figma MCP are all unavailable in the current environment. The fallback path documented in [`M-UI-DESIGN-TOOL-AVAILABILITY.md`](./M-UI-DESIGN-TOOL-AVAILABILITY.md) was used. Visual refinement and stakeholder signoff should be performed once design tools are available or through a manual review process.
