# SDUI Schema Contract

> M-UI is based on SvelteKit + SDUI. SDUI is allowed only if it reinforces Meristem's operational boundaries.
>
> In the Transitional Workbench stage, SDUI is a route/component contract registry, not a runtime page composition engine. M-UI owns route surfaces, Svelte components, and interaction structure; M-* services own facts and capabilities; M-UI BFF adapts those facts into UI-facing data. Services, M-Extension, and plugins do not supply pages or components at runtime.

---

## Current Contract Status

The canonical route schema for the M-UI Transitional Workbench is `SduiV02Route` (fields: `components`, `stateSources`, `degradedState`), documented in §8 below and emitted by the BFF route registry at `GET /api/v0/routes`.

The legacy `MUiRouteSchema` shape (`regions` / `layout` / `version`) documented in §1 and referenced in §7 is **deprecated**. It is retained only as a historical description of the original route intent; the BFF no longer emits it. It will be removed in a future contract migration.

Historical design exploration documents under `docs/ui/` may provide background, but they are non-authoritative. Current product requirements, this SDUI contract, and the M-UI BFF contract define the active boundary.

The SDUI registry remains a route/component contract registry that drives navigation labels and component-kind contracts; it is not a runtime page composition engine. The proposed SDUI v0.3 runtime renderer path is recorded in [`ADR-U01`](../adr/ADR-U01-sdui-runtime-renderer-migration.md) as ADR / contract migration work only; until an accepted migration supersedes this contract, v0.2 remains the implemented boundary.

---

## 1. Route Shape

> **Deprecated:** This schema shape (`MUiRouteSchema` with `regions` / `layout` / `version`) is superseded by `SduiV02Route`. See the current contract status above and §8. It will be removed in a future contract migration.

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
  | "DecisionQueueSummary"
  | "ApprovalQueuePanel"
  | "ApprovalDetailPanel"
  | "NetworkProfileListPanel"
  | "NetworkProfileDetailPanel"
  | "OperationalCommandPreview"
  | "NetworkListPanel"
  | "NetworkDetailPanel"
  | "NodeCredentialPanel"
  | "DataplaneStatusPanel";
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

## 5. M-UI Transitional Workbench Surface

M-UI is Meristem's transitional frontend for the future formal operator workbench. It starts carrying real workbench structure, operation flow, information hierarchy, state-source visibility, and CommandWell boundaries while preserving room for later redesign and restructuring.

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
type TransitionalWorkbenchNoopCommand = MUiCommand & {
  id: "task.noop.run";
  action: "task:submit";
  risk: "medium";
  requiredPermissions: ["task:submit"];
  requiresPolicy: true;
  requiresAudit: true;
};
```

Transitional workbench rules:

- Visible UI text is Chinese for the transitional workbench; machine fields, permission names, event names, error codes, and component kinds remain English.
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
- Minimal policy summaries may show actor, action, resource, result, and createdAt; routes may use a bounded summary when a full `PolicyDecisionPanel` would expose unnecessary policy internals.
- Toasts, snackbars, modals, and hidden destructive controls remain forbidden.
- Mobile must remain usable through a single-column or vertically scrollable layout while the workbench structure remains open to later redesign.
- The transitional workbench uses manual refresh and command-after refresh only until a realtime UI transport is explicitly added to the contract.

---

## 6. Done Criteria

- Route schema validates before rendering.
- Unknown component kind fails closed.
- Missing permission hides or disables command with reason; the transitional workbench must prefer a visible disabled command explanation.
- High-risk command cannot bypass M-Policy.
- Component styling may be reworked independently as long as contract-relevant state remains visible, traceable, and not color-only.

---

## 7. Transitional Workbench Route Registry

The transitional workbench exposes an SDUI v0.2 registry, with `control-room.overview` as the primary operator entry route and supporting drill-down routes for operational work.

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

**Transitional workbench-specific expectations**:

- `AuditLedger`: Rendered inline in the primary surface when the actor has `audit:read`.
- `PolicyDecisionPanel`: Routes may show a minimal summary inline after command execution when full decision detail would expose unnecessary policy internals.
- `CommandWellPanel` executes `noop` on the overview route and also hosts approval/profile mutation flows on the approval-detail and profile-detail routes.
- Approval detail and profile detail keep confirmation, inline result evidence, and visible disabled reasons inside the CommandWell surface.
- Global profile default / switch / break-glass controls may appear as disabled control-plane-only UI and must not imply live data-plane mutation.

**Transitional workbench state sources**:

- Node list, service registry, session: authoritative (PostgreSQL via Core)
- Timeline entries: log projection (via Core)
- Audit entries: audit projection (via Core, post-filtered by BFF for `audit:read`)
- Command eligibility: derived from session permissions + node state (BFF, display-only)
- Policy decision summary: policy projection (via Core, trimmed by BFF)

---

## 8. Current SDUI v0.2 Route Set

The current SDUI v0.2 route set contains workbench routes with state source declarations and degraded state support. This route registry is the current transitional delivery surface for the future formal M-UI workbench.

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
| networks.index | NetworkListPanel, CommandWellPanel | authoritative, event |
| networks.detail | NetworkDetailPanel, TraceLink, CommandWellPanel | authoritative, event, log |
| nodes.credentials | NodeCredentialPanel, CommandWellPanel | authoritative, audit |
| mnet.dataplane.status | DataplaneStatusPanel, TraceLink | authoritative, event, audit |
| mnet.profile.migration | CommandWellPanel, TraceLink | authoritative, policy, audit |
| mnet.break-glass | CommandWellPanel, TraceLink | authoritative, audit |

### 8.3 Shared Components

`StateSourceBadge`, `RouteHeader`, `FilterBar`, `TraceLink`, `RawEnvelopeView`, `InlineOperationalAlert`, `AuditLedger`, `PolicyDecisionPanel`, `DecisionQueueSummary`, `ApprovalQueuePanel`, `ApprovalDetailPanel`, `NetworkProfileListPanel`, `NetworkProfileDetailPanel`, `OperationalCommandPreview`, `NetworkListPanel`, `NetworkDetailPanel`, `NodeCredentialPanel`, `DataplaneStatusPanel`.

### 8.4 Degraded State

Each route may declare `degradedState: { enabled: boolean; reason: string }`. When `enabled: true`, `InlineOperationalAlert` must render on the route surface; M-UI must not suppress degradation visibility.

### 8.5 Route Set Gates

- SDUI v0.2 contract tests verify all route IDs, component allowlist, forbidden kind rejection, state source presence.
- UI contract tests (`test:ui-contract`) enforce token-only styling, forbidden component names, BFF-only data boundary, CommandWell-only high-risk actions.
- BFF contract tests cover route registry, display data endpoints, generic command eligibility/execute, OpenAPI exposure.

### 8.6 Formal v0.2 Approval And Profile Routes

The following routes extend the SDUI v0.2 surface for the implemented approval/profile control-room workflows. The route registry, UI screens, and BFF/Core data flows are active for approval mutation, per-network profile mutation, and verified node-control CommandWell boundaries. M-Net `m-net-cn@0.2.0` data-plane work is incremental; route surfaces must only claim behavior backed by current contract/evidence gates.

#### 8.6.1 Route Registry Entries

```ts
const policyApprovalsRoute: MUiRouteSchema = {
  id: "policy.approvals",
  version: "v0",
  title: "审批队列",
  layout: "three-zone",
  requiredPermissions: ["policy:approval-read"],
  regions: {
    navigation: { kind: "NavRail" },
    primary: { kind: "ApprovalQueuePanel" },
    inspector: { kind: "KeyValueInspector" },
    commandWell: { kind: "CommandWellPanel" }
  },
  stateSources: ["policy", "audit"]
};

const policyApprovalsDetailRoute: MUiRouteSchema = {
  id: "policy.approvals.detail",
  version: "v0",
  title: "审批详情",
  layout: "three-zone",
  requiredPermissions: ["policy:approval-read"],
  regions: {
    navigation: { kind: "NavRail" },
    primary: { kind: "ApprovalDetailPanel" },
    inspector: { kind: "KeyValueInspector" },
    commandWell: { kind: "CommandWellPanel" }
  },
  stateSources: ["policy", "audit", "log"]
};

const networkProfilesRoute: MUiRouteSchema = {
  id: "network.profiles",
  version: "v0",
  title: "网络 Profile",
  layout: "three-zone",
  requiredPermissions: ["network:profile-read"],
  regions: {
    navigation: { kind: "NavRail" },
    primary: { kind: "NetworkProfileListPanel" },
    inspector: { kind: "KeyValueInspector" },
    commandWell: { kind: "CommandWellPanel" }
  },
  stateSources: ["authoritative", "policy", "audit"]
};

const networkProfilesDetailRoute: MUiRouteSchema = {
  id: "network.profiles.detail",
  version: "v0",
  title: "Profile 详情",
  layout: "three-zone",
  requiredPermissions: ["network:profile-read"],
  regions: {
    navigation: { kind: "NavRail" },
    primary: { kind: "NetworkProfileDetailPanel" },
    inspector: { kind: "KeyValueInspector" },
    commandWell: { kind: "CommandWellPanel" }
  },
  stateSources: ["authoritative", "policy", "audit", "log"]
};
```

#### 8.6.2 Route Summary

| Route ID | Title | Required Permissions | State Sources |
|---|---|---|---|
| policy.approvals | 审批队列 | policy:approval-read | policy, audit |
| policy.approvals.detail | 审批详情 | policy:approval-read | policy, audit, log |
| network.profiles | 网络 Profile | network:profile-read | authoritative, policy, audit |
| network.profiles.detail | Profile 详情 | network:profile-read | authoritative, policy, audit, log |

#### 8.6.3 Display-Only Commands

The following commands are `displayOnly: true`. They exist only for CommandWell eligibility display. They never carry an execute URL, never send requests to the backend, and their execute endpoint returns `400 command.display_only` if ever called.

```ts
type DisplayOnlyCommand = MUiCommand & {
  displayOnly: true;
  action: "display-only";
  state: "enabled" | "disabled";
  disabledReason?: string;
};

const displayOnlyCommands: DisplayOnlyCommand[] = [
  {
    id: "policy.approval.approve.preview",
    label: "批准",
    action: "display-only",
    resource: "policy:approval",
    risk: "high",
    requiredPermissions: ["policy:approval-read"],
    requiresPolicy: true,
    requiresAudit: true,
    displayOnly: true,
    state: "disabled",
    disabledReason: "仅展示命令资格，实际执行请使用 execute 命令"
  },
  {
    id: "policy.approval.reject.preview",
    label: "拒绝",
    action: "display-only",
    resource: "policy:approval",
    risk: "high",
    requiredPermissions: ["policy:approval-read"],
    requiresPolicy: true,
    requiresAudit: true,
    displayOnly: true,
    state: "disabled",
    disabledReason: "仅展示命令资格，实际执行请使用 execute 命令"
  },
  {
    id: "network.profile.enable.preview",
    label: "启用 Profile",
    action: "display-only",
    resource: "network:profile",
    risk: "high",
    requiredPermissions: ["network:profile-read"],
    requiresPolicy: true,
    requiresAudit: true,
    displayOnly: true,
    state: "disabled",
    disabledReason: "Profile 启用功能尚未启用"
  },
  {
    id: "network.profile.disable.preview",
    label: "禁用 Profile",
    action: "display-only",
    resource: "network:profile",
    risk: "critical",
    requiredPermissions: ["network:profile-read"],
    requiresPolicy: true,
    requiresAudit: true,
    displayOnly: true,
    state: "disabled",
    disabledReason: "Profile 禁用功能尚未启用"
  }
];
```

Display-only command rules:

- `displayOnly: true` commands must never carry an execute URL.
- BFF must never forward display-only command execute requests to any backend service.
- If `POST /api/v0/commands/:commandId/execute` receives a display-only command ID, BFF must return `400 command.display_only`.
- Display-only commands return visible Chinese disabled reasons when in disabled state.
- Display-only commands do not create Audit facts when disabled.

#### 8.6.4 Execute Command IDs

The following execute command IDs are active and routed through BFF to Core public facades:

| Command ID | Target Service | Core Facade | BFF Route |
|------------|---------------|-------------|-----------|
| `policy.approval.approve.execute` | M-Policy | `POST /api/v0/policy/approvals/:id/approve` | `POST /api/v0/commands/policy.approval.approve.execute/execute` |
| `policy.approval.reject.execute` | M-Policy | `POST /api/v0/policy/approvals/:id/reject` | `POST /api/v0/commands/policy.approval.reject.execute/execute` |
| `network.profile.enable.execute` | M-Net | `POST /api/v0/networks/:id/profile` | `POST /api/v0/commands/network.profile.enable.execute/execute` |
| `network.profile.disable.execute` | M-Net | `POST /api/v0/networks/:id/profile` | `POST /api/v0/commands/network.profile.disable.execute/execute` |
| `network.profile.default.set.execute` | M-Net | `PUT /api/v0/networks/profile-defaults` | `POST /api/v0/commands/network.profile.default.set.execute/execute` |
| `network.profile.switch.plan.execute` | M-Net | `POST /api/v0/networks/profile-switches/plan` | `POST /api/v0/commands/network.profile.switch.plan.execute/execute` |
| `network.profile.switch.apply.execute` | M-Net | `POST /api/v0/networks/profile-switches/:operationId/apply` | `POST /api/v0/commands/network.profile.switch.apply.execute/execute` |
| `network.profile.disable-policy.set.execute` | M-Net | `PUT /api/v0/networks/profile-disable-policy` | `POST /api/v0/commands/network.profile.disable-policy.set.execute/execute` |
| `network.profile.break-glass.disable.execute` | M-Net | `POST /api/v0/networks/:id/profile/disable-break-glass` | `POST /api/v0/commands/network.profile.break-glass.disable.execute/execute` |

Execute command rules:

- Execute commands use BFF → Core public facades only; BFF must not call `/internal/v0/*` routes.
- BFF validates execute body shape per command ID and fails closed with `400 command.invalid_body` on wrong-shaped bodies.
- Core error envelopes are preserved when forwarded to the UI.
- Success displays `correlationId`, `policyDecisionId`, and relevant IDs where the downstream command returns them; command success payloads are not a shared task envelope.
- Post-action refresh updates the relevant UI surface.
- No toast/snackbar. Chinese labels.

#### 8.6.5 controlPlaneOnly Warnings

Network profile commands must display a `controlPlaneOnly` warning when the profile carries `controlPlaneOnly: true`:

- Chinese: "配置变更仅影响控制平面，运行时数据面不受影响"
- English: "Configuration changes affect control plane only; runtime data plane is not affected"

The warning is displayed on:

- `network.profile.enable.execute` confirmation
- `network.profile.disable.execute` confirmation
- Network profile detail view when `controlPlaneOnly: true`

This warning is required because `m-net-cn@0.1.0` carries `controlPlaneOnly: true`. Operators must not expect runtime transport changes when enabling or disabling the CN profile.

### 8.7 M-Net Dataplane Routes

The following routes manage data-plane visibility, node credentials, and high-risk network operations.

#### 8.7.1 Route Summary

| Route ID | Title | Required Permissions | State Sources |
|---|---|---|---|
| networks.index | 数据面网络 | network:read | authoritative, event |
| networks.detail | 网络详情 | network:read | authoritative, event, log |
| nodes.credentials | 节点凭证 | core:read | authoritative, audit |
| mnet.dataplane.status | 数据面状态 | network:read | authoritative, event, audit |
| mnet.profile.migration | Profile 迁移 | network:profile-enable | authoritative, policy, audit |
| mnet.break-glass | 紧急预案 (Break-glass) | network:profile-disable | authoritative, audit |

#### 8.7.2 High-Risk Command UI Rules

- `mnet.break-glass` and `mnet.profile.migration` operations are **CommandWell-only**. They do not have inline action buttons.
- All destructive actions (e.g., breaking glass, rolling back migration, revoking credentials) must present a confirmation step in the CommandWell.
- Confirmation copy must be in Chinese.
- Disabled controls must show a Chinese reason (e.g., "缺少权限" or "状态不允许").
- High-risk operations must pass through M-Policy and write Audit logs.
