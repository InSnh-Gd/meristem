# Meristem Context

Meristem language for the M network control system, focused on operator-facing control, traceability, and audit boundaries.

## Language

**Control Room Ledger**:
The M-UI metaphor for an operational surface that combines live system orientation with ledger-like traceability.
_Avoid_: Dashboard, admin panel

**M-UI Functional Demo Shell**:
A temporary operator-facing surface used to prove Meristem control-room flows before the final M-UI design is rebuilt.
_Avoid_: Final M-UI design, production UI system

**Phase 9 Functional Demo Acceptance Path**:
The end-to-end proof that the temporary demo shell exercises a real control action and audit visibility, not only contract stubs.
_Avoid_: Simulated-only UI completion, contract-test-only acceptance

**M-UI BFF**:
A permission-aware UI boundary that shapes operational display data without becoming the source of audit, policy, or operational facts.
_Avoid_: UI backend of record, frontend-owned policy layer

**Disabled Command Explanation**:
The visible reason an operator cannot run a command in the control surface.
_Avoid_: Hidden action, silent permission failure

**Audit Access State**:
The visible state that tells an operator whether audit facts are inspectable for the current actor.
_Avoid_: Full AuditLedger, hidden audit capability

**Minimal Policy Decision Summary**:
A small operator-facing decision record that shows only who acted, what action was checked, what resource was involved, the result, and when it was created.
_Avoid_: Full PolicyDecisionPanel, policy internals, RBAC table trace

**OpenSearch Read Model Projection**:
A query-oriented copy of Meristem facts used for search, aggregation, and analysis without becoming the source of truth.
_Avoid_: Authoritative log store, audit fact source

**Projection Platform Track**:
The platformization path for read-model projection jobs, replay, backfill, offsets, retry, dead-letter handling, schema versions, and projection health.
_Avoid_: Phase 10.0 blocker, replacement source of truth

**CommandWell Confirmation**:
The explicit confirmation step inside the command area before an operator sends a control action.
_Avoid_: Modal confirmation, single-click execution

**CommandWell Eligibility**:
The visible executability state of a command derived from Core-visible facts and policy-facing permissions.
_Avoid_: BFF-private authorization rule, demo-only shortcut

## Relationships

- The **M-UI Functional Demo Shell** demonstrates a subset of the **Control Room Ledger** without becoming the final visual design.
- The **Phase 9 Functional Demo Acceptance Path** is the completion proof for the **M-UI Functional Demo Shell**.
- The **M-UI BFF** may serve the **M-UI Functional Demo Shell**, but Core, M-Policy, and M-Log remain the fact sources.
- A **Disabled Command Explanation** belongs to a command shown by the **M-UI Functional Demo Shell** and does not create an audit fact by itself.
- **Audit Access State** belongs to the **M-UI Functional Demo Shell** and shows access to audit facts without becoming the full audit surface.
- A **Minimal Policy Decision Summary** can be shown after a command result, but M-Policy and Core remain the decision fact sources.
- **OpenSearch Read Model Projection** is derived from M-Log and authoritative PostgreSQL facts; it must not replace those facts.
- The **Projection Platform Track** follows the first **OpenSearch Read Model Projection** and adds durable projector operations without changing the source of truth.
- A **CommandWell Confirmation** happens before the command is sent and before any audit fact is created.
- **CommandWell Eligibility** may be displayed by the **M-UI BFF**, but it must be derived from Core-visible facts rather than invented as a separate authorization layer.

## Example Dialogue

> **Dev:** "Should the Phase 9 screen be treated as the final M-UI design?"
> **Domain expert:** "No, it is an **M-UI Functional Demo Shell** that proves the **Control Room Ledger** flow before we redesign the frontend."

## Flagged Ambiguities

- "M-UI" can mean either the long-term product interface or the temporary demo shell; resolved: call the temporary version **M-UI Functional Demo Shell**.
- "Phase 9 completion" can mean contract tests or a real control-room demo path; resolved: use **Phase 9 Functional Demo Acceptance Path** for the end-to-end proof.
- "BFF" can imply an application-specific backend of record; resolved: **M-UI BFF** is only a permission-aware display and command boundary.
- "permission failure" can mean either a blocked request or a disabled UI command; resolved: use **Disabled Command Explanation** only for a command that was not executed.
- "Audit visibility" can mean a complete audit product or a visible permission state; resolved: use **Audit Access State** for Phase 9.
- "policy decision display" can mean a full policy panel or a result breadcrumb; resolved: use **Minimal Policy Decision Summary** for Phase 9.
- "OpenSearch logs" can imply the read model is the log store; resolved: use **OpenSearch Read Model Projection** for query copies.
- "complex projection platform" can mean the first read-model slice or the later operating model; resolved: use **Projection Platform Track** for the latter.
- "confirmation" can mean either a browser modal or a command-area step; resolved: use **CommandWell Confirmation** for Meristem control actions.
- "command is allowed" can mean final authorization or visible executability; resolved: use **CommandWell Eligibility** for the visible command state before execution.
