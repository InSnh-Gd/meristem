# ADR-U01: SDUI Runtime Renderer Migration Path

## Status

Proposed — ADR / contract migration path only. This ADR does not authorize runtime
renderer implementation, new dependencies, BFF layout directives, or service- /
plugin-supplied UI.

## Context

The current SDUI v0.2 surface is a route/component registry:

- `SduiV02RouteRegistry` has `schemaVersion: "sdui@0.2.0"`, route metadata,
  state-source declarations, degraded-state metadata, and component references.
- The M-UI BFF decodes the registry at startup before publishing `GET
  /api/v0/routes`.
- M-UI owns Svelte route surfaces, component structure, interaction flow, and the
  `layout / modules / ui` split.
- The BFF adapts UI-facing facts and display eligibility; it does not own final
  facts, authorization, policy decisions, or UI structure.
- Capability domain services, M-Extension, and plugins do not supply pages, components,
  layouts, or runtime frontend modules.

Ponytail challenge: SDUI runtime rendering does **not** need to exist today. The
v0.2 registry is sufficient for the active Transitional Workbench because it
records route inventory, component-kind contracts, required permissions,
state-source visibility, and fail-closed schema validation while keeping render
ownership inside M-UI.

The v0.2 registry becomes insufficient only if Meristem deliberately needs a
versioned contract where route layout, region placement, component inputs, and
CommandWell action references cross time/runtime boundaries and are interpreted
by M-UI at render time. That condition is not yet proven. The safe path is to
define the smallest possible v0.3 migration contract, keep it gated, and make
rollback to v0.2 trivial.

Open questions that must be answered before implementation approval:

1. Which operator workflow cannot be handled by M-UI-owned Svelte routes plus
   v0.2 registry reconciliation tests?
2. Which route is the first read-only runtime-rendering pilot, and why is static
   ownership insufficient for it?
3. What measurable drift or delivery cost justifies runtime interpretation risk?

## Decision

Keep SDUI v0.2 as the implemented contract registry. Define SDUI v0.3 as a
future, opt-in, versioned contract migration for runtime rendering, with these
hard gates:

1. v0.3 remains blocked until this ADR or a successor is accepted.
2. v0.3 implementation requires contract schema changes, BFF contract tests,
   M-UI renderer tests, failure-mode tests, and security review before any route
   consumes it.
3. v0.3 may render only M-UI-owned components from an allowlist. It may not load
   remote Svelte, HTML, JavaScript, CSS, Wasm, plugin bundles, or service-provided
   frontend modules.
4. v0.3 may reference only action IDs from an allowlist. Executable actions still
   flow through CommandWell and BFF → Core public facades; final authorization
   remains in Core / M-Policy, and audit facts remain in M-Log / Audit Log.
5. Unknown components, unknown actions, schema decode failures, and missing
   state-source metadata fail closed before rendering or execution.
6. v0.2 remains the default until v0.3 has a compatibility window, rollback plan,
   and green old/new contract gates.

## v0.3 Runtime Schema

The future v0.3 contract must be introduced as a new schema, not by mutating the
meaning of `SduiV02RouteRegistry`.

Minimum candidate shape:

```ts
type SduiV03RuntimeRegistry = {
  schemaVersion: "sdui@0.3.0";
  mode: "runtime-renderer";
  componentAllowlistVersion: string;
  actionAllowlistVersion: string;
  routes: SduiV03RuntimeRoute[];
};

type SduiV03RuntimeRoute = {
  id: string;
  title: string;
  requiredPermissions: string[];
  stateSources: Array<"authoritative" | "event" | "cache" | "read-model" | "log" | "audit" | "policy">;
  degradedState: { enabled: boolean; reason: string };
  layout: {
    kind: "workbench-three-zone" | "single-column";
    regions: {
      primary: SduiV03ComponentRef[];
      inspector?: SduiV03ComponentRef[];
      commandWell?: SduiV03ComponentRef[];
    };
  };
};

type SduiV03ComponentRef = {
  id: string;
  kind: SduiV03ComponentKind;
  dataRef?: string;
  actions?: SduiV03ActionRef[];
};

type SduiV03ActionRef = {
  id: SduiV03ActionId;
  surface: "CommandWell" | "display-only";
  risk: "low" | "medium" | "high" | "critical";
  requiredPermissions: string[];
  requiresPolicy: boolean;
  requiresAudit: boolean;
};
```

Schema rules:

- `schemaVersion` is fixed to `sdui@0.3.0`; v0.2 and v0.3 decode through
  separate schemas.
- `mode` prevents v0.3 data from being mistaken for the v0.2 registry.
- `componentAllowlistVersion` and `actionAllowlistVersion` identify the exact
  allowlist used for decoding and tests.
- `layout.kind` is intentionally narrow; no arbitrary CSS grid strings, remote
  templates, or scriptable layout expressions.
- `dataRef` is a reference to BFF-owned, schema-decoded display data; it is not a
  query language and cannot point to Core internal routes.
- Component props, if later needed, must be typed per component kind and decoded
  by Effect Schema before render. Arbitrary `Record<string, unknown>` props are
  not allowed.

## Schema Validation

Validation must happen at both boundaries:

1. BFF startup / publish boundary decodes the complete v0.3 registry before it
   can be exposed.
2. M-UI route-load boundary decodes the complete v0.3 registry before it can
   render.

Decode failures are fail-closed:

- BFF must not publish malformed v0.3 data as a successful runtime registry.
- M-UI must not partially render a malformed route.
- The operator sees a degraded inline error state, not a toast/snackbar and not a
  fallback that silently drops security-relevant components.

## Component Allowlist

The v0.3 component allowlist starts from the safe v0.2 component kinds and must
remove any kind that is not actually implemented by M-UI-owned Svelte modules.

Allowlist gates:

- Unknown component kind fails schema decode.
- Forbidden kinds (`Toast`, `Snackbar`, `DecorativeCard`, `MarketingBanner`,
  `Confetti`, `Carousel`, `FloatingActionButton`,
  `UnscopedDropdownActionMenu`, `UnlabeledDestructiveIconButton`) remain
  rejected.
- M-Extension and plugins cannot extend this allowlist in v0.3.
- Every allowed component has an M-UI-owned implementation, a route-render test,
  and a registry↔renderer reconciliation assertion.

## Action Allowlist

The v0.3 action allowlist is separate from the component allowlist.

Action gates:

- Unknown action ID fails schema decode.
- Display-only actions must not carry execute URLs and must not call BFF execute
  routes.
- Executable actions must use CommandWell confirmation before execution.
- `high` and `critical` actions require `requiresPolicy: true` and
  `requiresAudit: true`.
- BFF maps action IDs only to known Core public facades. No `/internal/v0/*`
  routes, arbitrary URLs, or service/plugin callbacks.
- Disabled actions show visible Chinese reasons and create no Audit facts.

## Versioning And Migration From v0.2 Registry

This is a breaking contract migration because v0.3 changes route semantics from
inventory/validation to runtime interpretation.

Migration plan:

1. Keep v0.2 as the default `GET /api/v0/routes` contract.
2. Add v0.3 only behind a new explicit contract version or opt-in endpoint after
   acceptance; do not change the meaning of v0.2 fields.
3. Derive initial v0.3 routes from v0.2 route IDs, titles, permissions,
   stateSources, degradedState, and component refs.
4. Add explicit `layout` placement only where the current M-UI page already
   renders that structure; the static page remains the authority during the
   migration.
5. Pilot a read-only route first. CommandWell routes migrate only after read-only
   validation, reconciliation, and fail-closed tests are green.
6. Keep old and new schema decode/encode tests green during the compatibility
   window.

Compatibility window:

- v0.2 remains supported for at least one Meristem minor release after v0.3 is
  accepted and first enabled by default.
- During the window, M-UI can fall back to v0.2 static routes if v0.3 decode or
  security gates fail.
- Consumers must not assume Core, BFF, M-UI, and contract package versions are
  deployed in lockstep.

## Rollback

Rollback must be operationally cheap:

- Disable the v0.3 opt-in flag or stop serving the v0.3 endpoint.
- M-UI returns to v0.2 registry + static Svelte routes.
- BFF keeps publishing the v0.2 registry.
- No database migration or service-owned UI artifact is required to roll back.
- Any v0.3-only route must have a documented static fallback before becoming
  default.

## Security Gates

Runtime rendering may proceed only if all gates are explicit and tested:

- Component allowlist: closed enum, no remote code, no plugin/service extension.
- Action allowlist: closed enum, CommandWell-only execution, no arbitrary URLs.
- Auditability: enabled high/critical commands write Audit facts through the
  existing M-Log / Audit boundary; disabled commands write none.
- Policy boundary: UI/BFF eligibility is display-only; Core / M-Policy remains
  final authorization.
- Unknown handling: unknown components/actions and decode failures fail closed.
- State-source visibility: critical state keeps `authoritative`, `event`,
  `cache`, `read-model`, `log`, `audit`, or `policy` provenance visible.
- Ownership: M-UI owns render structure; BFF adapts display data; services and
  plugins do not own UI structure.

## Tests

Required gates before implementation can be claimed:

- Contract: v0.2 and v0.3 Effect Schema decode/encode tests; unknown
  component/action rejection; forbidden component rejection.
- Migration: v0.2 registry fixtures convert to v0.3 candidate fixtures without
  changing route authority or permissions.
- UI contract: registry↔renderer reconciliation, route-render smoke tests,
  visible degraded-state checks, no forbidden component kinds.
- Failure-mode: BFF v0.3 decode failure, M-UI v0.3 decode failure, unknown
  component/action, and policy/audit unavailable paths fail closed.
- Security: no M-UI → Core direct fetch, no BFF `/internal/v0/*` calls for
  actions, high/critical action policy/audit assertions.

Focused commands expected for the first implementation PR:

```bash
bun run test:ui-contract
bun run test:contracts
bun run test:failure-modes
bun run typecheck
bun run typecheck:m-ui
```

## Acceptance Scenarios

Scenario: v0.2 remains the default registry

Given an M-UI build that consumes `GET /api/v0/routes`
And the BFF publishes `schemaVersion: "sdui@0.2.0"`
When v0.3 ADR work exists but no accepted migration implementation exists
Then M-UI keeps rendering static M-UI-owned Svelte routes
And no BFF runtime layout directive is required

Test mapping:
- contract: `tests/ui-contract/m-ui-component-contract.test.ts`
- Gate: `bun run test:ui-contract`

Scenario: unknown runtime component fails closed

Given a future v0.3 registry containing a component kind outside the allowlist
When BFF or M-UI decodes the registry
Then schema validation rejects the route before rendering
And the operator sees a degraded inline error rather than a partially rendered
surface

Test mapping:
- contract: future v0.3 schema decode test beside current SDUI contract tests
- failure-mode: future M-UI route-load decode failure test
- Gate: `bun run test:ui-contract`
- Gate: `bun run test:failure-modes`

Scenario: unknown runtime action fails closed

Given a future v0.3 registry containing an action ID outside the action allowlist
When the route is decoded
Then schema validation rejects the action before CommandWell can execute it
And no Core, M-Policy, or Audit request is sent

Test mapping:
- contract: future v0.3 action allowlist decode test
- failure-mode: future BFF command execution guard test
- Gate: `bun run test:contracts`
- Gate: `bun run test:failure-modes`

Scenario: high-risk runtime action preserves policy and audit boundaries

Given a future v0.3 route references a high-risk CommandWell action
And the actor has display eligibility in the BFF response
When the actor confirms the action
Then execution still flows through BFF → Core public facade → M-Policy / M-Log
And the UI displays policy and audit evidence from the response

Test mapping:
- e2e: future BFF/Core command path coverage for migrated route
- failure-mode: policy unavailable and Audit unavailable fail-closed tests
- Gate: `bun run test:e2e`
- Gate: `bun run test:failure-modes`

## Consequences

This ADR keeps the current workbench simple: no runtime renderer exists until a
specific workflow proves the v0.2 registry is insufficient. It also prevents a
future renderer from becoming a back door for service-owned UI, plugin-delivered
frontend modules, arbitrary command URLs, or hidden destructive actions.

The cost is that any real v0.3 implementation must do more contract work up
front: old/new schema tests, explicit allowlists, route reconciliation, and
failure-mode coverage. That cost is intentional because runtime rendering moves
UI structure from compiled Svelte routes into a cross-time contract.

## Revisit When

Reopen this ADR when any of the following is true:

- A named operator workflow cannot be delivered safely with M-UI-owned Svelte
  routes plus v0.2 registry reconciliation.
- Registry↔renderer drift remains high after static reconciliation tests are
  added.
- Plugin UI work proposes extending SDUI runtime rendering; that must remain a
  separate ADR/security track and cannot silently reuse this ADR as approval.
- A v0.3 implementation PR is ready; it must update this ADR or supersede it
  with accepted schema, endpoint, rollout, and rollback details.
