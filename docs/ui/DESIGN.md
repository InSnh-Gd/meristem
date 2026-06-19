---
name: "M-UI Transitional Workbench"
colors:
  primary: "#0f172a"
  surface: "#ffffff"
  background: "#f8fafc"
  border: "#e2e8f0"
  danger: "#ef4444"
  warning: "#f59e0b"
  success: "#10b981"
  textPrimary: "#1e293b"
  textSecondary: "#64748b"
---

# Design System: M-UI Transitional Workbench

> **Note:** This document serves as the design-system contract and intent specification for the M-UI Transitional Workbench. It is a semantic reference for Stitch, Figma, and human developers, not a literal Svelte component implementation spec.

## 1. Design Philosophy & Product Intent

The M-UI Transitional Workbench is a "Focus-Flow Ledger" designed for security, policy, and platform operators. It operates as a Control Room Ledger where orientation, traceability, and conservative action take precedence over decorative visuals. The design language must communicate authority, safety, and chronological truth. We treat the system as an append-only ledger of facts and audits, prioritizing temporal sequence and clear policy approvals. Operators must feel confident that what they see is exactly what the system state reflects, and any destructive or high-risk action is bounded by explicit confirmation and visible impact summaries.

## 2. Information Architecture

The Focus-Flow Ledger relies on a strict, predictable vertical hierarchy across all domains (nodes, policy, audit, timeline). Instead of a complex multi-pane spatial grid, information stacks linearly top-to-bottom:

1. **Header Zone:** `NavRail` (side) and `RouteHeader` (top) with an integrated `StateSourceBadge` establishing context and truth.
2. **Alert Zone:** A full-width `InlineOperationalAlert` immediately below the header that injects itself only when the system is in a degraded or fail-closed state.
3. **Filter Zone:** A `FilterBar` for narrowing the ledger or stream.
4. **Content Stream (Primary):** The vertical workspace module (e.g., `AuditLedger`, `TimelineStream`, `NodeMap`).
5. **Inspector Zone (Inline):** When an item is selected, a `KeyValueInspector`, `TraceLink`, and `RawEnvelopeView` expand inline, directly above the content stream.
6. **Command Zone (Footer):** A full-width, sticky `CommandWellPanel` fixed to the bottom of the viewport, acting as the secure execution environment.

## 3. Layout Primitives

* **Vertical Rhythm:** The interface flows vertically. Stacking context is linear.
* **Full-Width Banners:** Degraded states and alerts span the entire width of the primary content area, pushing the ledger down. They are impossible to ignore.
* **Sticky Footer Container:** The `CommandWellPanel` spans the full width of the viewport bottom, anchoring all operational commands securely regardless of vertical scroll position.
* **Responsive Baseline:** The linear vertical stack natively degrades to single-column layouts for smaller or compressed viewports without complex breakpoint logic.

## 4. Color Strategy

Colors are semantic and functional. Avoid raw hex spam in implementation; rely on token mapping.

* **Neutral / Surface:** Slate and gray scales (`#f8fafc` background, `#ffffff` surface, `#e2e8f0` borders). Provides a clean, document-like foundation.
* **Primary / Text:** Deep navy or slate (`#0f172a`, `#1e293b`). Used for typography, primary structure, and neutral focus states. 
* **Danger:** Red (`#ef4444`). Used strictly for destructive actions, error states, and critical alerts.
* **Warning:** Amber/Orange (`#f59e0b`). Used for degraded states, pending approvals, and cautionary alerts.
* **Success:** Emerald/Green (`#10b981`). Used for approved policies, successful command execution, and healthy node states.

## 5. Spacing Scale

Based on a standard 4px/8px grid system to maintain a structured, ledger-like density:
* **Micro:** `4px` (gap between icons and text, dense data points)
* **Tight:** `8px` (padding within tight badges or list items)
* **Base:** `16px` (standard container padding, spacing between ledger entries)
* **Loose:** `24px` (spacing between major architectural zones, e.g., Alert to Filter)
* **Layout:** `32px` - `48px` (page margins, spacing above the sticky footer)

## 6. Typography Scale

Clean, system-level sans-serif optimized for data density and readability.
* **Display / Header 1:** `24px`, Semibold (Route titles)
* **Header 2:** `18px`, Medium (Section headers within the ledger)
* **Body / Base:** `14px`, Regular (Standard data points, ledger entries, log text)
* **Caption / Meta:** `12px`, Regular/Mono (Timestamps, trace IDs, raw envelope data, state source tags)
* **Monospace:** Used exclusively for code blocks, IDs, JSON envelopes, and exact values to ensure vertical alignment.

## 7. State-Source and Degraded-State Language

* **State Source Attribution:** Every critical fact rendered on screen must visually attribute its source (e.g., authoritative, event, cache, read-model, log, audit, policy) via a `StateSourceBadge`.
* **Degraded States:** When the UI cannot reach authoritative data or a dependency fails, it must fail-closed. The UI must clearly explain the degraded state in Chinese via the `InlineOperationalAlert` (e.g., "Core 当前处于 degraded 模式"). Disabled commands in the CommandWell must display visible Chinese reasoning (e.g., "缺少权限：task:submit").

## 8. Component Catalog & Intent

*   **NavRail:** Global orientation; persistent left-side navigation.
*   **RouteHeader:** Page-level orientation and title.
*   **StateSourceBadge:** Small tag attached to headers or data points identifying the origin of the facts (e.g., "audit", "policy").
*   **InlineOperationalAlert:** Full-width banner for communicating degraded modes, system failures, or missing dependencies.
*   **FilterBar:** Search and filtering controls for the content streams.
*   **KeyValueInspector:** Dense, vertical table for deep inspection of entity fields.
*   **TraceLink:** Affordance connecting an event to its correlation ID, navigating the operator to the origin.
*   **RawEnvelopeView:** Monospace container for displaying raw, untampered JSON/event data.
*   **AuditLedger:** A chronological, append-only list of operator actions, policy decisions, and system changes.
*   **TimelineStream:** A chronological stream of domain events and state transitions.
*   **DecisionQueueSummary:** A list view summarizing pending policy approvals or manual tasks.
*   **CommandWellPanel:** The sticky footer container that evaluates command eligibility, previews impact, and captures explicit confirmation before executing action.
*   **NetworkProfileListPanel:** Ledger view for network profile definitions.
*   **NetworkDetailPanel:** Inspection view for a specific network.
*   **NodeMap:** Topology/list visualization of system nodes.
*   **ServiceRegistryTable:** Ledger view of registered services and their health.
*   **NodeCredentialPanel:** Secure inspection panel for node-specific credentials or identity claims.
