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
  | "NodeMap"
  | "ServiceRegistryTable"
  | "TimelineStream"
  | "AuditLedger"
  | "PolicyDecisionPanel"
  | "CommandWell"
  | "ConfigLifecycleStepper"
  | "TraceLink"
  | "RawEnvelopeView"
  | "InlineOperationalAlert"
  | "KeyValueInspector"
  | "EventStreamTable";
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
};
```

Rules:

- `risk: "high" | "critical"` requires `requiresPolicy: true`.
- `risk: "high" | "critical"` requires `requiresAudit: true`.
- A command must display impact summary before execution.
- Destructive commands must never be icon-only.

---

## 5. Done Criteria

- Route schema validates before rendering.
- Unknown component kind fails closed.
- Missing permission hides or disables command with reason.
- High-risk command cannot bypass M-Policy.
- Component token usage follows `MERISTEM-DESIGN.md`.
