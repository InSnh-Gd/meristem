# M-UI Design Token Parity Audit

> **Audit date:** 2026-06-20
> **Scope:** Compare canonical root `DESIGN.md` with `apps/m-ui/src/app.css` (CSS custom properties) and representative token usage across `apps/m-ui/src/lib/components/{layout,modules,ui}/`.
> **Nature:** Audit only. No code changes, no CSS generation, no token rewrites.
>
> **Status vocabulary (exactly these four values):**
> - `covered`: present in both DESIGN.md and CSS with reasonable parity.
> - `partially-covered`: present in both but with structural gaps, value divergence, or granularity mismatch.
> - `missing-from-DESIGN`: present in CSS (and/or component usage) but absent from DESIGN.md.
> - `missing-from-CSS`: present in DESIGN.md but absent from CSS.

---

## 1. Summary Table

| Token Family | Status | Key Finding |
|---|---|---|
| Color (surface/text/line) | `partially-covered` | Different palettes (light/slate in DESIGN.md vs dark/graphite in CSS). CSS has structured surface/text/line tiers; DESIGN.md has flat hex list. |
| Signal / Severity | `missing-from-DESIGN` | CSS defines 6 `--signal-*` tokens with full component integration. DESIGN.md has no dedicated signal/severity scale. |
| Typography | `partially-covered` | Size scales roughly align but CSS is more granular (6 sizes, 4 line-heights, 3 weights, 2 font families vs DESIGN.md's 4 sizes + monospace mention). |
| Spacing | `partially-covered` | 4/8/16/24/32/48 scale maps well. CSS has an extra 12px step and layout-specific tokens absent from DESIGN.md. |
| Radius | `missing-from-DESIGN` | Neither DESIGN.md nor CSS root defines dedicated radius tokens. Components use ad-hoc `4px`, `var(--space-1)` proxy, `var(--space-2)` as dialog radius, and one undefined `var(--radius-sm)`. The Bits UI wrapper uses token-based radius values (`var(--space-1)`, `var(--space-2)`). |
| Elevation / Shadow | `missing-from-DESIGN` | Neither DESIGN.md nor CSS root defines shadow/elevation tokens. The Bits UI `ConfirmActionDialog` wrapper uses a `color-mix` overlay and token-based borders instead of shadow; no component uses `box-shadow`. |
| Motion Duration | `missing-from-DESIGN` | No motion, transition, animation, or duration tokens in DESIGN.md, CSS root, or component usage. |

---

## 2. Per-Family Detail

### 2.1 Color (Surface / Text / Line)

**DESIGN.md (§4 and frontmatter):**
```
primary: "#0f172a"
surface: "#ffffff"
background: "#f8fafc"
border: "#e2e8f0"
danger: "#ef4444"
warning: "#f59e0b"
success: "#10b981"
textPrimary: "#1e293b"
textSecondary: "#64748b"
```

**CSS (`:root` in `app.css`):**
```css
--surface-root: #090B0D;
--surface-panel: #101418;
--surface-raised: #171D22;
--surface-sunken: #050607;
--text-100: #F3F7F7;
--text-80: #C8D0D2;
--text-60: #8B969B;
--text-40: #586268;
--line-strong: #2C363C;
--line-soft: #1B2328;
```

**Component evidence:** All 10 CSS color tokens are referenced extensively across 32 component files (321 matches for `var(--surface|--text-|--line-)`).

**Parity assessment:**
- The two palettes are entirely different: DESIGN.md documents a light/slate surface (#ffffff / #f8fafc background) while the CSS implements a dark/graphite surface (#090B0D root). The CSS has already adopted the dark/graphite target palette from `MERISTEM-DESIGN.md`, while `DESIGN.md` still records the transitional light/slate palette. This divergence is documented in DESIGN.md §9.1: `DESIGN.md` remains the canonical design-system authority for the transitional workbench, and updating `DESIGN.md` to reflect the implemented dark palette is deferred pending a coordinated token migration.
- Beyond raw value differences, the CSS has a richer token structure: 5 surface levels, 4 text opacity levels, and 2 line levels vs DESIGN.md's flat hex list (9 named values with no tiering).
- `--text-secondary` (DESIGN.md naming style) appears in `TraceLink.svelte` but is not defined in CSS root, suggesting a DESIGN.md-oriented authoring artifact.

**Classification:** `partially-covered`. The color dimension *exists* in both sources but with fundamentally different palettes and structural depth. Neither source can be said to fully cover the other.

**Follow-up candidate:** When DESIGN.md is updated to reflect the implemented dark palette, restructure DESIGN.md color tokens to match the CSS tiered surface/text/line scale and add the `--signal-*` token family (see §2.2).

---

### 2.2 Signal / Severity

**DESIGN.md:** No dedicated signal/severity token family. `danger` (#ef4444), `warning` (#f59e0b), and `success` (#10b981) appear under "Color Strategy" (§4) as semantic color roles but are not organized as a signal scale, lack naming conventions, and lack a severity-mapping mechanism.

**CSS (`:root`):**
```css
--signal-ok: #4CC38A;      /* healthy, success, approved */
--signal-info: #6FA8FF;    /* informational, selected, focused */
--signal-warn: #F2B84B;    /* degraded, pending, caution */
--signal-risk: #FF7A45;    /* at-risk, joining */
--signal-block: #FF5C70;   /* blocked, denied, destructive */
--signal-audit: #D6B66F;   /* audit trail, multi-approval */
```

**Component evidence:** Signal tokens are used across 23 component files (70 references). Usage is semantic and structured:
- `StateSourceBadge.svelte` maps state-source categories to signal colors (`authoritative → signal-ok`, `cache → signal-warn`, `audit → signal-audit`, `policy → signal-block`).
- `NodeMap.svelte` maps node statuses to signal colors (`healthy → signal-ok`, `degraded → signal-warn`, `offline → signal-block`).
- `PolicyDecisionPanel.svelte` maps policy outcomes to signals (`allow → signal-ok`, `deny → signal-block`, `require_manual_review → signal-warn`).
- `InlineOperationalAlert.svelte` maps alert severities (`warn → signal-warn`, `risk → signal-risk`, `block → signal-block`).
- `CommandWell.svelte` uses `signal-warn` for disabled reasons, `signal-ok` for confirm buttons, `signal-info` for command buttons.
- Contract tests in `commandwell.contract.test.ts` and `inline-operational-alert.contract.test.ts` assert specific signal token usage.

**Parity assessment:** DESIGN.md has no signal/severity token family at all. The CSS has a complete 6-value signal scale with consistent naming and full component integration. CSS has a dedicated audit signal (`--signal-audit`) that aligns with Meristem's audit-first philosophy but has no counterpart in DESIGN.md.

**Classification:** `missing-from-DESIGN`. The signal scale is a first-class token family in CSS with clear semantic mapping. DESIGN.md has no corresponding token family.

**Follow-up candidate:** Add a "Signal / Severity Scale" section to DESIGN.md documenting the 6-signal model, naming convention (`--signal-{ok,info,warn,risk,block,audit}`), and semantic mapping rules (state-source, node status, policy outcome, alert severity).

---

### 2.3 Typography

**DESIGN.md (§6):**
| Role | Size | Weight |
|---|---|---|
| Display / Header 1 | 24px | Semibold |
| Header 2 | 18px | Medium |
| Body / Base | 14px | Regular |
| Caption / Meta | 12px | Regular/Mono |
| Monospace | (unspecified) | (unspecified) |

Font family: "Clean, system-level sans-serif" (no explicit stack).

**CSS (`:root`):**
```css
/* Sizes */
--text-xs: 11px;
--text-sm: 12px;
--text-base: 14px;
--text-lg: 16px;
--text-xl: 20px;
--text-2xl: 28px;

/* Line heights */
--lh-tight: 1.15;
--lh-normal: 1.45;
--lh-prose: 1.65;
--lh-log: 1.55;

/* Weights */
--fw-regular: 400;
--fw-medium: 500;
--fw-semibold: 600;

/* Families */
--font-body: "IBM Plex Sans", "Aptos", system-ui, sans-serif;
--font-mono: "Berkeley Mono", "IBM Plex Mono", "SF Mono", ui-monospace, monospace;
```

**Component evidence:** Font tokens are exhaustively used. Size tokens appear in virtually every component file. Line-height tokens are used for specific purposes (`--lh-tight` for headers, `--lh-log` for ledger entries, `--lh-prose` for description text). Font families are applied: `--font-body` globally on `body`, `--font-mono` for IDs, envelope data, and code blocks. Weight tokens are applied to headers (`--fw-semibold`), labels (`--fw-medium`), and body text (`--fw-regular` implicit).

**Parity assessment:**
- Size: DESIGN.md's 4 tiers roughly align to CSS's `--text-2xl` (28px vs 24px), `--text-lg`/`--text-xl` (16-20px vs 18px), `--text-base` (14px match), `--text-sm`/`--text-xs` (11-12px vs 12px). The CSS has 6 sizes vs 4 in DESIGN.md.
- Line height: DESIGN.md has no line-height tokens. CSS has 4 purpose-specific line-height tokens (`tight`, `normal`, `prose`, `log`).
- Font weight: DESIGN.md names weights in the size table (Semibold, Medium, Regular) but has no explicit weight tokens. CSS has 3 weight tokens (`--fw-regular`, `--fw-medium`, `--fw-semibold`).
- Font family: DESIGN.md says "system-level sans-serif" and "Monospace" generically. CSS has explicit font stacks referencing IBM Plex Sans and Berkeley Mono (the target fonts from `MERISTEM-DESIGN.md`).
- CSS also uses a `--text-300` token in `ControlRoomWorkspace.svelte` and `routes/services/+page.svelte` that is not defined in CSS root.

**Classification:** `partially-covered`. Both sources have typography scales, and the size tiers map reasonably. But DESIGN.md is missing line-height tokens, font-weight tokens, and explicit font-family stacks present in CSS. The CSS also has more granular size steps.

**Follow-up candidates:**
- Extend DESIGN.md §6 with line-height tiers, font-weight tokens, and explicit font-family stacks reflecting current CSS usage.
- Investigate `--text-300` as a CSS definition gap (used in components, undefined in root).

---

### 2.4 Spacing

**DESIGN.md (§5):**
| Name | Value |
|---|---|
| Micro | 4px |
| Tight | 8px |
| Base | 16px |
| Loose | 24px |
| Layout | 32px – 48px |

**CSS (`:root`):**
```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-6: 24px;
--space-8: 32px;
--space-12: 48px;
/* Layout-specific tokens */
--nav-rail-width: 200px;
--inspector-width: 420px;
--inspector-mobile-max-height: 320px;
--command-well-offset: 112px;
--command-well-offset-mobile: 180px;
--token-input-width: min(54vw, 320px);
--token-input-min-width: 180px;
--service-table-min-width: 620px;
--shell-padding-x: clamp(16px, 2vw, 28px);
--shell-padding-y: 18px;
--panel-gap: 12px;
```

**Component evidence:** Spacing tokens are the most used token family across all components (279 references in 32 files). `--space-2`, `--space-3`, and `--space-4` dominate for gap/padding. Layout tokens (`--nav-rail-width`, `--shell-padding-x`, `--command-well-offset`) are used in layout components.

**Parity assessment:**
- Core scale matches well: 4px (Micro→space-1), 8px (Tight→space-2), 16px (Base→space-4), 24px (Loose→space-6), 32px and 48px (Layout→space-8/space-12).
- CSS has an extra 12px step (`--space-3`) not in DESIGN.md. This is heavily used in components for gap and padding.
- CSS has 11 layout-specific tokens (nav rail width, inspector dimensions, command well offset, etc.) not documented in DESIGN.md.
- DESIGN.md uses descriptive names (Micro, Tight, Base, Loose, Layout). CSS uses a numeric scale (`--space-N`). The semantic mappings are implicit.

**Classification:** `partially-covered`. The underlying 4px/8px grid philosophy is consistent and the core scale values map directly. DESIGN.md is missing the CSS's extra 12px step and all layout-specific tokens. The naming conventions differ (descriptive vs numeric) but do not create a parity gap.

**Follow-up candidates:**
- Update DESIGN.md §5 to reflect the full 7-step numeric scale (including 12px) and add layout-specific token documentation.
- Consider whether the descriptive tier names (Micro, Tight, etc.) should be preserved as aliases in the CSS or replaced by the numeric convention.

---

### 2.5 Radius

**DESIGN.md:** No radius tokens, no border-radius guidance, no rounding scale.

**CSS (`:root`):** No `--radius-*` tokens defined.

**Component evidence (26 border-radius occurrences in 15 files):**

Three patterns found:

1. **Hardcoded `4px`:** Used in `CommandWell.svelte` (buttons), `NavRail.svelte` (nav items), `NodeMap.svelte` (node chips), `TokenInput.svelte` (inputs), `ApprovalDetailWorkspace.svelte` (5 occurrences). This is the most common pattern.

2. **`var(--space-1)` as radius proxy:** Used in `FilterBar.svelte`, `InlineOperationalAlert.svelte`, `StateSourceBadge.svelte`, `RawEnvelopeView.svelte`, `DecisionQueueSummary.svelte`, `PolicyDecisionPanel.svelte`, `NetworkProfileWorkspace.svelte`, `GlobalProfileControls.svelte`, and `ConfirmActionDialog.svelte` (buttons, disabled-reason badge). Repurposes the 4px spacing token as a border-radius value.

3. **`var(--space-2)` as dialog radius:** Used in `ConfirmActionDialog.svelte` for the dialog container (`8px`).

4. **`var(--radius-sm)` (undefined):** Used in `TraceLink.svelte`. This token does not exist in CSS root and resolves to the browser default.

**Parity assessment:** Radius is completely absent from DESIGN.md and has no formal token family in CSS. Component authors improvise with three different approaches: hardcoded values, spacing-token reuse, and an undefined radius token. This is a clear gap: radius is a commonly used visual property across components but lacks design-system governance.

**Classification:** `missing-from-DESIGN`. radius usage exists in CSS components but is not formalized as a token family in either DESIGN.md or CSS root. This is a DESIGN.md gap first (no radius guidance), and a CSS drift issue second (ad-hoc values and undefined tokens).

**Follow-up candidates:**
- Add a "Radius Scale" section to DESIGN.md with a `--radius-*` token family aligned to the spacing scale (e.g., `--radius-sm: 4px`, `--radius-md: 8px`).
- Define `--radius-sm` (and any other radius tokens) in `app.css` root and migrate hardcoded `4px` and `var(--space-1)` proxy usage to proper radius tokens.
- Investigate the undefined `--radius-sm` in `TraceLink.svelte` as a CSS definition gap.

---

### 2.6 Elevation / Shadow

**DESIGN.md:** No elevation, shadow, or z-index tokens.

**CSS (`:root`):** No `--shadow-*` or `--elevation-*` tokens defined.

**Component evidence:**

Only one component provides a modal overlay: `ConfirmActionDialog.svelte` (the Bits UI `AlertDialog` wrapper). Its styling uses no shadow, no `box-shadow`, no `rgba()`, and no `backdrop-filter`:

```css
/* overlay: colour-mix against surface token, not rgba */
--overlay-bg: color-mix(in srgb, var(--surface-sunken) 80%, transparent);
background: var(--overlay-bg);  /* defined inline within :global(.dialog-overlay) */

/* dialog boundary: token-based border, not box-shadow */
border: 1px solid var(--line-strong);
```

The overlay background is derived from `var(--surface-sunken)` via `color-mix`, not from a hardcoded `rgba()` value. The dialog boundary is a `var(--line-strong)` border, not a `box-shadow`. No `backdrop-filter` is applied. No global or locally-scoped `--shadow-*` custom property is defined.

**Parity assessment:** Elevation/shadow is essentially absent from the design system. The one component with a modal overlay (`ConfirmActionDialog.svelte`) achieves visual separation through a `color-mix` overlay derived from the surface token and a token-based border — no `box-shadow`, no `rgba()` hardcoding, no `backdrop-filter`. This is consistent with the control-room-ledger philosophy, which does not rely on spatial depth cues. The token-based approach is a stronger foundation than the earlier hand-rolled version, since it derives overlay color from the surface token rather than a hardcoded `rgba()` value.

**Classification:** `missing-from-DESIGN`. The overlay component achieves visual separation without shadow; no `box-shadow` exists in any component. The design system has no elevation or shadow token family in either DESIGN.md or CSS root.

**Follow-up candidates:**
- Decide whether elevation/shadow is needed in the design system at all. The dialog wrapper's current approach (colour-mix overlay + token-based border) may be sufficient for the transitional workbench.
- If a fuller elevation model is desired, add an "Elevation / Shadow Scale" section to DESIGN.md with tiered tokens (`--shadow-sm`, `--shadow-md`, `--shadow-lg`).

---

### 2.7 Motion Duration

**DESIGN.md:** No motion, animation, transition, duration, or easing tokens.

**CSS (`:root`):** No `--duration-*`, `--ease-*`, or `--motion-*` tokens defined.

**Component evidence:** No CSS transitions or animations found in any component Svelte `<style>` blocks. Grep for `transition:`, `animation:`, and `@keyframes` across all component files returned zero results (the only match was in a contract test file checking for disabled command surfaces).

**Parity assessment:** Motion is entirely absent. No component animates anything. This is consistent with the control-room-ledger philosophy: operators read facts and approve commands; decorative motion would undermine the authoritative, chronological fidelity. However, even conservative systems sometimes need hover-state transitions or command feedback indicators.

**Classification:** `missing-from-DESIGN`. Motion has no presence in DESIGN.md, CSS root, or component usage. This is a uniform gap but may be intentional for the current transitional workbench surface.

**Follow-up candidates:**
- Explicitly document in DESIGN.md that motion tokens are intentionally deferred or omitted for the transitional workbench, with a section noting what would be added later (e.g., `--duration-fast`, `--duration-normal`, `--ease-default` for hover states and command feedback).
- If motion is considered out of scope permanently, state that explicitly as a design-system boundary.

---

## 3. CSS Definition Gaps (Internal Drift)

The following tokens are referenced in component files but are **not defined** in `app.css :root`. These are CSS-internal drift issues, not DESIGN.md parity issues, but they affect the audit's accuracy:

| Undefined Token | Used In | Count |
|---|---|---|
| `--surface-float` | `JoinTicketPanel`, `NetworkDetailPanel`, `DataplaneStatusPanel`, `NodeCredentialPanel` | 6 |
| `--surface-1` | `ControlRoomWorkspace` | 1 |
| `--surface-2` | `TraceLink` | 1 |
| `--text-300` | `ControlRoomWorkspace`, `routes/services/+page.svelte` | 2 |
| `--signal-error` | `BreakGlassWorkspace` (9 occurrences) | 9 |
| `--signal-err` | `ApprovalDetailWorkspace` | 1 |
| `--lh-relaxed` | `ControlRoomWorkspace` | 1 |
| `--radius-sm` | `TraceLink` | 1 |
| `--text-secondary` | `TraceLink` | 1 |

These resolve to the browser's initial/inherited value at runtime, which may cause visual degradation or silent fallback. Seven of these are stylistic gaps (surface/text/line-height/radius); two are semantic gaps (`--signal-error` and `--signal-err` used for error state communication in `BreakGlassWorkspace` and `ApprovalDetailWorkspace`).

**Note:** These gaps are outside the scope of this DESIGN-to-CSS parity audit (they are CSS-internal issues). They are documented here because they affect the completeness of the CSS evidence base and should be resolved before a future token rationalization pass.

---

## 4. Audit Method Notes

- All component CSS evidence was gathered via grep across 32 Svelte component files under `apps/m-ui/src/lib/components/{layout,modules,ui}/`.
- The `ConfirmActionDialog.svelte` (Bits UI `AlertDialog` wrapper, post-pilot) was explicitly included as representative `ui/` evidence. The current wrapper uses token-based styling throughout: `var(--space-*)` for radius, `color-mix(in srgb, var(--surface-sunken) ...)` for overlay, and `var(--line-strong)` for dialog boundary — no hardcoded `4px`, `rgba()`, or `box-shadow` values.
- `DESIGN.md` reconciliation notes (§9.1) confirm the intentional palette divergence (transitional light vs target dark). This audit treats that as a documented `partially-covered` state, not a bug.
- CSS definition gaps (§3) were discovered as a side effect of tracking token-family usage. They are not part of the primary DESIGN-to-CSS parity question but are documented as context for Task 10.
- Motion duration and radius searches included regex patterns for `transition`, `animation`, `@keyframes`, `border-radius`, `box-shadow`, `elevation`, and `--duration`. Zero false positives were found in the motion search.

---

## 5. Follow-Up Candidates Summary (for Task 10)

These are candidates only; no implementation is authorized by this audit:

1. **Color:** Update DESIGN.md color tokens to match CSS tiered surface/text/line structure when target palette adoption occurs.
2. **Signal/Severity:** Add a dedicated Signal/severity scale section to DESIGN.md documenting the 6-signal model with semantic mappings.
3. **Typography:** Extend DESIGN.md §6 with line-height tiers, font-weight tokens, and explicit font-family stacks.
4. **Spacing:** Add the 12px step and layout-specific tokens to DESIGN.md §5.
5. **Radius:** Add a radius scale section to DESIGN.md; define `--radius-*` tokens in CSS root; migrate ad-hoc values.
6. **Elevation/Shadow:** Decide scope (dialog-only token vs full scale); add to DESIGN.md and CSS root accordingly.
7. **Motion Duration:** Document in DESIGN.md whether motion is intentionally deferred, and define baseline tokens if needed.
8. **CSS drift:** Resolve the 9 undefined tokens (§3) before rationalizing the CSS token sheet.
