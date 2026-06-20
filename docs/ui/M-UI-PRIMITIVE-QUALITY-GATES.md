# M-UI Primitive Quality Gates

> Wave 4, Task 9 of the M-UI Transitional Workbench Design Activation Plan.
>
> This document defines the baseline quality gates that every M-UI primitive
> wrapper (Bits UI-backed or hand-written) must satisfy before it can be
> consumed by a production route or module. It covers accessibility, dialog and
> destructive-confirmation behaviour, colour and styling discipline,
> reduced-motion awareness, and a future/manual visual QA checklist.
>
> **This is a baseline only.** It does not claim final visual design approval,
> does not establish permanent image snapshot baselines, and does not introduce
> Playwright-based visual diff tooling. Those are deferred decisions for later
> design-system maturity milestones.

---

## 1. Scope and Relationship to Adoption Criteria

[`M-UI-PRIMITIVE-ADOPTION-CRITERIA.md`](./M-UI-PRIMITIVE-ADOPTION-CRITERIA.md)
defines the governance framework for *whether* a Bits UI primitive can be
adopted. It answers the question: "what gates must a proposal pass before we
allow a new Bits UI import in `apps/m-ui/src/lib/components/ui/`?"

This document defines the quality gates every primitive wrapper must pass
*after* adoption is approved, covering runtime behaviour, accessibility,
styling discipline, and visual verification. It answers: "what checks must
this wrapper pass before it can appear in a production route?"

An adopted primitive that fails any mandatory gate in this document is
treated as not yet production-ready, regardless of its adoption approval
status.

---

## 2. Mandatory Accessibility Gates

Every primitive wrapper must satisfy the following accessibility checks.
These gates apply whether the wrapper is backed by a Bits UI headless
primitive or implemented entirely in hand-written Svelte.

### 2.1 Accessible Name

Every interactive surface must expose a machine-readable accessible name.

- Dialog title content must be conveyed to assistive technology via the
  element's accessible name computation (e.g., `aria-labelledby` pointing
  to the title element, or Bits UI `AlertDialog.Title` which provides this
  automatically).
- Every actionable element (buttons, toggles, command triggers) must have
  an accessible name. For buttons, this means visible text content, an
  `aria-label`, or an `aria-labelledby` reference. Icon-only buttons are
  forbidden in destructive and command surfaces; see §4.2.

**Current reference**: `ConfirmActionDialog.svelte` uses Bits UI
`AlertDialog.Title` and `AlertDialog.Description`, which supply accessible
name and description associations automatically. The wrapper's buttons use
visible Chinese labels (`cancelLabel`, `confirmLabel`), satisfying the
accessible-name requirement without additional ARIA plumbing.

**Proof requirement**: a component test using `getByRole('dialog')` and
`getByRole('button', { name: '...' })` that asserts the dialog and its
descendants have discoverable accessible names.

### 2.2 Role and Semantics

Every primitive wrapper must render correct ARIA roles and semantic
structure.

- Dialogs must expose `role="dialog"` or `role="alertdialog"` (the latter
  for destructive confirmations that interrupt the operator's workflow).
- Interactive descendants must use semantic HTML elements (`<button>`,
  `<input>`, etc.) or explicit ARIA roles with matching states and
  properties.
- The wrapper must not strip or override ARIA attributes provided by the
  underlying Bits UI primitive. If the primitive supplies `aria-labelledby`,
  `aria-describedby`, `role`, or state attributes (`aria-expanded`,
  `aria-disabled`), the wrapper must preserve them.

**Current reference**: Bits UI `AlertDialog.Root` renders a dialog with
`role="alertdialog"`, focus trapping, and proper title/description
associations. The `ConfirmActionDialog` wrapper does not override any of
these.

**Proof requirement**: a component test that asserts `role="alertdialog"`
on the rendered dialog element, or `role="dialog"` for non-destructive
dialogs.

### 2.3 Keyboard and Focus Behaviour

Every primitive wrapper must be fully operable by keyboard alone.

- **Focus trap**: when a modal dialog or overlay is open, focus must be
  trapped within it. Tab and Shift+Tab must cycle through focusable
  descendants without escaping to the background page.
- **Restore on close**: when the dialog is dismissed, focus must return to
  the element that triggered it (or a documented fallback if the trigger is
  no longer in the DOM).
- **Keyboard activation**: Enter and Space must activate focused buttons.
  Escape must dismiss the dialog (see §2.4).
- **Tab order**: focusable elements must appear in a logical DOM order that
  matches visual reading order.

**Current reference**: Bits UI `AlertDialog.Content` defaults `trapFocus`
to `true` and handles Escape-to-close. The wrapper's `handleOpenChange`
delegates open/close state management to the Bits UI controlled-open API.
No keyboard behaviour is overridden or suppressed.

**Proof requirement**: a component test that:
1. Opens the dialog.
2. Asserts focus is inside the dialog (not on the background page).
3. Presses Escape and asserts the dialog closes.
4. Asserts focus returns to the trigger element.

### 2.4 Escape and Cancel Behaviour

Dialogs and overlays must be dismissible via Escape and via an explicit
cancel affordance.

- **Escape key**: pressing Escape must close the dialog and call the
  `onOpenChange` callback with `false`. The dialog must not prevent Escape
  from working when focus is on a non-editable element.
- **Cancel button**: every dialog must render a visible, labelled cancel
  button that closes the dialog without executing the confirmation action.
- **Cancel during execution**: while the confirmation action is in progress
  (e.g., an async `onConfirm` Promise), the cancel button must be disabled
  to prevent mid-flight state corruption. Escape must still close the
  dialog but must not abort the in-flight Promise.

**Current reference**: `ConfirmActionDialog.svelte` disables the cancel
button (`disabled={confirming}`) while the confirmation Promise is pending.
The Bits UI `AlertDialog.Cancel` closes the dialog and calls
`onOpenChange(false)`. Escape is handled by the Bits UI primitive.

**Proof requirement**: a component test that:
1. Opens the dialog, presses Escape, and asserts `onOpenChange` was called
   with `false`.
2. Clicks the cancel button and asserts the dialog closes without calling
   `onConfirm`.
3. Triggers a slow confirmation and asserts the cancel button is disabled
   during execution.

---

## 3. Dialog-Specific Gates

These gates apply to every dialog primitive wrapper, including
`ConfirmActionDialog` and any future dialog-backed components (e.g.,
command-parameter forms, approval-reason dialogs).

### 3.1 Title and Description Presence

Every dialog must render a visible title and a visible description.

- The title must be non-empty and convey the action category (e.g., "危险操作",
  "确认删除").
- The description must explain the consequence in operator-facing Chinese
  (see §4.1).
- If either title or description is missing or blank, the confirm action
  must be disabled. The dialog must not render with an empty or invisible
  title/description slot.

**Current reference**: `ConfirmActionDialog.svelte` derives `isInvalid`
from blank `title`, blank `description`, blank `confirmLabel`, or a
non-blank `disabledReason`, and disables the confirm action when any of
these conditions hold. To avoid rendering an empty title/description slot,
the wrapper renders visible fallback text (`缺少操作标题`, `缺少操作描述说明`)
while keeping the confirm action fail-closed.

**Proof requirement**: component tests that render the dialog with a blank
title and with a blank description, and assert the confirm button is
disabled with a visible Chinese disabled reason.

### 3.2 Overlay and Backdrop

Every modal dialog must render a visible backdrop overlay that:

- Obscures the background page (opaque or semi-transparent).
- Prevents interaction with background elements (click, focus, scroll).
- Uses a design-system token for background colour (not a hardcoded hex
  value; see §5.1).

**Current reference**: `ConfirmActionDialog.svelte` renders
`AlertDialog.Overlay` with `class="dialog-overlay"`, styled via scoped CSS
using `--overlay-bg: color-mix(in srgb, var(--surface-sunken) 80%, transparent)`.

### 3.3 Portal Rendering

Dialog content must be rendered in a portal (detached from the component's
DOM position) to avoid z-index, overflow, and stacking-context conflicts.

**Current reference**: `ConfirmActionDialog.svelte` wraps its content in
`AlertDialog.Portal`, which Bits UI renders to `document.body`.

---

## 4. Destructive Confirmation Gates

These gates apply to any dialog that confirms a destructive or high-risk
action (delete, disable, revoke, force-apply, break-glass).

### 4.1 Visible Consequence Text

Every destructive confirmation must display visible, operator-facing Chinese
text that describes the consequence of proceeding. This text must:

- Appear in the dialog body (description or a dedicated consequence
  section).
- Name the target resource (e.g., "节点 `remote-leaf-01`").
- State the irreversible effect (e.g., "此操作无法撤销").
- Use the `--signal-block` token for the title colour to signal danger
  (not decoration).

The consequence text must never be hidden behind a tooltip, collapsed
behind an icon, or rendered only as a generic "Are you sure?" without
context.

**Current reference**: `ConfirmActionDialog.svelte` receives `title` and
`description` as required props. The dialog title is styled with
`color: var(--signal-block)` to signal danger. The description is rendered
via Bits UI `AlertDialog.Description`. Callers are responsible for supplying
operationally meaningful Chinese text for both title and description.

### 4.2 No Icon-Only Destructive Controls

Destructive action triggers (buttons, menu items, command entries) must
never be icon-only. They must always include visible Chinese text.

- Red X icons, trash icons, or warning triangles without accompanying text
  are forbidden.
- The confirm button text must describe the action in Chinese (e.g., "删除
  节点", "撤销令牌"), not a generic "Confirm" or "OK".

**Current reference**: `ConfirmActionDialog.svelte` renders the confirm
button with `confirmLabel` text. The Bits UI `AlertDialog.Action` renders
as a semantic `<button>`. The wrapper provides no icon-only path.

### 4.3 Double-Execution Prevention

The confirm action must prevent double execution. While an async `onConfirm`
Promise is pending, the confirm button must be disabled and subsequent
clicks must not trigger additional `onConfirm` calls.

**Current reference**: `ConfirmActionDialog.svelte` uses a `confirming`
boolean state that disables both the confirm and cancel buttons while the
Promise is in flight. The `handleConfirm` function returns early if
`isInvalid || confirming`. The component test in
`confirm-action-dialog.vitest.ts` explicitly proves single-execution with
rapid triple-click.

**Proof requirement**: a component test that clicks the confirm button
multiple times in rapid succession and asserts `onConfirm` was called
exactly once.

### 4.4 Disabled State Must Show Reason

When the confirm action is disabled (invalid props, missing permission,
unreachable node, pending execution), the UI must display a visible
Chinese reason for the disabled state.

- The reason must appear in the UI, not only in a console log or
  `aria-describedby`.
- The disabled confirm button must be visually distinct (reduced opacity,
  different cursor) and must not fire any request when clicked.

**Current reference**: `ConfirmActionDialog.svelte` accepts an optional
`disabledReason` prop. When `disabledReason` is populated (non-blank), or
when `title`, `description`, or `confirmLabel` are blank, `isInvalid`
becomes `true`, disabling the confirm button. The wrapper derives
`activeDisabledReason` from the explicit `disabledReason` prop, from
auto-generated invalid-state reasons (e.g., `缺少操作标题`, `缺少操作描述说明`,
`缺少确认按钮文案`), or from pending execution
(`确认操作进行中，暂时无法取消或重复提交`). The reason is rendered in an
explicit `<div class="dialog-disabled-reason" role="alert">` block visible
in the dialog body. The confirm button text falls back to `操作无效` when
`confirmLabel` is blank. The CSS uses `cursor: not-allowed` and distinct
disabled styling for disabled buttons.

---

## 5. Colour and Styling Gates

### 5.1 Token-Only Styling (Non-Negotiable)

Every primitive wrapper must use only M-UI design-system tokens (CSS custom
properties defined in root canonical [`DESIGN.md`](../../DESIGN.md)) for
all visual properties: colours, spacing, typography, borders, shadows, and
radii.

- Hardcoded pixel values are permitted only for layout mechanics that
  tokens do not yet express (e.g., `position: fixed`, `inset: 0`,
  `z-index`, `transform`).
- Raw hex colour values, `rgb()`/`rgba()`/`hsl()` values, and CSS colour
  keywords are forbidden in component styles.
- Tailwind utility classes are prohibited in primitive wrappers (per
  `M-UI-PRIMITIVE-ADOPTION-CRITERIA.md` Gate 3).

**Proof requirement**: `bun run design:lint` must pass. This command validates
the canonical `DESIGN.md` file structure and token vocabulary. It verifies
well-formedness of the design-system source; it does not scan component CSS or
Svelte files for raw colour literals or undefined-token usage. Component-level
token-only styling enforcement is currently a manual review responsibility
(see §7).

### 5.2 No Colour-Only Status Communication (Non-Negotiable)

Critical state must never be communicated through colour alone.

- A status that is conveyed by a colour change (e.g., green border for
  healthy, red border for critical) must also include a non-colour
  indicator: text, icon with a label, pattern, or shape difference.
- This applies to node health states, policy decision results, audit
  verdicts, command eligibility, and any other operator-significant state.
- The rule applies to all M-UI components, not only primitive wrappers.

**Design-system enforcement**: the colour tokens in root `DESIGN.md` are
semantic (`danger`, `warning`, `success`). The CSS implementation additionally
defines a `--signal-*` token family (`--signal-ok`, `--signal-warn`,
`--signal-block`, etc.) with documented semantic meanings; this family is not
yet recorded in `DESIGN.md` (see `M-UI-DESIGN-TOKEN-PARITY.md` §2.2). No colour
token is permitted for decoration. When a component binds a semantic token to a
state, it must also render a non-colour indicator (text label, icon +
`aria-label`, or shape).

**Proof requirement**: `bun run design:lint` must pass (validates the canonical
`DESIGN.md` file structure and token vocabulary; see §8). Manual visual review
(see §7) must confirm that each colour-bound state has a visible non-colour
counterpart and that no raw colour literals appear in component styles.

### 5.3 Design Token Hygiene

Primitive wrappers must not introduce new CSS custom properties without
corresponding entries in root `DESIGN.md`. Tokens that exist only in the CSS
vocabulary (e.g., `--signal-*` family) are permitted for current use but should
be noted as pending `DESIGN.md` entry in the parity audit
(`M-UI-DESIGN-TOKEN-PARITY.md`).

- Token names must use the `--<family>-<weight>` or `--<semantic-role>`
  convention established in the CSS token vocabulary (`app.css :root`) and
  corresponding entries in root `DESIGN.md`.
- Wrapper-scoped tokens (e.g., `--overlay-bg` in `ConfirmActionDialog`)
  are permitted for internal layout mechanics but must not become public
  API.
- Undefined tokens that resolve to browser defaults at runtime (e.g.,
  `--radius-sm` not defined in `app.css :root`) must be fixed before the
  wrapper is considered production-ready.

---

## 6. Reduced-Motion Awareness

### 6.1 Current Baseline

As of Task 9, no M-UI component or primitive wrapper uses CSS transitions,
animations, or keyframe animations. Motion is absent from the codebase.

### 6.2 Future Mandate

Whenever motion is introduced (CSS transitions, `@keyframes` animations,
JavaScript-driven animation, or Bits UI primitive transitions), the
wrapper must respect the operator's `prefers-reduced-motion` system
preference.

- All animated properties must be wrapped in a
  `@media (prefers-reduced-motion: reduce)` query that disables or
  minimises the animation.
- Bits UI primitives that provide built-in transition support (e.g.,
  `Dialog.Content` enter/exit animations) must not be overridden with
  hardcoded animation that ignores the preference.
- Motion must serve a functional purpose: focus indication, state
  transition feedback, or spatial relationship. Decorative motion
  (entrance flourishes, parallax, continuous animation) is prohibited
  regardless of `prefers-reduced-motion`.

**Proof requirement (future)**: a component test that mocks
`matchMedia('(prefers-reduced-motion: reduce)')` and asserts that animated
properties are disabled or reduced. Until motion is introduced, this gate
is deferred with no failing consequence.

### 6.3 Motion Token Family (Deferred)

Root `DESIGN.md` and `app.css` do not define a motion token family
(`--duration-*`, `--easing-*`). When motion is introduced, a motion token
family must be added to both `DESIGN.md` and `app.css :root` before any
component uses motion. This is a Task 10 follow-up.

---

## 7. Visual QA Baseline Checklist

This section defines a checklist for future manual or screenshot-based
visual QA of primitive wrappers. It is a baseline only. It does not claim
final visual design approval, does not establish permanent image snapshot
baselines, and does not introduce automated visual diff tooling (e.g.,
Playwright screenshot comparison, Percy, Chromatic).

### 7.1 When to Run Visual QA

Visual QA should be performed when:

- A new primitive wrapper is created.
- An existing wrapper's visual styling is changed (new tokens, layout
  adjustments, state additions).
- The design-system token values in `DESIGN.md` or `app.css :root` are
  modified and the wrapper is a consumer of those tokens.
- A Bits UI version bump changes the rendered DOM structure of a wrapper.

### 7.2 Visual QA Items

For each primitive wrapper under review, verify the following items through
manual inspection or screenshot capture. Record the date, reviewer, and
findings for each session.

| # | Check | What to Look For |
|---|-------|------------------|
| V1 | Token rendering | All token-driven properties (colours, spacing, typography, borders, shadows) render with the correct computed values. No browser-default fallbacks from undefined tokens. |
| V2 | Colour contrast | Text against its background meets at minimum a 3:1 contrast ratio for large text and 4.5:1 for body text. Use a browser DevTools contrast checker. |
| V3 | Text clipping | Chinese text (title, description, button labels, disabled reasons) is not clipped, truncated without ellipsis, or overflowing its container at any viewport width. |
| V4 | Button sizing | Confirm and cancel buttons have sufficient touch/click target area (minimum 44x44 CSS pixels per WCAG 2.2 Target Size, or 24x24 for inline controls). |
| V5 | Disabled visual distinction | Disabled buttons are visually distinguishable from enabled buttons in both colour and cursor. A disabled button must not look clickable. |
| V6 | Overlay opacity | The backdrop overlay provides sufficient obscuration of background content. Background text should not be readable through the overlay. |
| V7 | Focus ring visibility | When a button or interactive element receives focus (via keyboard Tab), a visible focus indicator is rendered. The default browser outline is acceptable if not suppressed. |
| V8 | Dialog centering | The dialog is visually centred in the viewport. It does not shift position when content length changes. It remains within the viewport on narrow screens. |
| V9 | Reduced-motion (future) | When `prefers-reduced-motion: reduce` is active, any animated transitions are disabled or minimised. (Deferred until motion is introduced; see §6.2.) |
| V10 | No layout shift on open | Opening the dialog does not cause the background page to shift, scroll, or reflow. The overlay and dialog are rendered in a portal (see §3.3). |

### 7.3 What This Checklist Is Not

This checklist does not:

- Replace accessibility testing (see §2). Visual QA is a supplement, not a
  substitute for keyboard, screen-reader, and role tests.
- Establish permanent regression baselines. Screenshots captured during
  visual QA are evidence for the current review session. They are not
  committed as golden images or used for automated diff comparison.
- Approve final visual design. The transitional workbench's visual
  language is intentionally a stepping stone toward `MERISTEM-DESIGN.md`'s
  dark-native palette. Visual QA verifies that the current implementation
  is coherent, not that it matches a final design direction.
- Introduce Playwright visual comparison, Percy, Chromatic, or any
  automated screenshot diff tooling. Those are deferred decisions.

### 7.4 Evidence Capture (Optional)

Reviewers may capture screenshots as manual evidence for the current review
session. If captured:

- Store them in a temporary directory (e.g., `tests/evidence/`), not in
  `docs/` or version-controlled asset directories.
- Do not commit them to the repository as golden images.
- Name them by component and date (e.g.,
  `confirm-action-dialog-2026-06-20.png`), not by task number.

---

## 8. Command Verification Gates

The following commands must pass before any primitive wrapper is claimed
production-ready. These commands are defined in
[`docs/testing/TESTING.md`](../testing/TESTING.md) and represent the
automated enforcement of the gates in this document.

| Command | What It Verifies |
|---------|-----------------|
| `bun run test` | Root Bun test suite. Verifies that no `.vitest.ts` files leak into the Bun runner and that shared logic passes. |
| `bun run typecheck:m-ui` | TypeScript strictness for the `apps/m-ui` workspace. Verifies that the wrapper's Svelte and TypeScript files have no type errors. |
| `bun run design:lint` | Validates the canonical `DESIGN.md` file structure and token vocabulary. It verifies the design-system source is well-formed; it does not scan component CSS or Svelte files. Component-level token enforcement (no raw colour literals, defined-token-only usage) is a manual review responsibility (see §7). |

Runner ownership reminder:

- Root `bun run test` owns only Bun-compatible `*.test.ts` suites.
- `cd apps/m-ui && bun run test` owns the M-UI Vitest / `happy-dom`
  runtime and component suites (`*.vitest.ts`).
- `bun run design:lint` validates the canonical `DESIGN.md` file structure
  and token vocabulary. It owns the design-system source well-formedness gate.

The component test for a primitive wrapper must use the `*.vitest.ts`
naming convention (matching the existing `confirm-action-dialog.vitest.ts`)
so it is picked up by the Vitest runner and safely ignored by the root Bun
runner.

---

## 9. Cross-References

- Primitive adoption governance:
  [`M-UI-PRIMITIVE-ADOPTION-CRITERIA.md`](./M-UI-PRIMITIVE-ADOPTION-CRITERIA.md)
- Approved Bits UI pilot wrapper:
  `apps/m-ui/src/lib/components/ui/ConfirmActionDialog.svelte`
- Pilot component test:
  `apps/m-ui/src/lib/components/ui/confirm-action-dialog.vitest.ts`
- Canonical design-system source (tokens):
  [`DESIGN.md`](../../DESIGN.md)
- Target visual design contract:
  [`MERISTEM-DESIGN.md`](../../MERISTEM-DESIGN.md)
- Testing strategy and gates:
  [`docs/testing/TESTING.md`](../testing/TESTING.md)
- Design token parity audit:
  [`M-UI-DESIGN-TOKEN-PARITY.md`](./M-UI-DESIGN-TOKEN-PARITY.md)
- Transitional workbench brief:
  [`M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md`](./M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md)
