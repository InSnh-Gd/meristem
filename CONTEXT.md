# Meristem Context

Meristem language for the M network control system, focused on operator-facing control, traceability, and audit boundaries.

## Language

**Control Room Ledger**:
The M-UI metaphor for an operational surface that combines live system orientation with ledger-like traceability.
_Avoid_: Dashboard, admin panel

**M-UI Functional Demo Shell**:
A temporary operator-facing surface used to prove Meristem control-room flows before the final M-UI design is rebuilt.
_Avoid_: Final M-UI design, production UI system

**M-UI Functional Demo Acceptance Path**:
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
_Avoid_: read-model projection blocker, replacement source of truth

**CommandWell Confirmation**:
The explicit confirmation step inside the command area before an operator sends a control action.
_Avoid_: Modal confirmation, single-click execution

**CommandWell Eligibility**:
The visible executability state of a command derived from Core-visible facts and policy-facing permissions.
_Avoid_: BFF-private authorization rule, demo-only shortcut

**Effect Executable Contract**:
A Meristem internal contract modeled with Effect Schema so type derivation, runtime validation, and contract tests share one source.
_Avoid_: Type-only interface, duplicated route literal list, schema refactor

**Contract Drift Check**:
A test that proves an **Effect Executable Contract** and its Elysia TypeBox / OpenAPI adapter still accept the same required fields, literals, and documented examples.
_Avoid_: Snapshot-only OpenAPI check, manual schema comparison

**Projection Read Action**:
A projection operation that only reads **OpenSearch Read Model Projection** state, such as projection health or DLQ listing.
_Avoid_: Projection admin API, projection mutation

**Projection Control Action**:
A projection operation that changes projection operating state or the visible read model path, such as backfill, DLQ replay, or DLQ skip.
_Avoid_: Search query, ordinary log read, OpenSearch write model action

**M-Task**:
The Meristem domain for task lifecycle, task definitions, execution coordination, and task observability once task behavior outgrows the Core-owned MVP noop workflow.
_Avoid_: Generic workflow engine, Core-private task helper, transport owner

**Pending Policy Escalation**:
A policy decision state where an operation is blocked and recorded because it requires manual review or multi-approval, without executing the operation or running the approval workflow yet.
_Avoid_: Completed approval, allow with warning, automatic delayed execution

## Relationships

- The **M-UI Functional Demo Shell** demonstrates a subset of the **Control Room Ledger** without becoming the final visual design.
- The **M-UI Functional Demo Acceptance Path** is the completion proof for the **M-UI Functional Demo Shell**.
- The **M-UI BFF** may serve the **M-UI Functional Demo Shell**, but Core, M-Policy, and M-Log remain the fact sources.
- A **Disabled Command Explanation** belongs to a command shown by the **M-UI Functional Demo Shell** and does not create an audit fact by itself.
- **Audit Access State** belongs to the **M-UI Functional Demo Shell** and shows access to audit facts without becoming the full audit surface.
- A **Minimal Policy Decision Summary** can be shown after a command result, but M-Policy and Core remain the decision fact sources.
- **OpenSearch Read Model Projection** is derived from M-Log and authoritative PostgreSQL facts; it must not replace those facts.
- The **Projection Platform Track** follows the first **OpenSearch Read Model Projection** and adds durable projector operations without changing the source of truth.
- A **CommandWell Confirmation** happens before the command is sent and before any audit fact is created.
- **CommandWell Eligibility** may be displayed by the **M-UI BFF**, but it must be derived from Core-visible facts rather than invented as a separate authorization layer.
- An **Effect Executable Contract** is the internal source for complex shared contract shapes; Elysia TypeBox remains the REST/OpenAPI adapter until a route is deliberately migrated.
- A **Contract Drift Check** belongs anywhere an **Effect Executable Contract** and an Elysia TypeBox / OpenAPI adapter coexist.
- A **Projection Read Action** requires projection read permission but does not create an Audit Log fact by itself.
- A **Projection Control Action** must pass M-Policy, write Audit Log before execution, and write Timeline or Full Log according to outcome.
- **M-Task** coordinates task lifecycle with M-Net / node-agent for delivery and execution, while M-Policy remains the authorization source and M-Log remains the log fact source.
- A **Pending Policy Escalation** can be produced for an **M-Task** control action; it blocks execution until a later approval workflow exists.

## Example Dialogue

> **Dev:** "Should the M-UI Functional Demo Shell screen be treated as the final M-UI design?"
> **Domain expert:** "No, it is an **M-UI Functional Demo Shell** that proves the **Control Room Ledger** flow before we redesign the frontend."

## Flagged Ambiguities

- "M-UI" can mean either the long-term product interface or the temporary demo shell; resolved: call the temporary version **M-UI Functional Demo Shell**.
- "M-UI Functional Demo completion" can mean contract tests or a real control-room demo path; resolved: use **M-UI Functional Demo Acceptance Path** for the end-to-end proof.
- "BFF" can imply an application-specific backend of record; resolved: **M-UI BFF** is only a permission-aware display and command boundary.
- "permission failure" can mean either a blocked request or a disabled UI command; resolved: use **Disabled Command Explanation** only for a command that was not executed.
- "Audit visibility" can mean a complete audit product or a visible permission state; resolved: use **Audit Access State** for the M-UI Functional Demo.
- "policy decision display" can mean a full policy panel or a result breadcrumb; resolved: use **Minimal Policy Decision Summary** for the M-UI Functional Demo.
- "OpenSearch logs" can imply the read model is the log store; resolved: use **OpenSearch Read Model Projection** for query copies.
- "complex projection platform" can mean the first read-model slice or the later operating model; resolved: use **Projection Platform Track** for the latter.
- "confirmation" can mean either a browser modal or a command-area step; resolved: use **CommandWell Confirmation** for Meristem control actions.
- "command is allowed" can mean final authorization or visible executability; resolved: use **CommandWell Eligibility** for the visible command state before execution.
- "Effect schema work" can mean either internal executable contract modeling or HTTP adapter validation; resolved: use **Effect Executable Contract** for internal contract source and keep Elysia TypeBox as REST/OpenAPI adapter.
- "projection admin" can blur read-only observation and mutating repair actions; resolved: use **Projection Read Action** and **Projection Control Action**.
- "M-Task" can imply a general workflow platform or transport layer; resolved: use **M-Task** only for Meristem task lifecycle ownership and keep transport in M-Net / node-agent.
- "require manual review" can sound like a complete approval system; resolved: use **Pending Policy Escalation** when the M-Task cutover only blocks and records the required review outcome.
