# SDUI Schema Contract

> M-UI is based on SvelteKit + SDUI. SDUI is allowed only if it reinforces Meristem's operational boundaries.

---

## 1. Route Shape

```ts
type MUiRouteSchema = {
  id: string;
  version: string;
  title: string;
  layout: "three-zone" | "single-surface";
  requiredPermissions: string[];
  regions: {
    navigation?: MUiComponentRef;
    primary: MUiComponentRef;
    inspector?: MUiComponentRef;
    commandWell?: MUiComponentRef;
  };
};
```

Rules:

- Privileged routes must declare `requiredPermissions`.
- Destructive or high-risk actions must appear in `commandWell`.
- Inspector can be omitted; primary surface must still work.

---

## 2. Component Kinds

Allowed component kinds:

```ts
type MUiComponentKind =
  | "TimelinePanel"
  | "NodeListPanel"
  | "NodeDetailPanel"
  | "AuditLedger"
  | "ServiceListPanel"
  | "CommandWellPanel"
  | "StateSourceBadge"
  | "RouteHeader"
  | "NodeMap"
  | "ServiceRegistryTable"
  | "TimelineStream"
  | "PolicyDecisionPanel"
  | "KeyValueInspector"
  | "FilterBar"
  | "TraceLink"
  | "RawEnvelopeView"
  | "InlineOperationalAlert"
  | "DecisionQueueSummary";
```

Forbidden kinds:

```text
Toast
Snackbar
DecorativeCard
MarketingBanner
Confetti
Carousel
FloatingActionButton
UnscopedDropdownActionMenu
UnlabeledDestructiveIconButton
```

---

## 3. State Source Rule

Components representing operational state must declare source:

```ts
type MUiStateSource = {
  sourceType: "authoritative" | "event" | "cache" | "read-model" | "log" | "audit" | "policy";
  sourceId: string;
  correlationId?: string;
  traceId?: string;
};
```

Critical state cannot be rendered without a source.

---

## 4. CommandWell Rule

```ts
type MUiCommand = {
  id: string;
  label: string;
  action: string;
  resource: string;
  risk: "low" | "medium" | "high" | "critical";
  requiredPermissions: string[];
  requiresPolicy: boolean;
  requiresAudit: boolean;
  state: "enabled" | "disabled";
  disabledReason?: string;
};
```

Rules:

- `risk: "high" | "critical"` requires `requiresPolicy: true`.
- `risk: "high" | "critical"` requires `requiresAudit: true`.
- A command must display impact summary before execution.
- Destructive commands must never be icon-only.
- Disabled commands must display a reason and must not send requests.
- Enabled commands must use CommandWell confirmation before execution.

---

## 5. Phase 9 Functional Demo Route

Phase 9 introduces a temporary **M-UI Functional Demo Shell**. It proves the control-room flow but is not the final frontend design.

Required route shape:

```text
id: control-room.overview
layout: three-zone
primary: NodeMap + ServiceRegistryTable + TimelineStream
inspector: KeyValueInspector + TraceLink + RawEnvelopeView
commandWell: Run noop task
```

Required command:

```ts
type Phase9NoopCommand = MUiCommand & {
  id: "task.noop.run";
  action: "task:submit";
  risk: "medium";
  requiredPermissions: ["task:submit"];
  requiresPolicy: true;
  requiresAudit: true;
};
```

Phase 9 rules:

- Visible UI text is Chinese for Phase 9; machine fields, permission names, event names, error codes, and component kinds remain English.
- The `Run noop task` command is rendered to operators as `运行 noop 任务`.
- It is enabled only for a selected reachable Leaf with `task:submit`.
- Missing permission uses a visible Chinese explanation that preserves the permission name, such as `缺少权限：task:submit`.
- Wrong node kind uses a visible Chinese explanation, such as `目标不是 Leaf 节点`.
- Unreachable node state uses a visible Chinese explanation, such as `目标节点不可达`.
- Disabled commands do not create Audit facts.
- CommandWell confirmation displays target node, task type, required permission, policy requirement, and audit requirement before execution.
- Success displays `task.id`, `policyDecisionId`, and `correlationId`.
- Success refreshes Timeline and the selected Leaf node.
- Failure displays the Core error envelope inline in CommandWell.
- Audit regions remain visible but access-denied for actors without `audit:read`.
- Minimal policy summaries may show actor, action, resource, result, and createdAt; Phase 9 does not require a full `PolicyDecisionPanel`.
- Toasts, snackbars, modals, and hidden destructive controls remain forbidden.
- Mobile must remain usable through a single-column or vertically scrollable layout, but final mobile interaction design is out of scope.
- Phase 9 uses manual refresh and command-after refresh only; realtime UI transports are out of scope.

---

## 6. Done Criteria

- Route schema validates before rendering.
- Unknown component kind fails closed.
- Missing permission hides or disables command with reason; Phase 9 must prefer a visible disabled command explanation.
- High-risk command cannot bypass M-Policy.
- Component token usage follows `MERISTEM-DESIGN.md`.

---

## 7. Phase 9 Control-Room Route

The Phase 9 functional demo implements one SDUI route:

```ts
const controlRoomRoute: MUiRouteSchema = {
  id: "control-room.overview",
  version: "v0",
  title: "控制室概览",
  layout: "three-zone",
  requiredPermissions: ["core:read"],
  regions: {
    navigation: { kind: "NavRail" },
    primary: {
      kind: "NodeMap",
      // co-renders ServiceRegistryTable and TimelineStream below NodeMap
    },
    inspector: { kind: "KeyValueInspector" },
    commandWell: { kind: "CommandWellPanel" }
  }
};
```

**Phase 9 additions beyond the base schema**:

- `AuditLedger`: Rendered inline in the primary surface when the actor has `audit:read`.
- `PolicyDecisionPanel`: Not implemented in Phase 9; only a minimal summary is shown inline after command execution.
- `CommandWellPanel` only surfaces one command (`noop`) against reachable Leaf nodes with `task:submit`.

**Phase 9 state sources**:

- Node list, service registry, session: authoritative (PostgreSQL via Core)
- Timeline entries: log projection (via Core)
- Audit entries: audit projection (via Core, post-filtered by BFF for `audit:read`)
- Command eligibility: derived from session permissions + node state (BFF, display-only)
- Policy decision summary: policy projection (via Core, trimmed by BFF)

---

## 8. Phase 14 Formal Route Set

Phase 14 replaces the single demo route with 7 formal SDUI v0.2 routes, each with state source declarations and degraded state support.

### 8.1 Route Registry

The BFF publishes `GET /api/v0/routes` as an SDUI v0.2 registry:

```ts
type SduiV02RouteRegistry = {
  schemaVersion: "sdui@0.2.0";
  routes: SduiV02Route[];
};
```

### 8.2 Required Routes

| Route ID | Primary Components | State Sources |
|---|---|---|
| control-room.overview | NodeMap, ServiceRegistryTable, TimelineStream, InlineOperationalAlert | authoritative, event, log, audit |
| nodes.index | NodeListPanel, KeyValueInspector, TraceLink | authoritative, event |
| nodes.detail | KeyValueInspector, TimelineStream, RawEnvelopeView | authoritative, event, log |
| timeline.index | TimelineStream, TraceLink | event, log |
| audit.index | AuditLedger, TraceLink, RawEnvelopeView | audit |
| policy.decisions | PolicyDecisionPanel, DecisionQueueSummary | policy, audit |
| services.index | ServiceRegistryTable, KeyValueInspector | authoritative |

### 8.3 New Shared Components (Phase 14)

`StateSourceBadge`, `RouteHeader`, `FilterBar`, `TraceLink`, `RawEnvelopeView`, `InlineOperationalAlert`, `AuditLedger`, `PolicyDecisionPanel`, `DecisionQueueSummary`.

### 8.4 Degraded State

Each route may declare `degradedState: { enabled: boolean; reason: string }`. When `enabled: true`, `InlineOperationalAlert` must render on the route surface; M-UI must not suppress degradation visibility.

### 8.5 Phase 14 Gates

- SDUI v0.2 contract tests verify all 7 route IDs, component allowlist, forbidden kind rejection, state source presence.
- UI contract tests (`test:ui-contract`) enforce token-only styling, forbidden component names, BFF-only data boundary, CommandWell-only high-risk actions.
- BFF contract tests cover route registry, display data endpoints, generic command eligibility/execute, OpenAPI exposure.
