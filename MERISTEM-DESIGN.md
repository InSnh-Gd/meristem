# MERISTEM-DESIGN - Visual Design Contract

> This document is the **visual design contract** for MERISTEM. It sits alongside `MERISTEM.md` (the product brief) and `MERISTEM-DEV.md` (the engineering spec).
>
> **Boundaries.** `MERISTEM.md` answers what the product is. `MERISTEM-DEV.md` answers how the system is built. This document answers what M-UI looks like, how operational interfaces behave, and why the interface refuses to look like a generic SaaS dashboard.
>
> Chapter numbers here are independent. Cross-document references use `产品文档 §X.Y` for `MERISTEM.md`, `开发文档 §X.Y` for `MERISTEM-DEV.md`, and `DESIGN §X.Y` for this file.
>
> **Language note.** This document is written in English on purpose. It is short, declarative, and meant to be quoted verbatim into code comments and PR reviews.

---

## 1. The One Thesis

MERISTEM's interface is not a dashboard for decorating infrastructure. It is an operational control room whose job is to make node state, policy decisions, and audit facts legible under pressure.

One metaphor holds the system together: **a control room ledger**.

The control room side gives the UI live topology, status, degraded modes, and command surfaces. The ledger side gives it restraint: every change has a line, every line has a source, every high-risk action has a decision trail. The UI must feel like a place where operators can act, but where the system resists casual, unaudited action.

The interface should never optimize for excitement. It optimizes for orientation, traceability, and conservative action.

---

## 2. Color

### 2.1 Palette Philosophy

MERISTEM is dark-native because it is an operational surface. The color model is graphite, phosphor, warning ink, and audit marks. Backgrounds stay dark and quiet. Text and lines carry most hierarchy. Color is reserved for state, risk, and command eligibility.

There is no marketing gradient, no brand-purple surface, and no decorative accent color. A color exists only if an operator can explain what system fact it represents.

### 2.2 Base Face

```text
--surface-root       #090B0D   page background; near-black graphite, never pure black
--surface-panel      #101418   panels, inspectors, command wells
--surface-raised     #171D22   elevated rows, selected regions, focused traces
--surface-sunken     #050607   terminal wells, raw log panes

--text-100           #F3F7F7   highest contrast text; route titles, critical values
--text-80            #C8D0D2   body text and readable logs
--text-60            #8B969B   secondary labels, metadata, timestamps
--text-40            #586268   disabled text and low-priority structure
--line-strong        #2C363C   visible separators and selected outlines
--line-soft          #1B2328   default hairlines
```

Two things about these values are not negotiable:

```text
The root surface is not black. Pure black destroys trace density and makes degraded state harder to scan.
The primary text is not pure white. Operators read long logs and policy explanations; glare is a failure mode.
```

### 2.3 State and Risk Tokens

```text
--signal-ok          #4CC38A   healthy, acknowledged, successful
--signal-info        #6FA8FF   informational state, selected route, active query
--signal-warn        #F2B84B   degraded, delayed, requires attention
--signal-risk        #FF7A45   high-risk operation, suspicious behavior, unsafe config
--signal-block       #FF5C70   denied, audit-blocking, critical failure
--signal-audit       #D6B66F   audit-only marks and immutable evidence
```

These tokens are semantic on purpose and must remain few. They are not brand colors. They must not be used for decoration, empty states, marketing accents, or illustration.

### 2.4 Forbidden Color Tokens

The following tokens do not exist and must not be added:

```text
--color-primary
--color-brand
--color-accent
--gradient-*
--chart-rainbow-*
--signal-success-2
--signal-error-2
```

If a new state cannot be represented by the existing six signal tokens, the state model is probably unclear.

---

## 3. Typography

### 3.1 Font Families

```text
--font-body      "IBM Plex Sans", "Aptos", system-ui, sans-serif
--font-mono      "Berkeley Mono", "IBM Plex Mono", "SF Mono", ui-monospace, monospace
--font-display   same as --font-body
```

IBM Plex Sans is used because it reads as technical documentation, not consumer software. Monospace is reserved for IDs, hashes, subjects, event names, config keys, versions, and raw logs.

### 3.2 Type Scale

```text
--text-xs        11px   dense metadata, short status labels
--text-sm        12px   table labels, node chips, service metadata
--text-base      14px   default UI text and log summaries
--text-lg        16px   inspector headings and command summaries
--text-xl        20px   route titles
--text-2xl       28px   landing or overview title only
```

Intentionally missing: display sizes above 28px. MERISTEM is an operational console, not a marketing site.

### 3.3 Line Height and Weight

```text
--lh-tight       1.15   compact labels and route titles
--lh-normal      1.45   UI text
--lh-prose       1.65   policy explanations, LLM summaries, audit notes
--lh-log         1.55   raw log and event streams

--fw-regular     400    default text
--fw-medium      500    labels, selected items, low-emphasis headings
--fw-semibold    600    route titles and critical decision labels only
```

---

## 4. Space

### 4.1 Space Scale

```text
--space-1        4px
--space-2        8px
--space-3        12px
--space-4        16px
--space-6        24px
--space-8        32px
--space-12       48px
```

Intentionally missing: arbitrary one-off spacing in components. Dense control surfaces become unreadable when spacing is improvised.

### 4.2 Page Metrics

```text
--shell-padding-x     clamp(16px, 2vw, 28px)
--shell-padding-y     18px
--panel-gap           12px
--measure-prose       72ch
--inspector-width     420px
```

---

## 5. Layout

### 5.1 Layout Principle

MERISTEM uses a three-zone operational layout: navigation rail, primary work surface, and optional inspector. The route must still work when the inspector is closed.

### 5.2 Required Layout Regions

```text
Navigation rail      M-* domains, node scopes, service areas
Primary surface      topology, table, timeline, policy queue, or config workflow
Inspector            selected node, service, event, log entry, policy decision, or config version
Command well         explicit action area; never hidden behind hover-only UI
```

### 5.3 Forbidden Layout Elements

- 🚫 Marketing hero layout inside authenticated M-UI.
- 🚫 Floating action buttons.
- 🚫 Bottom tab bars.
- 🚫 Hidden destructive actions behind icon-only menus.
- 🚫 Full-screen modal workflows for normal operations.
- 🚫 Infinite dashboard grids with unrelated widgets.

---

## 6. Components

### 6.1 Existing Component Inventory

The following component types exist with strictly bounded behavior:

- **NodeMap** - shows Core / Stem / Leaf topology and degraded paths; it cannot execute actions.
- **ServiceRegistryTable** - lists service definitions, health, lifecycle, and contract versions.
- **TimelineStream** - shows human-readable system events; it cannot replace Audit Log.
- **AuditLedger** - shows immutable high-trust audit facts with actor, action, scope, and decision trace.
- **PolicyDecisionPanel** - explains allow / deny / require_* outcomes and next required action.
- **CommandWell** - the only place where high-impact operations can be confirmed.
- **ConfigLifecycleStepper** - shows draft -> validate -> commit -> version -> hash/sign -> publish -> apply -> ack -> rollback.
- **TraceLink** - links log, event, decision, and OpenTelemetry trace IDs.
- **RawEnvelopeView** - monospace display for event envelopes, service definitions, and webhook payloads.

### 6.2 Forbidden Component Types

The following component types do not exist in MERISTEM:

```text
Toast
Snackbar
Decorative Card
Marketing Banner
Confetti
Carousel
Floating Action Button
Unscoped Dropdown Action Menu
Unlabeled Icon Button for destructive action
```

Alerts are allowed only as inline operational state blocks with traceable cause and next action.

---

## 7. Motion

### 7.1 Motion Principle

Motion communicates change in operational state. It never decorates. Content entry may fade in. State changes must snap or use a short highlight pulse. Network topology changes may animate only when the movement helps preserve spatial orientation.

### 7.2 Timing Tokens

```text
--motion-instant      0ms      reduced motion and critical state changes
--motion-fast         90ms     row highlight, focus state
--motion-normal       160ms    inspector open, panel reveal
--motion-slow         240ms    topology reflow only
```

### 7.3 Forbidden Motion

- 🚫 Hover scale transforms.
- 🚫 Spinning loaders as the primary loading state.
- 🚫 Decorative background motion.
- 🚫 Page transition animations.
- 🚫 Motion on destructive confirmation.
- 🚫 Any animation that delays visibility of Audit Log, policy result, or failure state.

---

## 8. Accessibility

### 8.1 Minimum Guarantees

- All foreground/background contrast meets WCAG AA.
- Keyboard focus state is visible and not confused with selected state.
- All command controls have text labels.
- Critical state is never communicated by color alone.
- Raw logs and event envelopes remain selectable text.
- Dense tables support keyboard navigation and copyable IDs.

### 8.2 `prefers-reduced-motion`

When `prefers-reduced-motion` is active, all non-essential motion collapses to instant state changes. Topology changes may use static before/after highlighting instead of movement. No information is hidden, delayed, or deferred because motion is disabled.

---

## 9. Enforcement

### 9.1 How Constraints Are Enforced

Design constraints are enforced through:

1. Token-only styling for colors, spacing, type, and state signals.
2. SDUI schema validation for route-level layout and component inventory.
3. TypeScript enums or literal unions for component kinds and signal tokens.
4. PR review checks for raw colors, arbitrary spacing, forbidden components, and untraceable destructive actions.
5. Story or fixture coverage for degraded, denied, blocked, and audit-critical states.

### 9.2 PR Review Checklist

When reviewing visual code, ask:

1. Does this introduce a raw color, arbitrary spacing, or unregistered typography value?
2. Does this add a component type forbidden in DESIGN §6.2?
3. Does this hide a high-risk action behind hover-only, icon-only, or generic menu UI?
4. Does this represent policy, audit, log, or node state without a traceable source?
5. Does this use color as the only carrier of critical state?
6. Does this make a degraded or failure state less visible than a healthy state?
7. Does this conflict with `MERISTEM.md` §6 product taboos?
