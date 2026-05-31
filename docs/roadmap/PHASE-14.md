# Phase 14 - Formal M-UI, SDUI, and BFF

> Goal: replace the Phase 9 Functional Demo Shell with the first formal Control Room Ledger UI foundation, backed by explicit SDUI and BFF contracts.

---

## 1. Scope

Phase 14 establishes the formal M-UI product surface after the Phase 9 demo shell. It rebuilds the UI foundation around durable route contracts, operational layout, state-source visibility, and permission-aware BFF aggregation.

Phase 14 implements:

```text
formal M-UI shell
design token enforcement
formal route registry
SDUI route contract v0.2
M-UI BFF display contracts
overview route replacement
nodes route
timeline route
audit route
policy decisions route
services route
CommandWell contract hardening
trace/source visibility
responsive operational layout
```

Phase 14 must preserve the Control Room Ledger thesis from `MERISTEM-DESIGN.md`: orientation first, traceability always, conservative action by default.

---

## 2. Relationship To Phase 9

Phase 9 was an **M-UI Functional Demo Shell**. Phase 14 replaces it as a product foundation.

Phase 14 may reuse Phase 9 code only when it still satisfies the formal contracts:

- token-based visual system.
- three-zone layout.
- no forbidden UI components.
- M-UI calls BFF, not fact-source services directly.
- command eligibility remains display-only.
- high-impact actions stay in CommandWell.
- Audit / Policy / Log / Node state expose traceable source information.

Phase 14 must not inherit these demo-only assumptions as final product rules:

- single overview-only workflow.
- one hard-coded noop command as the main UI concept.
- Chinese visible text as a permanent language decision.
- route-local component composition without a formal route registry.
- demo token entry as a final authentication model.
- minimal policy summary as the only policy surface.

Authentication remains local bearer-token based until a later identity phase. Phase 14 may keep a development token entry component, but it must be framed as a local operator/session control, not a production login system.

---

## 3. Out Of Scope

Phase 14 excludes:

- OIDC, SSO, cookies, user management, or production identity provider integration.
- LLM-assisted approval review.
- approval queue approve / reject UI as a required route.
- M-Net profile enable / disable UI as a required route.
- config lifecycle authoring UI.
- M-Extension UI.
- realtime WebSocket / SSE UI updates.
- custom query builder for OpenSearch.
- mobile-native app behavior.
- marketing / landing pages.
- broad design-system library extraction outside M-UI.

Deferred UI items are tracked in `docs/roadmap/DEFERRED-WORK.md`.

---

## 4. Formal Route Set

Phase 14 introduces a route registry with these initial routes:

```text
control-room.overview
nodes.index
nodes.detail
timeline.index
audit.index
policy.decisions
services.index
```

Required routes:

| Route | Primary Purpose | Required Components |
|-------|-----------------|---------------------|
| `control-room.overview` | Current M network orientation | NodeMap, TimelineStream, ServiceRegistryTable, InlineOperationalAlert, CommandWellPanel |
| `nodes.index` | Node state scanning and filtering | NodeMap or table, KeyValueInspector, TraceLink |
| `nodes.detail` | One node's operational state | KeyValueInspector, TimelineStream, RawEnvelopeView |
| `timeline.index` | Human-readable operational events | TimelineStream, TraceLink, filters |
| `audit.index` | High-trust audit facts | AuditLedger, TraceLink, RawEnvelopeView |
| `policy.decisions` | Policy decisions and pending outcomes | PolicyDecisionPanel, DecisionQueueSummary |
| `services.index` | Service definitions and runtime state | ServiceRegistryTable, KeyValueInspector |

Routes may ship with read-only command surfaces first. Mutating commands require explicit CommandWell definitions, policy requirements, and Audit behavior before becoming executable.

---

## 5. SDUI v0.2 Contract

Phase 14 extends the SDUI route contract beyond the Phase 9 demo.

Required additions:

```ts
// 与 packages/contracts/src/schemas/ui.ts 中 SduiV02RouteSchema 一致
type MUiRouteSchemaV02 = {
  id: string;
  title: string;
  requiredPermissions: string[];
  stateSources: ("authoritative" | "event" | "cache" | "read-model" | "log" | "audit" | "policy")[];
  degradedState: {
    enabled: boolean;
    reason: string;
  };
  components: {
    kind: SduiV02ComponentKind;
    id: string;
  }[];
};
```

Registry shape (`SduiV02RouteRegistrySchema`):
```ts
type SduiV02RouteRegistry = {
  schemaVersion: "sdui@0.2.0";
  routes: MUiRouteSchemaV02[];
};
```

Candidate component additions:

```text
RouteShell
RouteHeader
StateSourceBadge
PermissionGateBlock
FilterBar
DecisionQueueSummary
```

Any new component kind must be operational, source-aware, and covered by schema tests. Toasts, snackbars, decorative cards, floating actions, unscoped dropdowns, hidden destructive controls, and frontend-owned authorization remain forbidden.

---

## 6. BFF Contract

M-UI BFF becomes the formal display aggregation boundary for M-UI routes. It still must not become a fact source.

M-UI BFF owns:

- route data shaping.
- state-source annotations for UI display.
- permission-aware disabled reasons.
- route registry publication.
- minimal display summaries for facts owned by Core, M-Policy, M-Log, M-Net, or M-Task.
- BFF OpenAPI for M-UI-facing routes.

M-UI BFF must not own authorization decisions, Audit facts, policy facts, operational writes, cross-request permission caching, or private copies of backend state.

Phase 14 BFF routes:

```text
GET /api/v0/routes
GET /api/v0/routes/:id
GET /api/v0/overview
GET /api/v0/nodes
GET /api/v0/nodes/:id
GET /api/v0/timeline
GET /api/v0/audit
GET /api/v0/policy/decisions
GET /api/v0/policy/decisions/:id
GET /api/v0/services
POST /api/v0/commands/:commandId/eligibility
POST /api/v0/commands/:commandId/execute
```

The generic command endpoints must validate `commandId` against BFF-known command contracts. They must not allow arbitrary backend route forwarding.

---

## 7. CommandWell Scope

Phase 14 hardens CommandWell as a route-level command surface.

Allowed first commands:

```text
task.noop.submit
service.reload
```

`service.reload` is optional until the service lifecycle route contract is stable enough for formal UI execution.

Command requirements:

- explicit command contract.
- impact summary.
- required permission list.
- policy requirement flag.
- Audit requirement flag.
- disabled reason.
- confirmation state.
- success result shape.
- error envelope shape.
- trace / correlation display.

Commands not in Phase 14 base scope:

- approval approve / reject.
- M-Net CN enable / disable.
- config publish / rollback.
- extension enable / disable.
- secret rotation.

Those commands require their own route and CommandWell contracts before becoming executable.

---

## 8. Visual And Interaction Requirements

Phase 14 must implement the visual contract as enforceable UI constraints:

- dark-native graphite surface.
- semantic state colors only.
- no brand / gradient / accent token additions.
- type scale capped at `--text-2xl`.
- three-zone operational layout with optional inspector.
- command well always visible when a route has executable actions.
- text remains readable and non-overlapping on desktop and mobile.
- critical state is not color-only.
- raw logs and envelopes remain selectable.
- keyboard focus is visible and distinct from selection.
- reduced motion collapses non-essential motion.

Phase 14 must add UI contract tests that scan for forbidden color literals and forbidden component kinds.

---

## 9. State Source Rules

Every route and operational component must declare the source class for critical state:

```text
authoritative
event
cache
read-model
log
audit
policy
```

Examples:

```text
nodes.index -> authoritative node records via Core / M-Net boundary
timeline.index -> log facts via M-Log/Core/BFF display contract
audit.index -> Audit Log facts via M-Log/Core/BFF display contract
policy.decisions -> M-Policy decision facts
services.index -> service definitions and runtime summaries
```

OpenSearch-backed search results must be labeled read-model, not authoritative facts.

---

## 10. Permissions And Degraded Modes

Permission behavior:

- routes declare `requiredPermissions`.
- missing permission renders a route-level access block with required permission names.
- missing permission for a command renders a disabled CommandWell state, not a hidden action.
- access-denied reads do not create Audit facts unless the backend contract requires one.

Degraded behavior:

- Core degraded mode shows an inline operational alert.
- M-Log unavailable degrades Timeline / Audit routes without hiding source of failure.
- M-Policy unavailable disables mutating commands and shows fail-closed reason.
- M-Net unavailable disables node/network control commands.
- M-Task unavailable disables task commands.

---

## 11. Target Files

Expected implementation areas:

```text
apps/m-ui/
services/m-ui-bff/
packages/contracts/src/schemas/ui.ts
docs/ui/SDUI-SCHEMA.md
docs/services/m-ui-bff.md
docs/contracts/REST-API-MVP.md
docs/contracts/CLI-COMMANDS.md
docs/testing/TESTING.md
docs/references/svelte-latest.md
tests/contracts/
tests/e2e/
tests/ui-contract/
package.json
```

---

## 12. Test Gates

Contract tests:

- SDUI v0.2 route schema decode / encode.
- unknown component kind fails closed.
- forbidden component kinds are rejected.
- route registry contains the required Phase 14 route IDs.
- BFF OpenAPI exposes only UI-facing routes.
- M-UI calls only M-UI BFF.
- command eligibility is derived from BFF display contracts and does not create Audit facts.

UI contract tests:

- no raw hex / rgb / hsl color literals in component styles except token definitions.
- forbidden component names do not appear.
- high-risk actions appear only in CommandWell.
- critical state includes non-color text or structural indicator.
- buttons and dense controls do not overflow at supported viewport widths.

E2E tests:

- overview route loads with operator token.
- nodes route shows node state and source markers.
- timeline route shows Timeline entries and trace links where present.
- audit route denies operator and allows security-admin.
- policy decisions route shows allow / deny / require_* decisions.
- CommandWell noop flow still works through M-Task.
- missing M-Policy disables mutating commands.
- mobile viewport can navigate primary routes without overlapping text.

Verification commands:

```bash
bun run lint
bun run typecheck
bun run test:contracts
bun run test:e2e
bun run nodejs-ban
```

Browser visual verification should use Playwright screenshots for desktop and mobile route shells before claiming Phase 14 complete.

---

## 13. Completion Criteria

Phase 14 is complete when:

- Phase 9 Functional Demo Shell is replaced by a formal route shell and route registry.
- SDUI v0.2 route schema is documented, implemented, and contract-tested.
- M-UI BFF exposes formal route data and display contracts without becoming a fact source.
- Overview, Nodes, Timeline, Audit, Policy Decisions, and Services routes are usable.
- Route-level state sources are visible for critical operational facts.
- CommandWell is formalized and at least the noop M-Task command still works through the formal path.
- Audit route behavior distinguishes operator denied state from security-admin visibility.
- M-UI visual styling follows `MERISTEM-DESIGN.md` tokens and forbidden pattern rules.
- UI works on desktop and mobile without text overlap or hidden destructive actions.
- Contract, UI contract, and e2e tests pass or have documented infrastructure skip conditions.

