# M-UI Transitional Workbench: Design Concepts

## Executive Summary

This document presents manual design concepts for the Meristem M-UI Transitional Workbench. Because automated UI generation (e.g., Google Stitch MCP) is unavailable in the current execution environment, this document provides written concept definitions and ASCII layout sketches to satisfy the Wave 2 design activation plan. 

These concepts establish the structural predecessor for the formal workbench. They prioritize operator workflows, ownership boundaries, state-source visibility, and traceability over final visual polish, directly answering the requirements of the M-UI Transitional Workbench Brief.

## Boundary & Ownership Commitments

Both concepts strictly adhere to the Meristem UI boundaries:
*   **M-UI owns UI structure:** Svelte components, layouts, and the future `layout / modules / ui` split belong entirely to M-UI. The workbench shell is a UI concern.
*   **Services own facts:** Capabilities, policy states, domain events, and audit logs remain the property of M-* services.
*   **BFF adapts:** The M-UI BFF aggregates and annotates state sources (deriving display-only command eligibility) but does not own final authorization or UI structure.
*   **SDUI as registry:** SDUI is used strictly as a route/component contract registry, not a dynamic runtime page renderer.
*   **No Plugin UI:** No services, extensions, or plugins supply Svelte components or pages at runtime.

---

## Concept 1: The Spatial "Three-Zone" Console

### Intent
A dense, spatially stable layout designed primarily for the platform and network operator. It implements the `three-zone` layout specified in the SDUI schema directly. By fixing the Inspector and CommandWell in a dedicated right-hand column, operators can continuously monitor the `NodeMap` and `TimelineStream` in the center while evaluating deep entity state and command impact on the side.

### Layout Sketch
```text
+---+-------------------------------------------------+-------------------------+
| N | [RouteHeader]                [StateSourceBadge] |   [KeyValueInspector]   |
| a | +---------------------------------------------+ |                         |
| v | | [InlineOperationalAlert] (if degraded)      | |                         |
|   | +---------------------------------------------+ |                         |
| R |                                                 |                         |
| a | +---------------------------------------------+ |   [TraceLink]           |
| i | | NodeMap / Network Topology                  | |   [RawEnvelopeView]     |
| l | |                                             | |                         |
|   | +---------------------------------------------+ |                         |
|   |                                                 |                         |
|   | +-----------------------+ +-------------------+ |                         |
|   | | ServiceRegistryTable  | | TimelineStream    | +-------------------------+
|   | +-----------------------+ +-------------------+ |   [CommandWellPanel]    |
+---+-------------------------------------------------+-------------------------+
```

### Experience Layers
*   **Orientation:** The persistent `NavRail` and top `RouteHeader` provide immediate context. The center primary area anchors the operator's mental model with spatial/structural data.
*   **Investigation:** Clicking any node or service updates the right-hand `KeyValueInspector` without obscuring the primary overview. 
*   **Controlled action:** The `CommandWellPanel` is permanently docked at the bottom right. When an entity is selected, the well evaluates eligibility. Confirmations and disabled reasons (e.g., "缺少权限：task:submit") appear inline within this fixed zone.
*   **Traceability:** `TraceLink`s and `RawEnvelopeView` are rendered directly above the CommandWell, allowing operators to see the exact audit/log trail of the selected entity before and after action execution.

### Core Workflows Support
1.  **Orient on system state:** Center stage provides immediate `NodeMap` and `ServiceRegistryTable` visibility.
2.  **Inspect an entity:** Deep entity inspection occurs safely in the isolated right column.
3.  **Evaluate command eligibility:** CommandWell clearly displays "disabled" states with Chinese reasoning.
4.  **Execute a controlled action:** Destructive actions trigger a confirmation view inside the CommandWell, displaying target node, policy, and audit requirements.
5.  **Trace after action:** Post-execution, the `CommandWell` shows the `correlationId` and `policyDecisionId`, and the adjacent `TimelineStream` refreshes.
6.  **Handle degraded/fail-closed state:** If a BFF endpoint fails or dependencies are lost, an `InlineOperationalAlert` injects directly below the `RouteHeader` in the primary area.

### Handling Degraded States & Boundaries
State sources (e.g., authoritative, event, log) are surfaced as badges next to headers. If M-Policy or a BFF dependency degrades, the `InlineOperationalAlert` pushes the primary content down. The CommandWell gracefully degrades commands to disabled states with clear source attribution, ensuring fail-closed safety without breaking the layout.

---

## Concept 2: The "Focus-Flow" Ledger

### Intent
A linear, document-oriented layout optimizing for the security and policy operator. This concept treats the system as an append-only ledger of facts and audits. It shifts focus from spatial topology to temporal sequence and policy approvals. The primary surface is a vertical stack where the `AuditLedger` and `DecisionQueueSummary` dominate, and the `CommandWellPanel` acts as a sticky footer.

### Layout Sketch
```text
+-------------------------------------------------------------------------------+
| [NavRail]  [RouteHeader]                                   [StateSourceBadge] |
+-------------------------------------------------------------------------------+
| +---------------------------------------------------------------------------+ |
| | [InlineOperationalAlert] Core 当前处于 degraded 模式                          | |
| +---------------------------------------------------------------------------+ |
|                                                                               |
| [FilterBar]                                                                   |
|                                                                               |
| +---------------------------------------------------------------------------+ |
| | Selected Context: ApprovalDetailPanel / NetworkProfileDetailPanel         | |
| | [KeyValueInspector]                      [TraceLink] [RawEnvelopeView]    | |
| +---------------------------------------------------------------------------+ |
|                                                                               |
| [AuditLedger] / [TimelineStream] / [PolicyDecisionPanel]                      |
|  * 10:02:14 - task:submit - Node A - Success                                  |
|  * 09:55:01 - network:profile-enable - Network B - Approved                   |
|                                                                               |
+===============================================================================+
| [CommandWellPanel] (Sticky Footer)                                            |
| [ 运行 noop 任务 ]  [ 批准 ]  [ 拒绝 ]                                           |
+-------------------------------------------------------------------------------+
```

### Experience Layers
*   **Orientation:** Operators read top-to-bottom. Headers and state sources establish truth, followed immediately by degraded state warnings.
*   **Investigation:** Selecting an item expands an inline `DetailPanel` directly above the ledger, pushing older events out of view to focus on the current investigation.
*   **Controlled action:** The sticky `CommandWellPanel` spans the full width of the viewport bottom. It accommodates complex policy previews, warnings (e.g., "配置变更仅影响控制平面..."), and multi-step `displayOnly` command evaluations.
*   **Traceability:** Because the `AuditLedger` and `TimelineStream` are the primary visual elements, tracing a `correlationId` from a CommandWell success message to a ledger entry is a native vertical scroll interaction.

### Core Workflows Support
1.  **Orient on system state:** Focuses orientation on *recent changes* and pending approvals rather than spatial maps.
2.  **Inspect an entity:** Entities open in wide, horizontal detail panels allowing for side-by-side raw JSON (`RawEnvelopeView`) and parsed keys.
3.  **Evaluate command eligibility:** The sticky footer provides ample horizontal space to explain complex disabled reasons (e.g., "Profile 启用功能尚未启用") without text truncation.
4.  **Execute a controlled action:** The CommandWell expands upwards upon interaction, presenting a wide, highly legible confirmation dialog for high-risk actions.
5.  **Trace after action:** Success notifications inject immediately into the ledger directly above the CommandWell.
6.  **Handle degraded/fail-closed state:** Degraded alerts are full-width banners directly below the header, impossible to miss, perfectly fitting the fail-closed security mindset.

### Handling Degraded States & Boundaries
This concept strictly enforces the M-UI ownership rule—the vertical flow is a Svelte component hierarchy mapping to the SDUI registry. Services provide the audit/policy facts that populate the ledger, but the layout and inline CommandWell behavior are 100% owned by M-UI SvelteKit routes. 

---

## Concept Comparison Matrix

| Criteria | Concept 1: Spatial "Three-Zone" Console | Concept 2: "Focus-Flow" Ledger |
| :--- | :--- | :--- |
| **Workflow Fit** | Excellent for Platform/Network operators needing topology and status mapping. | Excellent for Security/Policy operators needing audit trails and approvals. |
| **Boundary Correctness** | High. Strict right-panel isolation enforces component separation and boundaries. | High. Clear vertical separation of BFF-adapted data streams. |
| **Traceability** | Good. Cross-referencing between center and right panel. | Excellent. Linear ledger flow makes chronological tracing native. |
| **Degraded Visibility** | Good. Inline alerts exist inside the primary content zone. | Excellent. Full-width banners block standard reading patterns entirely. |
| **Implementation Risk** | Medium. Requires careful CSS grid/flexbox tuning for responsive sidebars. | Low. Standard vertical stacking is natively responsive and mobile-friendly. |
| **Design Quality** | High density, "professional tool" SCADA aesthetic. | Clean, document-driven, "ledger" aesthetic. |

---

## Stitch-Specific Notes (For Future Integration)

If Google Stitch or a similar generative UI tool were available in the environment, we would use the `stitch-generate-design` and `stitch-extract-design-md` skills to instantiate these concepts visually. Since no code or image generation is permitted here, below are the prompts and constraints we would pass to the tool.

**Prompting Stitch for Concept 1 (Spatial Console):**
> "Generate a 3-zone industrial SCADA-style web application layout. Left: narrow navigation rail. Center: A dense node topology map and service registry table. Right: A fixed 350px inspector panel containing key-value data and a sticky command well at the bottom. Theme: dark mode, high-contrast text, using a strict 4px grid. Include a warning banner for degraded state. Render UI text in Chinese."

**Prompting Stitch for Concept 2 (Focus-Flow Ledger):**
> "Generate a security auditor's log interface. Top-to-bottom linear flow. Top: Breadcrumb header and a full-width yellow operational alert banner. Middle: An expanded detail view showing raw JSON envelope next to parsed keys. Lower: A dense table of audit logs. Bottom: A sticky footer spanning the full width acting as an action bar with primary and disabled buttons. Theme: light mode, minimal borders, typography-driven. Render UI text in Chinese."

**Historical assets to feed Stitch:**
*   **Colors:** Use task-specific semantic roles for warnings, blocked states, informational states, surfaces, and text hierarchy rather than a fixed repository palette.
*   **Typography:** Consider monospace fonts for `TraceId`, `CorrelationId`, and `RawEnvelopeView`; use readable sans-serif text for UI labels unless a new design direction says otherwise.
*   **SDUI Mapping:** We would explicitly instruct Stitch to map generated components back to the allowed `MUiComponentKind` list (e.g., mapping a generated timeline to `TimelineStream`).
