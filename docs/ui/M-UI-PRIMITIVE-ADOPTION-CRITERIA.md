# M-UI Primitive Adoption Criteria

> Wave 3, Task 8 of the M-UI Transitional Workbench Design Activation Plan.
>
> This document defines the governance framework for deciding whether a future
> Bits UI primitive should be adopted into the M-UI `ui/` layer, and it records
> the current plan-stage approval baseline. It is a companion to
> [`M-UI-BITS-UI-EVALUATION.md`](./M-UI-BITS-UI-EVALUATION.md), which assesses
> candidate primitives against M-UI needs. This document answers the separate
> question: "when we consider adopting one of those candidates, what gates must it pass?"

---

## 1. Current Baseline: Single Approved Pilot

**Only one Bits UI primitive is approved for production use in the current plan
stage:** the `AlertDialog` component, wrapped as `ConfirmActionDialog` inside
`apps/m-ui/src/lib/components/ui/ConfirmActionDialog.svelte`.

This approval was granted in Wave 1 through Waves 3:

- **Wave 1, Task 4** pinned `bits-ui@2.18.1` as an exact dev dependency of
  `apps/m-ui` only. The root workspace and all other packages do not declare
  `bits-ui`.
- **Wave 2, Task 5** created `ConfirmActionDialog.svelte` as a reversible,
  token-styled wrapper whose only Bits UI import is `AlertDialog`. No other
  `bits-ui` import path exists in `apps/m-ui/src/`.
- **Wave 3, Task 8** (this document) codifies the adoption criteria that any
  second primitive must satisfy before it can be considered.

Everything that follows defines the gates for future proposals. It does not
expand the current approval beyond `AlertDialog` / `ConfirmActionDialog`.

---

## 2. Why Governance Now

Bits UI is a headless, unstyled Svelte component library. It ships behavior and
accessibility, not visual language, so it composes cleanly with M-UI's existing
token-driven CSS custom-property system. That makes it attractive for
primitive-shaped needs like confirmation dialogs, loading skeletons, and command
search surfaces.

The evaluation in `M-UI-BITS-UI-EVALUATION.md` identified several high-value
candidates beyond Dialog: Skeleton, Command/Combobox, Table, Accordion, and
Button. Each of these could accelerate workbench development, but each also
carries risks: bundle growth, contributor learning curve, Svelte 5 runes
compatibility drift, and most importantly, the temptation to adopt primitives
before a concrete route or module has a demonstrable need for them.

This document exists to make those decisions deliberate, reversible, and
auditable. It prevents Bits UI from spreading into the codebase by default just
because it is available.

---

## 3. The Adoption Checklist

Every proposal to adopt a Bits UI primitive beyond `AlertDialog` must satisfy
all of the following gates. A proposal that fails any one gate is rejected until
the gate is addressed.

### Gate 1: Concrete Route or Module Use Case

The proposal must name a specific route surface, module, or operator workflow
inside the M-UI Transitional Workbench that demonstrably needs the primitive.
Abstract claims ("this would be useful for future tables") are not sufficient.

**Test:** if you cannot point to a Svelte file under `apps/m-ui/src/lib/modules/`
or `apps/m-ui/src/routes/` whose current lack of this primitive causes a
verifiable operator-experience gap, the proposal is deferred.

**Why this gate exists:** M-UI is a transitional workbench with a finite set of
operator surfaces, not a general-purpose application framework. Primitives
adopted without a concrete use case create maintenance burden with no operator
benefit. The evaluation doc identified several medium-category candidates
(Table, Accordion, Button) that are only justified if specific module complexity
grows. Until that growth is demonstrated, they stay deferred.

### Gate 2: Accessibility and Keyboard Behaviour

The wrapped primitive must pass the following checks:

- **Focus trap:** dialogs, modals, and overlay surfaces must trap focus when
  open and restore it on close.
- **Keyboard navigation:** all interactive elements must be reachable and
  operable via keyboard alone (Tab, Shift+Tab, Enter, Escape, arrow keys where
  applicable).
- **Screen-reader semantics:** the wrapper must render appropriate ARIA roles,
  labels, and live-region announcements. Bits UI primitives typically provide
  these out of the box, but the wrapper must not strip them.
- **Reduced-motion preference:** the wrapper must respect
  `prefers-reduced-motion` for any animated transitions. The Bits UI primitive
  may provide this; the wrapper must not override it with hardcoded animation.

Proof requirement: a focused component test (see Gate 7) that mounts the wrapper
and asserts at least keyboard operability and focus management.

### Gate 3: Token-Only Styling, No Tailwind

The wrapper must use only M-UI design-system tokens (CSS custom properties
defined in `DESIGN.md` and the `:root` token block) for all visual properties:
colours, spacing, typography, borders, shadows, and radii. Hardcoded pixel
values are permitted only for layout mechanics that tokens do not yet express
(e.g., `position: fixed`, `inset: 0`, `z-index`).

**Tailwind is prohibited** in primitive wrappers. This includes Tailwind utility
classes generated by `@tailwindcss/vite` and any `className` prop passthrough
that permits callers to inject Tailwind classes into the primitive.

**Why this gate exists:** M-UI's visual contract is defined by its token system,
not by a utility-class framework. Allowing Tailwind inside primitive wrappers
would fork the styling surface and make it impossible to reason about how a
component looks by reading `DESIGN.md` alone.

### Gate 4: Ownership Boundary Preservation

The wrapper must not violate any of the ownership boundaries defined in
`M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md` §4:

- **M-UI owns UI structure.** The wrapper lives inside
  `apps/m-ui/src/lib/components/ui/` and is consumed by M-UI modules. It does not expose
  Bits UI internals to BFF contracts, SDUI schemas, or service code.
- **Services do not supply UI.** No M-* service, M-Extension, or plugin may
  import, reference, or depend on a Bits UI primitive. The `bits-ui` dependency
  is confined to `apps/m-ui/package.json`.
- **BFF does not own component structure.** The BFF may return
  display-adjudicated data (e.g., command eligibility flags, disabled reasons,
  impact summaries), but it must not return Bits UI prop shapes, component
  names, or primitive-specific configuration.
- **SDUI is a contract registry, not a runtime renderer.** A Bits UI-backed
  wrapper is an internal M-UI implementation detail. It does not introduce new
  SDUI component kinds, does not appear in the SDUI allowlist, and does not
  imply that SDUI can dynamically instantiate Bits UI primitives at runtime.

Proof requirement: a contract test or import-boundary check that asserts no
`bits-ui` import exists outside `apps/m-ui/src/lib/components/ui/`.

### Gate 5: Wrapper API Stability

The wrapper must expose a stable, domain-appropriate Svelte component API.
Specifically:

- The wrapper's props must use M-UI domain vocabulary, not Bits UI raw prop
  names. For example, a future `CommandSearch.svelte` wrapper would accept
  `commands`, `onSelect`, and `disabledReason`, not Bits UI `Command.Input` /
  `Command.Item` prop passthroughs.
- The wrapper must enforce workbench rules in its own logic: disabled reasons
  must be visible in Chinese, destructive actions must never be icon-only,
  impact summaries must be rendered, and fail-closed semantics must be preserved.
  These rules are defined in the transitional workbench brief (§4) and
  `M-UI-BITS-UI-EVALUATION.md` §5 ("Boundary Compliance Checklist").
- Callers (modules and route pages) must interact with the wrapper through its
  M-UI domain API only. Direct access to the underlying Bits UI primitive
  (e.g., importing `AlertDialog.Root` in a module file) is prohibited.

**Why this gate exists:** the wrapper is the adoption unit. If modules import
Bits UI primitives directly, the adoption is not governed, not reversible, and
not auditable. The wrapper is also where workbench rules (Chinese text,
disabled-reason visibility, impact summaries) are enforced; a bypassed wrapper
skips these rules.

### Gate 6: No Second Primitive Without a New Use Case

Introducing a Bits UI primitive must not be treated as a "library upgrade" or
"batch adoption" step. Each primitive is approved individually.

**Rule:** the proposal for a second (third, fourth) primitive must carry its own
route/module use case (Gate 1), its own accessibility evidence (Gate 2), its own
wrapper with token-only styling (Gate 3), its own boundary check (Gate 4), and
its own test coverage (Gate 7). Batch proposals that argue "we already have Bits
UI, so we should also use Table, Tabs, and Accordion" are rejected.

**Why this gate exists:** the evaluation doc's adoption order (Dialog, then
Skeleton, then Command/Combobox, then Table, then Accordion) is a prioritised
candidate list, not a roadmap. Each step must earn its own justification. The
`ConfirmActionDialog` pilot succeeded because it met a specific, narrow need
(destructive-command confirmation) with a single, well-understood primitive
(AlertDialog). Future primitives must meet the same bar.

### Gate 7: Tests Before Production Use

Every Bits UI wrapper must have a focused component test that covers at minimum:

- **Happy path:** mounting with valid props renders the expected structure.
- **Keyboard behaviour:** focus trap, Escape-to-close (for dialogs), Enter-to-activate.
- **Disabled state:** the wrapper renders the Chinese disabled reason and
  prevents interaction when disabled.
- **Workbench invariants:** the wrapper enforces the ownership-boundary and
  workbench rules declared in Gate 5.
- **Edge case:** missing required props, empty descriptions, or malformed data
  produce a fail-closed state (the component does not silently render an
  inoperable surface).

These tests must exist in a file under `apps/m-ui/src/lib/components/ui/`
following the `{ComponentName}.vitest.ts` naming convention (matching the
existing `confirm-action-dialog.vitest.ts`). They must pass before the wrapper
is consumed by any module.

**Why this gate exists:** the `M-UI-STRUCTURE-AND-TEST-GAP-AUDIT.md` §8
identified specific test gaps (route-render smoke, token-presence,
CommandWell behaviour, degraded-BFF scenarios) that must be closed before the
`layout / modules / ui` restructuring. Adding untested Bits UI wrappers during
that restructuring would multiply risk. The test foundation must exist first.

---

## 4. Deferred Primitives (Not Yet Approved)

The following Bits UI primitives were evaluated in
`M-UI-BITS-UI-EVALUATION.md` and are **deferred**. They are not approved for
production adoption in the current plan stage. Adoption proposals for any of
these must pass all seven gates in §3.

| Primitive | Current Status | Notes |
|---|---|---|
| **Skeleton** | Deferred (high-value candidate) | Needed for degraded-BFF loading states. Gates blocked by: Gate 1 (no specific module surface yet consumes a degraded-BFF loading scenario), Gate 7 (degraded-BFF test scenarios not yet implemented per audit D10). |
| **Command / Combobox** | Deferred (high-value candidate) | Needed for CommandWell eligibility search. Gates blocked by: Gate 1 (CommandWell search UI does not exist yet; the current CommandWell is a single-command surface), Gate 5 (wrapper API not designed). |
| **Table** | Deferred (medium-value candidate) | Candidate for AuditLedger / ServiceRegistryTable when sorting and pagination are needed. Gates blocked by: Gate 1 (current ledgers are read-only with no sorting/pagination requirement), Gate 6 (no new use case beyond current bespoke tables). |
| **Button** | Deferred (medium-value candidate) | Candidate for standardising CommandWell action buttons. Gates blocked by: Gate 1 (current buttons are 30-line token-driven components that already satisfy the workbench contract), Gate 6 (adopting Button because "Bits UI is already present" violates the no-second-primitive-without-use-case rule). |
| **Accordion** | Deferred (medium-value candidate) | Candidate for collapsible KeyValueInspector sections. Gates blocked by: Gate 1 (KeyValueInspector is a 34-line flat key/value list; no collapsible-section requirement exists yet). |
| **Tabs** | Deferred (low-value candidate) | Only needed if the inspector becomes multi-tab. Explicitly deferred in the evaluation doc. Gates blocked by: Gate 1 (no multi-tab surface exists; `DESIGN.md` §2 keeps the inspector inline). |
| **Alert** | Not recommended | Current `InlineOperationalAlert` (42 lines, `role="alert"`, full-width, non-dismissible) already satisfies the workbench rule. Bits UI Alert adds dismissible semantics that the brief forbids for contract-relevant feedback. |
| **Separator** | Not recommended | Trivial. CSS `border` and the `--line-soft` token already serve this. |
| **Select** | Not evaluated | No current M-UI surface requires a select/option affordance. Must pass all seven gates if proposed. |
| **Menu** (Dropdown / Context) | Not evaluated | The transitional workbench brief forbids unscoped dropdown action menus. Any menu primitive must justify how it serves a scoped operator workflow without violating this rule, in addition to passing all seven gates. |

---

## 5. What "Adoption" Does Not Mean

Adopting a Bits UI primitive into the `ui/` layer does not:

- **Approve broad Bits UI migration.** The evaluation doc recommended a
  "small, targeted subset", not wholesale replacement of existing components.
  Domain-specific components (NodeMap, TimelineStream, AuditLedger,
  StateSourceBadge, RawEnvelopeView, TraceLink, and all other surfaces listed in
  `M-UI-BITS-UI-EVALUATION.md` §4) stay custom regardless of how many primitives
  are adopted.
- **Make Bits UI the default choice for new components.** Every new UI surface
  must still justify whether a headless primitive adds value over a hand-written
  token-driven Svelte component. The default remains hand-written, token-styled
  Svelte.
- **Introduce new dependencies beyond `apps/m-ui`.** The `bits-ui` dependency
  is confined to `apps/m-ui/package.json` (pinned at `2.18.1` by Task 4). It
  does not appear in the root workspace, any service package, or any contract
  package.
- **Change the SDUI contract.** SDUI component kinds are not extended to
  include Bits UI primitives. The SDUI allowlist is not modified by this
  governance framework.
- **Relax the service/plugin UI boundary.** M-* services, M-Extension, and
  plugins remain prohibited from importing or depending on Bits UI. The
  `bits-ui` import-boundary check (see Gate 4) enforces this.
- **Unblock visual redesign.** The transitional workbench brief specifies that
  Bits UI adoption follows the `layout / modules / ui` split and the test
  foundation, not the other way around. Primitive adoption is implementation
  plumbing, not design direction.

---

## 6. Governance Lifecycle

This document is not frozen. It can be amended when:

- A new route or module surface creates a concrete, verified need for a Bits UI
  primitive that is currently deferred (Gate 1).
- A deferred primitive's blocker is resolved (e.g., the degraded-BFF test
  scenarios are implemented, unblocking Skeleton).
- The `layout / modules / ui` restructuring is complete and the test foundation
  prerequisites from `M-UI-STRUCTURE-AND-TEST-GAP-AUDIT.md` §8 are green.
- A new version of Bits UI introduces a primitive that addresses a specific M-UI
  gap not covered by the current evaluation.

Amendments must:

- State the new approval explicitly (which primitive, which wrapper file, which
  consuming module/route).
- Confirm all seven gates in §3 are satisfied.
- Update the deferred-primitives table in §4.
- Not expand the approval baseline beyond what is justified by the amendment.

---

## Cross-References

- Bits UI candidate evaluation: [`M-UI-BITS-UI-EVALUATION.md`](./M-UI-BITS-UI-EVALUATION.md)
- Workbench brief and ownership rules: [`M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md`](./M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md)
- Design-system tokens (root canonical): [`DESIGN.md`](../../DESIGN.md)
- SDUI contract: [`SDUI-SCHEMA.md`](./SDUI-SCHEMA.md)
- Structure/test gap audit: [`M-UI-STRUCTURE-AND-TEST-GAP-AUDIT.md`](./M-UI-STRUCTURE-AND-TEST-GAP-AUDIT.md)
- Structure mapping: [`M-UI-STRUCTURE-MAPPING.md`](./M-UI-STRUCTURE-MAPPING.md)
- Frontend tech decisions: [`M-UI-FRONTEND-TECH-DECISIONS.md`](./M-UI-FRONTEND-TECH-DECISIONS.md)
- Approved Bits UI wrapper: `apps/m-ui/src/lib/components/ui/ConfirmActionDialog.svelte`
