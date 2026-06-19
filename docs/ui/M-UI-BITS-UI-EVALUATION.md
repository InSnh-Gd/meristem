# M-UI Bits UI Evaluation

> Wave 4 Task 8 of the M-UI Transitional Workbench Design Activation Plan.
>
> This is a **documentation-only evaluation**. It does not install, upgrade, or
> import any dependency, and it does not change M-UI code. It assesses whether
> [`bits-ui`](https://bits-ui.com/) can accelerate the Focus-Flow Ledger
> direction selected in [`M-UI-DESIGN-EXPLORATION-DECISION.md`](./M-UI-DESIGN-EXPLORATION-DECISION.md)
> without violating the M-UI ownership boundaries defined in
> [`M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md`](./M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md)
> and the M-UI contract skill.

---

## 1. Executive Summary

**Recommendation: adopt a small, targeted subset of Bits UI primitives — do not
wholesale replace existing components.**

The Focus-Flow Ledger is a vertical-stack, ledger-oriented workbench. Its
surfaces are dominated by domain-specific components (NodeMap, TimelineStream,
AuditLedger, TraceLink, RawEnvelopeView, StateSourceBadge) that no headless UI
library can help with. The generic, primitive-shaped needs are narrow: a
confirmation dialog for destructive commands, a loading skeleton for degraded
BFF states, a command/combobox for command-well eligibility search, and
optionally table semantics for the ledgers.

Bits UI is a **headless (unstyled) Svelte component library**. Because it ships
behavior and accessibility — not styles — it composes cleanly with the existing
token-driven CSS custom-property system documented in [`DESIGN.md`](./DESIGN.md)
§4–§6. It does not impose a visual language and therefore does not conflict with
the Control Room Ledger aesthetic.

The evaluation concludes:

- **High-value candidates:** Dialog (destructive-command confirmation), Skeleton
  (degraded/BFF loading), Command/Combobox (CommandWell eligibility search).
- **Medium-value candidates:** Table (AuditLedger, ServiceRegistryTable),
  Button (CommandWell actions), Accordion (collapsible KeyValueInspector).
- **Low-value candidates:** Alert, Separator, Tabs — the existing components or
  plain CSS already satisfy these needs with less surface area.
- **Out of scope:** every domain-specific component stays custom.

Adoption is recommended **after** the `layout / modules / ui` split (Wave 4
Task 7) and the test-foundation prerequisites (audit §8) are in place, and only
inside the `ui/` primitive layer. Bits UI shapes must never leak into BFF
contracts or SDUI schemas.

> **Premise correction.** The task brief assumed `bits-ui` was already present in
> `apps/m-ui/package.json`. It is **not** (see §2). This evaluation therefore
> treats adoption as a future decision rather than a migration of an existing
> dependency, and frames all recommendations accordingly. No dependency is
> installed or upgraded by this document.

---

## 2. Bits-ui Status

| Item | Value |
|---|---|
| Declared in `apps/m-ui/package.json` | **No** |
| Declared in root `package.json` | **No** |
| Present in `bun.lock` | **No** |
| Direct imports in `apps/m-ui/src/**` | **None** (repo-wide search for `bits-ui` returns no matches) |
| Current direct usage in M-UI | **None** |

`apps/m-ui/package.json` declares only: `@sveltejs/adapter-static`,
`@sveltejs/kit` (2.25.0), `@sveltejs/vite-plugin-svelte`, `svelte-check`,
`svelte` (**5.37.0**), and `vite`. There is no `test` script and no
component-testing dependency — consistent with audit §7.2.

**Implication.** Because bits-ui is not installed, there is nothing to migrate
and no existing usage to preserve. The cost of adoption is purely the
*introduction* cost: a new dev dependency, a version to pin, and a contributor
learning curve. The Svelte 5 runes compatibility of the chosen version must be
verified at adoption time against `svelte@5.37.0` (see §7). All current M-UI
components are already Svelte 5 runes-based (`$props`, `$derived`) and
token-driven, so there is no legacy slot/svelte-4 pattern to reconcile.

---

## 3. Candidate Primitives

The table maps Bits UI primitives to concrete M-UI needs, the current component
that owns that surface (if any), the fit, and adoption notes. "Fit" reflects how
much behavior Bits UI adds *that M-UI does not already have and does need*.

| Bits UI Primitive | M-UI Need | Current Component | Fit | Adoption Notes |
|---|---|---|---|---|
| **Accordion** | Inline detail panels / KeyValueInspector expansion | `KeyValueInspector.svelte` (flat, always-expanded) | Medium | Useful only if the inspector becomes collapsible per-section. Today it is a flat key/value list (34 lines). Defer until the `ui/` split introduces an expandable inspector variant. |
| **Alert** | `InlineOperationalAlert` degraded-state banner | `InlineOperationalAlert.svelte` (42 lines, `role="alert"`) | Low–Medium | Current component already satisfies the workbench rule: full-width, fail-closed, Chinese message, severity-colored. Bits UI Alert adds dismissible/rich semantics the brief **forbids** (no toasts/snackbars; degraded states must remain visible, not dismissible). Net gain is marginal. Keep custom. |
| **Button** | CommandWellPanel actions | `CommandWell.svelte` (`btn-command`/`btn-confirm`/`btn-cancel`) | Medium | Bits UI Button is headless/unstyled; current buttons are tiny and token-driven. Modest gain in consistency (focus/keyboard), small loss in directness. Acceptable to wrap inside `ui/Button.svelte` later, not urgent. |
| **Command / Combobox** | CommandWell search/eligibility | *(not yet present)* | **High** | Strongest candidate. The "CommandWell" name implies a command-palette/search surface that does not exist yet. A combobox over eligible commands (filtered by permission, node kind, reachability) directly supports the orient→evaluate→execute workflow. This is new capability, not replacement. |
| **Dialog** | Confirmations for destructive commands | `CommandWell.svelte` inline confirm flow (bespoke) | **High** | Destructive/high-risk commands require explicit confirmation with impact summary (brief: CommandWell Rules). A headless Dialog brings focus-trap, escape-to-cancel, backdrop, and scroll-lock for free — all currently hand-rolled or absent. This is the single highest-value adoption and directly strengthens the conservative-action contract. |
| **Separator** | Visual hierarchy in ledger | *(none; CSS borders)* | Low | Trivial. CSS `border` + the existing `--line-soft` token already serve this. Marginal value; skip. |
| **Skeleton** | Degraded / BFF loading states | *(none)* | **High** | Audit D10 + §7.4 identified degraded-BFF as a gap: `fetchDataplaneStatus`/`fetchGlobalDefaults` swallow errors silently. A standard Skeleton gives a visible loading affordance where today failures are invisible. Pairs with the future degraded-BFF test scenario. |
| **Table** | AuditLedger, ServiceRegistryTable | `AuditLedger.svelte`, `ServiceRegistryTable.svelte` | Medium–High | Bits UI Table provides sortable headers, row semantics, and keyboard navigation. Current tables are bespoke. Good candidate **if** table complexity grows (sorting, pagination). For the current read-only ledger view the gain is modest; revisit when ledger interactivity expands. |
| **Tabs** | Multi-section inspector (future) | *(none)* | Low (deferred) | Only needed if the inspector becomes multi-tab. `DESIGN.md` §2 keeps the inspector inline. Explicitly deferred; do not adopt preemptively. |

**Primitive-ish components** (generic shape, candidates to back onto Bits UI
inside a future `ui/` layer): `CommandWell`, `InlineOperationalAlert`,
`KeyValueInspector`, `FilterBar`, `AuditLedger`, `ServiceRegistryTable`,
`ApprovalQueuePanel`, `DecisionQueueSummary`, `NetworkListPanel`,
`NetworkProfileListPanel`, `TokenInput`, `NavRail`, `GlobalProfileControls`,
`RouteHeader`.

---

## 4. Non-Candidate Areas

These components are **domain-specific**. Bits UI has nothing to offer them and
they must stay custom, owned by M-UI. Adopting Bits UI must not be used as
justification to genericize these surfaces.

| Component | Why It Stays Custom |
|---|---|
| `NodeMap.svelte` | Domain-specific topology/list canvas. No headless primitive covers operator node visualization. |
| `TraceLink.svelte` | Domain-specific traceability affordance linking an event to its correlation ID. Tied to the trace-after-action workflow. |
| `StateSourceBadge.svelte` | Semantic, source-attribution badge (`authoritative`/`event`/`cache`/`read-model`/`log`/`audit`/`policy`). The brief makes state-source visibility a required workbench rule; the badge encodes domain semantics, not generic chip styling. |
| `RawEnvelopeView.svelte` | Monospace container for raw, untampered JSON/event envelopes. Domain-specific presentation contract. |
| `TimelineStream.svelte` | Chronological event/state-transition stream. Domain layout, not a generic list. |
| `NodeCredentialPanel.svelte` | Secure credential/identity inspection. Domain-specific with security presentation rules. |
| `NetworkDetailPanel.svelte`, `NetworkProfileDetailPanel.svelte`, `DataplaneStatusPanel.svelte`, `PolicyDecisionPanel.svelte`, `OperationalCommandPreview.svelte`, `ApprovalDetailPanel.svelte`, `JoinTicketPanel.svelte` | Domain detail/status/preview surfaces. Each encodes M-Net / M-Policy / M-Task domain semantics. |

**Rule of thumb:** if the component's reason for existing is a Meristem domain
concept (node, network, policy, audit, timeline, trace, state-source, envelope),
it stays custom. If its reason for existing is a generic UI affordance
(confirmation, loading, search, table-row, disclosure), it is a Bits UI
candidate.

---

## 5. Boundary Compliance Checklist

Adopting a headless UI library is a **primitive-layer** decision. The checklist
below confirms it does not violate any M-UI ownership boundary.

| Boundary Rule (from brief / contract skill) | Compliant? | Reasoning |
|---|---|---|
| M-UI owns route surfaces, Svelte components, layout, interaction structure | Yes | Bits UI primitives are consumed *inside* M-UI components. They do not introduce routes, layouts, or service-provided UI. |
| M-* services own facts, capabilities, events, policy, audit, domain state | Yes | Bits UI is a frontend dev dependency; it never touches service-owned facts. |
| M-UI BFF adapts facts into UI-facing data; must not own final facts/authorization/policy | Yes | Bits UI has no BFF footprint. The BFF contract is unaffected. |
| SDUI is a contract registry, not a runtime renderer | Yes | Bits UI primitives are implementation detail of M-UI components. They are not SDUI component kinds and must not appear in the SDUI allowlist. |
| No service/plugin-supplied UI | Yes | Bits UI is a third-party *primitive* library vendored into M-UI, not a service or plugin contributing UI. It does not cross the service/UI boundary. |
| High/critical risk commands require M-Policy + Audit Log; UI eligibility is display-only | Yes | Bits UI Dialog only provides the *confirmation UX*; the authorization, policy decision, and audit facts remain service-owned. The Dialog must not evaluate eligibility — it only presents the BFF-derived eligibility. |
| Destructive commands are never icon-only; disabled commands show a reason | Yes | Must be preserved *by contract* in the `ui/Dialog`/`ui/Button` wrappers: the wrapper renders the Chinese disabled reason and the impact summary, not the bare Bits UI primitive. |
| No toasts/snackbars for contract-relevant feedback | Yes | Bits UI Alert is **not** used as a toast. InlineOperationalAlert stays a full-width, non-dismissible banner. This is an adoption constraint, not a violation. |
| Visible UI text is Chinese; machine fields stay English | Yes | Bits UI is headless/unstyled and language-neutral; all visible labels are supplied by M-UI. |

**Conclusion of §5:** adoption is boundary-safe **provided** Bits UI is confined
to the `ui/` primitive layer and wrapped so that workbench rules (disabled
reasons, impact summaries, non-dismissible alerts) are enforced by the wrapper,
not delegated to the headless primitive.

---

## 6. Migration Recommendation

**Sequencing — adopt AFTER the `layout / modules / ui` split, not before.**

1. **Do not introduce Bits UI during the current flat-`lib/components/` state.**
   The audit (§8) requires a minimum test foundation (route-render smoke tests,
   token-presence checks, CommandWell behavior tests, degraded-BFF scenarios)
   before any file restructuring. Adding a dependency in the same window as the
   structure move multiplies risk and makes regressions hard to attribute.

2. **Introduce Bits UI only inside the `ui/` primitive layer** once the split
   exists (per `M-UI-DESIGN-EXPLORATION-DECISION.md` Task 7):
   - `ui/ConfirmDialog.svelte` — wraps Bits UI `Dialog`; enforces impact-summary
     + Chinese disabled-reason + non-icon-only destructive action.
   - `ui/CommandSearch.svelte` — wraps Bits UI `Command`/`Combobox`; drives
     command-well eligibility search over BFF-derived eligible commands.
   - `ui/Skeleton.svelte` — wraps Bits UI `Skeleton`; used by degraded-BFF
     loading states.
   - `ui/LedgerTable.svelte` — (optional, later) wraps Bits UI `Table` for
     AuditLedger / ServiceRegistryTable when sorting/pagination is needed.
   - `ui/InspectorAccordion.svelte` — (optional, later) wraps Bits UI
     `Accordion` for collapsible KeyValueInspector sections.

3. **Adoption order by value:** Dialog → Skeleton → Command/Combobox → Table →
   Accordion → (Button only if consistency is worth it). Alert, Separator, and
   Tabs are not recommended.

4. **Never let Bits UI shapes leak into BFF contracts or SDUI schemas.** The
   BFF returns domain facts and display-oriented command eligibility; it must
   not return Bits UI prop shapes, component names, or primitive options. SDUI
   component kinds remain the existing allowlist (audit §3.1); a Bits UI-backed
   `ui/ConfirmDialog.svelte` is an *internal* M-UI primitive, not a new SDUI
   kind. Contract tests (`tests/ui-contract/`) and the visual-contract scan
   should be extended to assert no `bits-ui` import paths appear outside
   `apps/m-ui/src/lib/ui/`.

5. **Pin and verify at adoption time.** When the split lands, add `bits-ui` as a
   dev dependency of `apps/m-ui` only (not the root), pin an exact version,
   verify Svelte 5 runes compatibility against the then-current `svelte`
   version, and add a component test for each wrapper before it is consumed by
   a module.

---

## 7. Risk Note

| Risk | Severity | Mitigation |
|---|---|---|
| **Svelte 5 runes compatibility** | High | Bits UI v1+ advertises Svelte 5 runes support, but the exact pinned version must be verified against the `svelte` version current at adoption time (today `5.37.0`). All existing M-UI components are already runes-based; a runes-incompatible Bits UI version would block adoption. Verify with a smoke test (mount a wrapped primitive) before depending on it. |
| **Additional bundle size** | Medium | Bits UI is tree-shakeable and headless (no CSS runtime), so only imported primitives ship. Still, M-UI is a static-adapter (`@sveltejs/adapter-static`) SvelteKit app; bundle budget should be checked after the first wrapper lands. Import only the primitives used (Dialog, Skeleton, Command) — not the full library. |
| **Contributor learning curve** | Medium | Bits UI uses snippets, render-delegation, and a builder-pattern API that differs from the plain-`$props` style of current components. Contributors unfamiliar with headless patterns may produce wrappers that swallow the workbench rules (disabled reasons, impact summaries). Mitigation: provide a `ui/` wrapper contract doc and require each wrapper to carry a component test asserting the workbench invariants. |
| **Over-adoption / scope creep** | Medium | The temptation to wrap every component in a Bits UI primitive. Mitigation: §4 enumerates the non-candidates; §6 fixes the adoption order. Code review + the `ui/`-only import boundary check enforce restraint. |
| **Boundary drift via primitive leakage** | Low–Medium | A wrapper might accidentally encode domain semantics (e.g., policy decision IDs) inside a generic primitive. Mitigation: wrappers take already-shaped display data; all domain semantics stay in `modules/`. |
| **Premature adoption before test foundation** | High | Introducing Bits UI before audit §8 prerequisites are green would restructure behavior without a safety net. Mitigation: §6 gates adoption behind the `layout / modules / ui` split and the test foundation. |

---

## Cross-References

- Concept selection: [`M-UI-DESIGN-EXPLORATION-DECISION.md`](./M-UI-DESIGN-EXPLORATION-DECISION.md) (Task 8 implications, §"Task 8 — Bits UI evaluation")
- Design system / tokens: [`DESIGN.md`](./DESIGN.md) §4–§6, §8
- Structure & test gaps: [`M-UI-STRUCTURE-AND-TEST-GAP-AUDIT.md`](./M-UI-STRUCTURE-AND-TEST-GAP-AUDIT.md) §7.2, §8 (D10)
- Workbench brief & ownership rules: [`M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md`](./M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md)
- SDUI contract: [`SDUI-SCHEMA.md`](./SDUI-SCHEMA.md)
