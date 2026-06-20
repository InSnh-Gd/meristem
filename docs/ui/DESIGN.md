# M-UI Design System: Companion & Index

> **This document is a companion, not a standalone design-system source.** The canonical AI-readable design-system file is root [`DESIGN.md`](../../DESIGN.md). Read that file for token definitions, component intent, layout primitives, spacing and typography scales, and reconciliation notes.
>
> This companion explains how the canonical design system relates to the M-UI Transitional Workbench brief, the SDUI schema, `MERISTEM-DESIGN.md`, and the component mapping. It carries UI-specific rationale and boundary notes that are not duplicated in the canonical root.

---

## 1. Document Map

| Document | Role | Location |
|----------|------|----------|
| `DESIGN.md` | **Canonical** design-system source (tokens, primitives, components, intent) | Root |
| `MERISTEM-DESIGN.md` | Target visual design contract (dark-native, deferred adoption) | Root |
| `M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md` | Operator workflows, experience layers, ownership principles | `docs/ui/` |
| `SDUI-SCHEMA.md` | Route/component contract registry (not a renderer) | `docs/ui/` |
| `M-UI-STRUCTURE-MAPPING.md` | Component-to-module (`layout / modules / ui`) implementation mapping | `docs/ui/` |
| This file | Companion/index explaining relationships and UI-specific rationale | `docs/ui/` |

---

## 2. Two-Tier Design Model

Meristem maintains two design documents at different layers, intentionally:

1. **`DESIGN.md` (root)** — The canonical transitional design-system authority. It records the design-intent tokens, primitives, and component catalog. The CSS implementation (`apps/m-ui/src/app.css`) has adopted the dark/graphite target palette from `MERISTEM-DESIGN.md` ahead of this document's token update; this documented divergence (see root `DESIGN.md` §9.1) means the canonical source is the design authority, not a literal mirror of the current CSS. AI design tools and frontend implementers should read this file as the primary design-system input, consulting the parity audit at `docs/ui/M-UI-DESIGN-TOKEN-PARITY.md` for token-by-token divergence details.

2. **`MERISTEM-DESIGN.md` (root)** — The target visual design contract for the future formal workbench. It mandates a dark-native graphite palette, IBM Plex Sans and Berkeley Mono font families, semantic signal tokens, and stricter component/layout/motion rules. Adoption of this target is deferred; the transitional workbench does not implement it yet.

**Do not merge these two documents.** The root `DESIGN.md` serves as the current implementation contract. `MERISTEM-DESIGN.md` serves as the future target. Collapsing them into a single document would conflate what is implemented with what is planned.

---

## 3. Relationship to the M-UI Transitional Workbench Brief

The [`M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md`](./M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md) defines the operator workflows, experience layers (Orientation, Investigation, Controlled Action, Traceability), ownership principles, and evaluation criteria for the M-UI Transitional Workbench. The canonical `DESIGN.md` is the design-system expression of that brief: it translates the brief's Focus-Flow Ledger concept into concrete tokens, layout primitives, and component intent.

The brief's four deferred areas remain unaddressed in the design system:
- Final visual language and brand polish
- Final primitive/component library decisions
- Final state architecture
- Advanced charting, visualization, and motion systems

---

## 4. Relationship to SDUI Schema

The [`SDUI-SCHEMA.md`](./SDUI-SCHEMA.md) records the route and component inventory that M-UI commits to support. It is a **contract registry**, not a runtime page renderer or composition engine. The canonical `DESIGN.md` defines the visual language for the components listed in the SDUI registry; the SDUI schema defines which components exist and which routes use them.

Key boundary: SDUI does not create pages or dynamically instantiate components at runtime in the current Transitional Workbench stage. Any future runtime rendering or dynamic composition requires a new ADR and contract migration.

---

## 5. UI-Specific Rationale

This section records design decisions that are specific to the UI layer and are not captured in the canonical token definitions at root `DESIGN.md`.

### 5.1 Why a light/slate palette (not dark-native)

The canonical `DESIGN.md` records a light/slate palette (`#ffffff` surface, `#f8fafc` background) as the transitional design intent. `MERISTEM-DESIGN.md` mandates a dark-native graphite palette as the target visual design contract, but adopting it requires a coordinated migration across the entire component tree. The CSS implementation (`apps/m-ui/src/app.css`) has already adopted the dark/graphite target palette ahead of `DESIGN.md`'s token update; this divergence is documented in root `DESIGN.md` §9.1. The transitional workbench intentionally defers full token reconciliation; the canonical `DESIGN.md` remains the design-system authority while the implementation runs ahead on colour tokens. This should not be resolved through a documentation-only change.

This deferral is scoped in the `M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md` §3 (deferred: final visual language). It should not be resolved through a documentation-only change.

### 5.2 Why `CommandWellPanel` in design vs `CommandWell` in code

The canonical `DESIGN.md` §8 uses `CommandWellPanel` to describe the layout role: a panel that occupies the command zone at the bottom of the viewport. The implementation file is `CommandWell.svelte` inside `modules/command/`. The design document describes intent and layout semantics; the implementation filename drops the `Panel` suffix because the Svelte file naming convention does not encode layout roles. This is not a naming inconsistency that needs correction.

### 5.3 Component catalog coverage

The canonical `DESIGN.md` §8 describes design-intent components. Additional implementation components exist in the landed code tree that were added after the design document was authored. For the full implementation inventory, see `M-UI-STRUCTURE-MAPPING.md`. The canonical catalog captures design intent; the structure mapping captures implementation fact.

### 5.4 State-source attribution

The canonical `DESIGN.md` §7 requires that every critical fact visually attribute its source (authoritative, event, cache, read-model, log, audit, policy). This is enforced via the `StateSourceBadge` component. The BFF is responsible for annotating data with `stateSource` metadata; the UI renders it without interpreting or authoring the classification. The BFF must not own final facts or final authorization.

---

## 6. What This Companion Does Not Duplicate

This companion intentionally does not duplicate:
- Token definitions (color hex values, spacing scale, typography scale) — see root `DESIGN.md` §§4–6
- Information architecture zones — see root `DESIGN.md` §2
- Layout primitives — see root `DESIGN.md` §3
- Component catalog entries and intent descriptions — see root `DESIGN.md` §8
- Reconciliation notes — see root `DESIGN.md` §9

If a fact appears in both files, the root `DESIGN.md` version is authoritative.

---

## 7. Intended Readers

| Reader | Primary Document |
|--------|-----------------|
| AI design tools (Stitch, Figma MCP, Claude Design) | Root `DESIGN.md` |
| SvelteKit frontend implementers | Root `DESIGN.md` + `M-UI-STRUCTURE-MAPPING.md` |
| Design exploration agents | Root `DESIGN.md` + `M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md` |
| PR reviewers checking visual code | Root `DESIGN.md` + `MERISTEM-DESIGN.md` §9.2 |
| Anyone understanding document relationships | This file |
| Anyone checking SDUI contract validity | `SDUI-SCHEMA.md` |

---

## 8. Maintenance Rules

- If a token changes, update root `DESIGN.md`. Do not duplicate the change here.
- If the two-tier model changes (e.g., the transitional workbench adopts `MERISTEM-DESIGN.md` tokens), update §2 here and the header note in root `DESIGN.md`.
- If SDUI introduces runtime rendering, update §4 here and file a new ADR.
- If the brief's deferred areas are activated, update §3 here.

This file is an index and explanation layer. It should not grow into a second design-system copy.
