# M-UI Structure and Test Gap Audit

> Wave 1 Task 2 of the M-UI Transitional Workbench Design Activation Plan.
>
> This is a **read-only audit**. It inventories the current M-UI Transitional
> Workbench surface, records drift between docs/contract/code, and defines the
> minimum test foundation required before any future `layout / modules / ui`
> restructuring. It does **not** restructure components, add tests, or decide
> local layout or component API details. Implementation details remain deferred
> until design convergence (see §8).

---

## 1. Executive Summary

The M-UI Transitional Workbench is a SvelteKit 5 application that consumes an
M-UI BFF SDUI v0.2 route registry and renders operator surfaces for orientation,
investigation, controlled action, and traceability.

Current state at audit time:

- **18 SvelteKit page routes** under `apps/m-ui/src/routes/` (plus one shared
  `+layout.svelte`). The BFF SDUI v0.2 registry publishes **17 route entries**;
  the root `/` landing page has no SDUI route id.
- **27 Svelte components** flat under `apps/m-ui/src/lib/components/`. Of these,
  23 map to SDUI-registered component kinds and **4 are internal utilities** not
  present in the SDUI kind allowlist (`GlobalProfileControls`, `JoinTicketPanel`,
  `NavRail`, `TokenInput`).
- **4 SDUI-registered kinds have no backing `.svelte` file**
  (`NodeListPanel`, `NodeDetailPanel`, `ServiceListPanel`, `TimelinePanel`).
- The BFF client (`bff.ts`) exposes **24 endpoint methods** plus 3 helpers, all
  routed through the M-UI BFF at `localhost:3200`. M-UI does **not** call Core or
  M-* services directly — the `M-UI → M-UI BFF → Core public facade → M-*`
  boundary is preserved.
- The app state store (`stores.svelte.ts`) is a single Svelte 5 runes-based
  `AppState` class holding session, domain, and command state with per-domain
  loading/error flags.
- The SDUI route registry is consumed **for navigation labels only**. The
  per-route `components` inventory and `stateSources` fields are validated by
  contract tests but are **not** used by M-UI to drive rendering; each page
  hand-picks components and hardcodes its own `stateSources` on `RouteHeader`.
- **No Svelte component or route render tests exist.** `apps/m-ui/package.json`
  has no test script, no vitest, and no component-testing library. All 15
  existing test files are BFF/contract/boundary/failure-mode/e2e tests against
  the BFF or Core; none mount a Svelte component.

The audit confirms the plan's drift findings (§6) and concludes that a
**minimum test foundation must be established before any `layout / modules / ui`
file restructuring** (§7). All structural and component-API decisions remain
gated behind design convergence.

---

## 2. Route Inventory

Source: `apps/m-ui/src/routes/**/+page.svelte` (18 pages) and
`+layout.svelte` (shared shell). BFF registry source:
`services/m-ui-bff/src/routes/route-registry.ts` (17 entries).

| # | SvelteKit Path | SDUI Route ID | Registry Entry | Required Permissions | State Sources | Notes |
|---|---|---|---|---|---|---|
| 1 | `/` | — (none) | — | — | — | Landing/root page; no SDUI route id |
| 2 | `/control-room` | `control-room.overview` | yes | core:read, timeline:read | authoritative, event, log, audit | Primary operator entry |
| 3 | `/nodes` | `nodes.index` | yes | core:read | authoritative, event | Uses inline table, not `NodeListPanel` |
| 4 | `/nodes/[id]` | `nodes.detail` | yes | core:read | authoritative, event, log | |
| 5 | `/nodes/[id]/credentials` | `nodes.credentials` | yes | core:read | authoritative, audit | |
| 6 | `/timeline` | `timeline.index` | yes | timeline:read | event, log | Only page rendering `TraceLink` |
| 7 | `/audit` | `audit.index` | yes | audit:read | audit | Declares `TraceLink`, does not render it |
| 8 | `/policy/decisions` | `policy.decisions` | yes | core:read | policy, audit | |
| 9 | `/policy/approvals` | `policy.approvals` | yes | policy:approval-read | policy, audit | |
| 10 | `/policy/approvals/[id]` | `policy.approvals.detail` | yes | policy:approval-read | policy, audit, log | Inline CommandWell, no `TraceLink` render |
| 11 | `/network/profiles` | `network.profiles` | yes | network:profile-read | authoritative, policy, audit | |
| 12 | `/network/profiles/[profileVersion]` | `network.profiles.detail` | yes | network:profile-read | authoritative, policy, audit, log | Inline CommandWell, no `TraceLink` render |
| 13 | `/networks` | `networks.index` | yes | network:read | authoritative, event | |
| 14 | `/networks/[id]` | `networks.detail` | yes | network:read | authoritative, event, log | No `TraceLink` render |
| 15 | `/services` | `services.index` | yes | core:read | authoritative | |
| 16 | `/mnet/dataplane-status` | `mnet.dataplane.status` | yes | network:read | authoritative, event, audit | No `TraceLink` render |
| 17 | `/mnet/profile-migration` | `mnet.profile.migration` | yes | network:profile-enable | authoritative, policy, audit | No `TraceLink` render |
| 18 | `/mnet/break-glass` | `mnet.break-glass` | yes | network:profile-disable | authoritative, audit | No `TraceLink` render |

Totals: **18 SvelteKit pages**, **1 layout**, **17 SDUI registry entries**.

### 2.1 SDUI Route Registry Consumption

`appState.routes` (populated by `fetchRoutes` → `GET /api/v0/routes`) is read in
exactly one place: `+layout.svelte`. It maps route id → SvelteKit path via a
hardcoded `ROUTE_PATH_MAP` (12 of 18 routes; dynamic detail routes are excluded)
and feeds `NavRail` with `{ id, label: route.title, path }`.

The registry's per-route `components` array and `stateSources` list are **not**
consumed by the renderer. Each page independently imports the components it
needs and passes a hardcoded `stateSources` array to `RouteHeader`. The registry
therefore functions as a **navigation label source and a contract-test
artifact**, not as a runtime composition directive. This is consistent with the
"SDUI is a contract registry, not a runtime renderer" ownership rule, but it
means the registry and the actual rendered component sets can drift silently
(see §6).

---

## 3. Component Inventory

Source: `apps/m-ui/src/lib/components/*.svelte` (27 files). SDUI kind allowlist
source: `docs/ui/SDUI-SCHEMA.md` §2 (27 kinds).

### 3.1 Components Mapped to SDUI-Registered Kinds (23)

| Component File | SDUI Kind | Used By Route(s) |
|---|---|---|
| `ApprovalDetailPanel.svelte` | ApprovalDetailPanel | policy.approvals.detail |
| `ApprovalQueuePanel.svelte` | ApprovalQueuePanel | policy.approvals |
| `AuditLedger.svelte` | AuditLedger | audit.index |
| `CommandWell.svelte` | CommandWellPanel | control-room.overview, networks.index, networks.detail, nodes.credentials, mnet.profile.migration, mnet.break-glass |
| `DataplaneStatusPanel.svelte` | DataplaneStatusPanel | mnet.dataplane.status |
| `DecisionQueueSummary.svelte` | DecisionQueueSummary | policy.decisions, policy.approvals |
| `FilterBar.svelte` | FilterBar | nodes.index, timeline.index |
| `InlineOperationalAlert.svelte` | InlineOperationalAlert | control-room.overview, network.profiles |
| `KeyValueInspector.svelte` | KeyValueInspector | nodes.index, nodes.detail, services.index |
| `NetworkDetailPanel.svelte` | NetworkDetailPanel | networks.detail |
| `NetworkListPanel.svelte` | NetworkListPanel | networks.index |
| `NetworkProfileDetailPanel.svelte` | NetworkProfileDetailPanel | network.profiles.detail |
| `NetworkProfileListPanel.svelte` | NetworkProfileListPanel | network.profiles |
| `NodeCredentialPanel.svelte` | NodeCredentialPanel | nodes.credentials |
| `NodeMap.svelte` | NodeMap | control-room.overview |
| `OperationalCommandPreview.svelte` | OperationalCommandPreview | policy.approvals, policy.approvals.detail, network.profiles.detail |
| `PolicyDecisionPanel.svelte` | PolicyDecisionPanel | policy.decisions |
| `RawEnvelopeView.svelte` | RawEnvelopeView | nodes.detail, audit.index, policy.approvals.detail |
| `RouteHeader.svelte` | RouteHeader | every page |
| `ServiceRegistryTable.svelte` | ServiceRegistryTable | control-room.overview, services.index |
| `StateSourceBadge.svelte` | StateSourceBadge | used inside RouteHeader/panels |
| `TimelineStream.svelte` | TimelineStream | control-room.overview, nodes.detail, timeline.index |
| `TraceLink.svelte` | TraceLink | timeline.index only |

### 3.2 Internal Utility Components (not in SDUI allowlist) (4)

| Component File | Role | Registered? |
|---|---|---|
| `GlobalProfileControls.svelte` | Global profile default/switch/break-glass control surface | No — present in code, absent from kind allowlist |
| `JoinTicketPanel.svelte` | Network join-ticket list surface | No — present in code, absent from kind allowlist |
| `NavRail.svelte` | Left navigation rail (consumes registry route list) | No — navigation chrome, not an SDUI content kind |
| `TokenInput.svelte` | JWT/Authorization-header input + bearer normalization | No — session chrome, not an SDUI content kind |

### 3.3 Registered Kinds With No Backing Component (4 orphans)

| SDUI Kind | In Registry? | Backing `.svelte`? | Actual Renderer |
|---|---|---|---|
| `NodeListPanel` | yes (nodes.index) | **No file** | `nodes/+page.svelte` inline table |
| `NodeDetailPanel` | no (allowlist only) | **No file** | `nodes/[id]/+page.svelte` uses KeyValueInspector + TimelineStream + RawEnvelopeView |
| `ServiceListPanel` | no (allowlist only) | **No file** | `services/+page.svelte` uses ServiceRegistryTable |
| `TimelinePanel` | no (allowlist only) | **No file** | `TimelineStream` is used instead |

### 3.4 Structure

All 27 components live flat under `apps/m-ui/src/lib/components/`. There is **no
`layout / modules / ui` split** today. The shell layout is encoded inline in
`+layout.svelte` (grid: header + nav-rail + primary). Per-page layout decisions
are made inline in each `+page.svelte`.

---

## 4. BFF Endpoint Use Summary

Source: `apps/m-ui/src/lib/bff.ts`. Base URL: `http://localhost:3200`. All calls
carry `Authorization: Bearer <token>` (normalized via
`normalizeBearerTokenInput`) and `content-type: application/json`.

### 4.1 Endpoint Methods (24)

| Method | BFF Path | Store Consumer | Purpose |
|---|---|---|---|
| `fetchOverview` | `GET /api/v0/overview` | `refresh` | Session actor, permissions, audit accessibility |
| `fetchRoutes` | `GET /api/v0/routes` | `fetchRoutes` | SDUI v0.2 route registry (nav labels) |
| `fetchNodes` | `GET /api/v0/nodes` | `fetchNodes` | Node list |
| `fetchTimeline` | `GET /api/v0/timeline` | `fetchTimeline` | Timeline log projection |
| `fetchAudit` | `GET /api/v0/audit` | `fetchAudit` | Audit entries (gated by `auditAccessible`) |
| `fetchPolicyDecisions` | `GET /api/v0/policy/decisions` | `fetchPolicyDecisions` | Policy decision list |
| `fetchServices` | `GET /api/v0/services` | `fetchServices` | Service registry list |
| `fetchServiceDetail` | `GET /api/v0/services/:id` | — (available, not wired into store) | Service inspector detail |
| `fetchCommandEligibility` | `POST /api/v0/commands/:id/eligibility` | `selectNode` via `fetchCommandState` | Display-only command eligibility |
| `fetchCommandState` | wraps `fetchCommandEligibility` for `task.noop.submit` | `selectNode` | Noop command state for selected node |
| `executeCommand` | `POST /api/v0/commands/:id/execute` | `executeGenericCommand` | Generic command execution |
| `executeNoop` | wraps `executeCommand` for `task.noop.submit` | — (available) | Noop task execution |
| `fetchPolicySummary` | `GET /api/v0/policy/decisions/:id/summary` | `fetchPolicySummary` | Bounded policy summary after execution |
| `fetchApprovalQueue` | `GET /api/v0/policy/approvals` | `fetchApprovalQueue` | Approval queue |
| `fetchApprovalDetail` | `GET /api/v0/policy/approvals/:id` | `fetchApprovalDetail` | Approval detail |
| `fetchNetworkProfiles` | `GET /api/v0/network-profiles` | `fetchNetworkProfiles` | Network profile list |
| `fetchNetworkProfileDetail` | `GET /api/v0/network-profiles/:version` | `fetchNetworkProfileDetail` | Profile detail |
| `fetchNetworks` | `GET /api/v0/networks` | `fetchNetworks` | Network list |
| `fetchNetworkDetail` | `GET /api/v0/networks/:id` | `fetchNetworkDetail` | Network detail |
| `fetchNetworkJoinTickets` | `GET /api/v0/networks/:id/join-tickets` | `fetchJoinTickets` | Join tickets |
| `fetchDataplaneStatus` | `GET /api/v0/networks/:id/dataplane/status` | `fetchDataplaneStatus` | Dataplane status |
| `fetchNetworkMapSummary` | `GET /api/v0/networks/:id/dataplane/network-map` | — (available, not wired into store) | Network map summary |
| `fetchGlobalDefaults` | `GET /api/v0/networks/defaults` | `fetchGlobalDefaults` | Global profile defaults |
| `fetchMigrationStatus` | `GET /api/v0/networks/profile-switches/:opId` | — (available, not wired into store) | Profile-switch migration status |

### 4.2 Helpers (3)

- `normalizeBearerTokenInput` — strips a leading `Bearer ` so curl/CLI-pasted
  Authorization headers do not produce `Bearer Bearer <jwt>` 401s.
- `formatBffError` — restores the Core/BFF error envelope to a readable UI
  message, preserving `code` and `correlationId` so 401s are not swallowed into
  a generic failure.
- `bffFetch<T>` — generic typed fetch wrapper that injects auth headers, parses
  the error envelope on non-OK, and returns typed JSON. Uses `body as T` on the
  success path (a localized client-side cast at the BFF boundary; the BFF itself
  is the contract-decoded boundary).

### 4.3 Boundary Observation

M-UI calls only the M-UI BFF. No direct Core or M-* calls exist in `bff.ts`.
The data-flow ownership rule `M-UI → M-UI BFF → Core public facade → M-*` is
preserved at the client layer. Three endpoint methods (`fetchServiceDetail`,
`fetchNetworkMapSummary`, `fetchMigrationStatus`) are exported but not wired
into the `AppState` store, indicating available-but-unused BFF surface.

---

## 5. App State Store Responsibilities

Source: `apps/m-ui/src/lib/stores.svelte.ts` — a single `AppState` class
exported as the `appState` singleton, built on Svelte 5 runes (`$state`,
`$derived`).

### 5.1 Responsibilities

- **Session state**: `token` (seeded from `PUBLIC_MERISTEM_DEFAULT_TOKEN`),
  derived `actor` and `permissions` from `overview.session`.
- **Global load/error**: `loading`, `error` (single global channel for the
  refresh flow; per-domain channels exist for detail fetches).
- **Domain data caches**: `overview`, `routes`, `nodes`, `timeline`, `audit`,
  `policyDecisions`, `services`, `approvalQueue`, `selectedApproval`,
  `networkProfiles`, `selectedProfile`, `networks`, `selectedNetwork`,
  `joinTickets`, `dataplaneStatus`, `globalDefaults`.
- **Per-domain loading/error flags** for approval queue/detail, profile
  list/detail, network list/detail, join tickets, global defaults.
- **Command surface**: `commandState`, `commandParams`, `taskResult`,
  `commandConfirming`, `policySummary`. `selectNode` fetches noop eligibility;
  `executeGenericCommand` posts through BFF and refreshes policy summary.
- **Derived selectors**: `actor`, `permissions`, `auditEntries` (falls back to
  overview audit when the audit endpoint is inaccessible), `selectedNode`
  (resolved across `nodes` and `overview.nodes`).
- **Orchestration**: `refresh()` fetches overview then fans out parallel fetches
  (routes, nodes, timeline, services, policy decisions, conditionally audit)
  and maps errors through `formatBffError`. All fetch methods short-circuit when
  `token` is empty.

### 5.2 Observations

- The store is the sole BFF consumer; no page fetches directly.
- `fetchDataplaneStatus` and `fetchGlobalDefaults` swallow errors silently
  (`catch { // ignore }`), which can mask degraded BFF paths from the operator.
  This is a candidate for the degraded-BFF test foundation (§7).
- The store mixes session chrome, domain caches, and command state in one class.
  This is acceptable for the transitional surface but is a structural seam that
  future `layout / modules / ui` mapping must account for.

---

## 6. Drift Findings

Each drift is rated by severity and mapped to its plan/contract implication.
Severity legend: **High** = breaks operator traceability or contract truth;
**Medium** = silent inconsistency between docs/code/registry; **Low** = hygiene
or unused surface.

| # | Drift | Severity | Implication |
|---|---|---|---|
| D1 | `docs/ui/SDUI-SCHEMA.md` §1–§7 documents the legacy `MUiRouteSchema` shape (`regions`/`layout`/`version`), while the actual BFF registry and §8 use `SduiV02Route` (`components`/`stateSources`/`degradedState`). The doc carries both shapes side by side. | Medium | The doc is internally contradictory. A reader following §1 will model routes with `regions`, which the BFF no longer emits. Contract migration must reconcile §1–§7 with §8 or mark the legacy shape as superseded. Deferred to the Wave 5 docs/contracts sync task. |
| D2 | 7 routes declare `TraceLink` in the BFF registry but do not render it: `audit.index`, `networks.detail`, `mnet.dataplane.status`, `mnet.profile.migration`, `mnet.break-glass`, `policy.approvals.detail`, `network.profiles.detail`. Only `timeline.index` renders `TraceLink`; `nodes.index` declares it but is covered by D3. | High | Traceability is a required experience layer. Declaring `TraceLink` in the contract without rendering it breaks the trace-after-action loop and makes the registry a non-truthful description of the surface. Must be reconciled (render the component or remove the declaration) during structure mapping — but not in this audit. |
| D3 | `NodeListPanel` is in the SDUI kind allowlist and the BFF registry (`nodes.index`) but no `NodeListPanel.svelte` file exists. `nodes/+page.svelte` renders an inline table instead. | High | The registry advertises a component kind that has no implementation. Contract tests validate the kind name but the rendered surface diverges. Resolve by either creating the component or remapping the registry — deferred to structure mapping. |
| D4 | `policy/approvals/[id]` and `network/profiles/[profileVersion]` render inline `<section class="command-well-panel">` markup with bespoke confirm/result UI instead of importing the shared `CommandWell.svelte`. Six other routes do use the shared component. | Medium | CommandWell behavior (confirmation, disabled reasons, inline error envelope, post-action refresh) is duplicated and can diverge per route. The contract requires high-risk commands to be CommandWell-only; inline reimplementations risk breaking the consistency invariant. Converge onto the shared component during structure mapping. |
| D5 | `GlobalProfileControls.svelte` and `JoinTicketPanel.svelte` exist as components but are not registered as SDUI component kinds and are absent from the kind allowlist. | Medium | These are real UI surfaces (profile controls, join tickets) operating outside the SDUI registry. Either they should be registered with a kind, or they should be classified as internal chrome like `NavRail`/`TokenInput`. The current state leaves them unclassified. |
| D6 | No `layout / modules / ui` split exists. All 27 components are flat under `apps/m-ui/src/lib/components/`; the shell layout is inline in `+layout.svelte`; per-page layout is inline in each `+page.svelte`. | Low | This is the expected transitional state, not a defect. It is recorded here because it is the primary target of the future structure-mapping task (Wave 4 Task 7). No action in this audit. |
| D7 | Three additional SDUI kinds are in the allowlist but have no backing `.svelte` file: `NodeDetailPanel`, `ServiceListPanel`, `TimelinePanel`. The surface uses `KeyValueInspector`/`TimelineStream`/`ServiceRegistryTable` instead. | Medium | Orphan kinds inflate the allowlist and mislead contract readers. They should be removed from the allowlist or backed by components. Deferred to contract/docs sync. |
| D8 | `RouteHeader` receives a hardcoded `stateSources` array per page rather than reading the registry's `stateSources`. The registry's state-source declarations are validated only by contract tests, not by the renderer. | Medium | State-source visibility (a required workbench rule) is driven by page code, not by the contract. If a page's hardcoded array diverges from the registry, the operator sees a stale source label. Reconcile during structure mapping. |
| D9 | Three BFF endpoint methods (`fetchServiceDetail`, `fetchNetworkMapSummary`, `fetchMigrationStatus`) are exported from `bff.ts` but not wired into `AppState`. | Low | Available-but-unused BFF surface. Not a defect, but indicates the client exposes more than the UI consumes. No action in this audit. |
| D10 | `fetchDataplaneStatus` and `fetchGlobalDefaults` in the store swallow errors silently (`catch { // ignore }`). | Medium | Degraded BFF paths for dataplane/global-defaults are invisible to the operator, conflicting with the degraded-state visibility rule. This is a concrete target for the degraded-BFF test foundation (§7). |

---

## 7. Test Coverage Summary

> Historical note: this section was originally a pre-foundation audit snapshot.
> The summary below reflects the runner split at the time this reference was
> retained, but current task requirements and active tests are authoritative.

Source: `tests/` and `apps/m-ui/`. M-UI-related testing now spans repo-root Bun
contract/ui-contract suites plus `apps/m-ui` Vitest runtime/component suites.

### 7.1 Existing Test Inventory

| Category | File | What It Covers |
|---|---|---|
| contract | `tests/contracts/m-ui-bff.routes.test.ts` | BFF route registry endpoints |
| contract | `tests/contracts/m-ui-bff.command-well.test.ts` | BFF command-well endpoint contract |
| contract | `tests/contracts/m-ui-sdui-v02.contract.test.ts` | SDUI v0.2 route/component/state-source contract |
| contract | `tests/contracts/m-ui-token-input.test.ts` | Token normalization helper |
| contract | `tests/contracts/m-ui-command-well.test.ts` | Command-well contract |
| contract | `tests/contracts/m-ui-bff.overview.test.ts` | BFF overview endpoint |
| contract | `tests/contracts/m-ui-bff-mnet-dataplane.contract.test.ts` | BFF mnet dataplane contract |
| ui-contract | `tests/ui-contract/m-ui-commandwell-mutation.test.ts` | CommandWell mutation boundary |
| ui-contract | `tests/ui-contract/m-ui-component-contract.test.ts` | Component kind allowlist / forbidden kinds |
| ui-contract | `tests/ui-contract/m-ui-route-registry.test.ts` | Route registry UI contract |
| ui-contract | `tests/ui-contract/m-ui-visual-contract.test.ts` | Static file scan for raw-color/token violations (no render) |
| ui-contract | `tests/ui-contract/m-ui-bff-boundary.test.ts` | M-UI→BFF-only data boundary |
| failure-mode | `tests/failure-modes/m-ui-bff-approval-profile.test.ts` | BFF approval/profile degraded paths |
| failure-mode | `tests/failure-modes/m-ui-bff-mnet-commands.test.ts` | BFF mnet command failure modes |
| service | `tests/services/m-ui-bff/types.test.ts` + `eligibility.test.ts` | BFF types and eligibility |
| e2e | `tests/e2e/bff.test.ts`, `commandwell-mutation.test.ts`, `config-lifecycle.test.ts` | Full-stack BFF/e2e |
| apps (Vitest) | `apps/m-ui/src/lib/bff.vitest.ts` | M-UI BFF client behavior and URL override wiring |
| apps (Vitest) | `apps/m-ui/tests/runtime/*.vitest.ts` | rendered runtime behavior, degraded-state visibility, token presence, and route parity |
| apps (Vitest) | `apps/m-ui/src/lib/components/modules/**/*workspace.vitest.ts` | extracted Workspace seam coverage |

### 7.2 Coverage Gaps

- **Resolved since the original audit:** the repo now has an `apps/m-ui` Vitest
  script, `happy-dom`, Svelte render coverage, route render smoke tests,
  token-presence checks, CommandWell behavior tests, degraded-BFF UI scenarios,
  and registry↔renderer reconciliation tests.
- **Current guardrail:** keep runner ownership explicit. Bun owns repo-root
  `*.test.ts` suites, Vitest owns `apps/m-ui` `*.vitest.ts`, and Playwright owns
  `tests/playwright/*.playwright.ts`.
- **Remaining use for this audit:** treat the drift inventory in §6 as
  historical rationale for why the newer structure-mapping and UI-contract gates
  exist, not as the current coverage truth.

---

## 8. Test-Foundation Prerequisites

Before any future `layout / modules / ui` file restructuring (Wave 4 Task 7),
the following minimum test foundation must exist. These are **prerequisites**,
not work to be done in this audit — this audit adds no tests. They are listed
here so the structure-mapping task has a concrete gate.

1. **Route-render smoke tests.** For each of the 18 SvelteKit pages, a test that
   mounts the page (or renders it through the SvelteKit test harness) with a
   stubbed BFF and asserts the expected primary components are present. This
   locks the current rendered surface so file moves cannot silently drop a
   component. Priority routes: `control-room.overview`, `policy.approvals.detail`,
   `network.profiles.detail`, `mnet.break-glass` (the highest-risk surfaces).

2. **State-visibility checks.** A test that renders representative components and
   asserts contract-relevant state remains visible, traceable, and not color-only
   after visual refactors.

3. **CommandWell behavior tests.** Component-level tests for the shared
   `CommandWell.svelte` covering: disabled-reason visibility, confirmation step
   before execution, inline Core error-envelope rendering on failure, and
   post-action refresh trigger. Once D4 is resolved (inline CommandWells
   converged onto the shared component), these tests protect the converged
   behavior.

4. **Degraded BFF scenario.** A test that mounts a route with a BFF stub that
   fails one endpoint (e.g. `fetchDataplaneStatus` or `fetchGlobalDefaults`,
   which currently swallow errors) and asserts the UI surfaces a visible
   degraded state — via `InlineOperationalAlert` or an explicit disabled reason
   — rather than silently hiding the failure. This directly addresses D10 and
   the degraded-state visibility rule.

5. **Registry↔renderer reconciliation test (recommended).** A test that, for
   each registry route, asserts the components the page actually renders are a
   superset of (or equal to) the registry's `components` array — or explicitly
   records a justified divergence. This would have caught D2/D3 and should
   accompany any drift reconciliation.

These prerequisites align with the Meristem testing gates: route-render smoke
and state-visibility checks map to UI contract tests; CommandWell behavior and
degraded-BFF map to failure-mode tests; reconciliation maps to contract tests.

---

## 9. Deferred Implementation Details

This audit is a documentation deliverable only. The following remain explicitly
**deferred until design convergence** (Wave 2 Task 4 and the subsequent
structure-mapping task):

- No component is restructured, moved, renamed, or split.
- No `layout / modules / ui` directory structure is created.
- No local component API (props, snippets, slots) is decided.
- No SDUI kind is added, removed, or remapped.
- No `TraceLink` rendering gap (D2) or `NodeListPanel` orphan (D3) is fixed.
- No inline CommandWell (D4) is converged onto the shared component.
- No `GlobalProfileControls`/`JoinTicketPanel` registration (D5) is changed.
- No test is added; the §8 list is a gate for a future task, not this one.
- No dependency (Bits UI, Tailwind, state/chart/motion libraries) was adopted at the time this audit was written. Later primitive or styling choices should be evaluated under the current task's requirements.

The audit's sole tracked-file output is this document. All findings are
recorded to inform the convergence decision and structure-mapping task; they do
not authorize implementation in this wave.
