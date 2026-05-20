# Phase 9 - M-UI Functional Demo Shell

> Goal: prove the first M-UI control-room flow without treating this screen as the final frontend design.

---

## 1. Scope

Phase 9 has a hard prerequisite: the Phase 8 real `node-agent` runtime smoke must pass before implementation starts. The `noop` UI flow depends on Join Ticket redemption, session heartbeat, reachable Leaf state, Core -> M-Net dispatch, `task.execute`, and `task.result`.

Phase 9 implements the smallest **M-UI Functional Demo Shell** for the **Control Room Ledger** experience:

- SvelteKit `apps/m-ui` shell with the three-zone operational layout from `MERISTEM-DESIGN.md`.
- Elysia `services/m-ui-bff` as a thin, permission-aware BFF for UI route data and command state.
- SDUI route schema for the control-room overview route.
- Read-only aggregation of Core status, nodes, services, Timeline entries, Audit summary availability, and policy decision links.
- Inspector behavior for selected node, service, Timeline entry, or command result.
- Exactly one UI control action: run a `noop` task against a selected reachable Leaf node.
- CommandWell confirmation before the `noop` task is sent.
- Disabled command explanations for missing permission, wrong node kind, non-reachable nodes, or missing token context.
- Local demo token entry or development token injection; no login system.
- Demo role paths for `operator` and `security-admin`.
- Chinese visible UI text for the functional demo; machine fields, permission names, error codes, event types, and SDUI component kinds remain in English.
- BFF contract tests and Playwright-level functional demo coverage.
- A lightweight mobile smoke path that proves the demo remains usable on a mobile viewport.

Phase 9 must preserve the Meristem boundary that Core, M-Policy, and M-Log remain the sources of operational, authorization, and audit facts.

The **Phase 9 Functional Demo Acceptance Path** is the completion proof for this phase. Contract tests may use simulated nodes and in-memory Core fixtures, but Phase 9 is not complete until the end-to-end demo path uses a real `node-agent` Leaf, a real reachable state, a confirmed `noop` command, Timeline refresh, **Audit Access State**, and a **Minimal Policy Decision Summary**.

---

## 2. Out of Scope

Phase 9 explicitly excludes:

- final M-UI visual design.
- login, OIDC, cookie sessions, or user management.
- Join Ticket creation UI.
- node registration UI.
- service reload UI.
- config lifecycle UI.
- OpenSearch search.
- direct BFF calls to M-Log, M-Policy, or M-Net internal HTTP.
- new high-risk commands.
- frontend global state libraries.
- frontend i18n libraries or language switching.
- realtime WebSocket / SSE / polling for the UI.
- cross-request BFF caching.
- pixel-level visual acceptance tests.
- new ADRs.

The Phase 9 UI is an **M-UI Functional Demo Shell**. A later frontend phase must redesign the production M-UI experience.

---

## 3. Target Files

Expected implementation areas:

```text
apps/m-ui/
services/m-ui-bff/
packages/contracts/
docs/services/m-ui-bff.md
docs/ui/SDUI-SCHEMA.md
docs/contracts/REST-API-MVP.md
tests/contracts/
tests/e2e/
package.json
```

If Core REST v0 does not already expose enough actor permission context for disabled command explanations, Phase 9 may add a read-only Core session context endpoint. That endpoint must remain display-oriented and must not replace M-Policy enforcement on mutating routes.

---

## 4. Required Scripts

```bash
bun run dev:all
bun run dev:m-ui-bff
bun run dev:m-ui
bun run dev:ui-demo
bun run test:contracts
bun run test:e2e
```

`dev:all` continues to own the backend MVP process group. `dev:m-ui-bff` and `dev:m-ui` are Phase 9 additions. `dev:ui-demo` may start BFF + M-UI together, but must not hide the backend dependency on `dev:all`.

---

## 5. Required UI Route

The control-room overview route must use a three-zone SDUI route:

```text
Navigation rail: Overview, Nodes, Logs, Audit, Services
Primary surface: NodeMap, ServiceRegistryTable, TimelineStream
Inspector: KeyValueInspector, TraceLink, RawEnvelopeView
CommandWell: Run noop task for a selected reachable Leaf node
```

Routes or nav items outside Phase 9 may be visible only with disabled reasons. They must not navigate to incomplete command surfaces.

Visible UI text is Chinese for Phase 9. Stable tests should use `data-testid` or structural selectors rather than Chinese prose. Structured API keys, event names, permission names, and error codes remain English.

---

## 6. Required BFF Behavior

The BFF must:

- call Core REST v0 for all operational data and command execution.
- serve SDUI route data that validates before rendering.
- forward the caller's Bearer token to Core without issuing or storing tokens.
- derive display-only command state from Core-visible data and Core-visible permission context.
- preserve Core error envelopes when command execution fails.
- return disabled command explanations without creating Audit facts.
- send `POST /api/v0/tasks` only after CommandWell confirmation.
- serve `GET /api/v0/policy/decisions/:id/summary` by calling Core REST v0 and returning only the Phase 9 minimal summary fields.
- expose its own minimal OpenAPI document for UI-facing endpoints.
- perform no cross-request caching; one BFF request may reuse responses only within that request.

The BFF must not:

- call M-Log, M-Policy, or M-Net internal HTTP directly.
- construct Audit facts.
- make final authorization decisions.
- mirror the full Core `PolicyDecision` record or expose policy internals through its UI-facing summary endpoint.
- turn Core 401/403 failures into successful UI commands.
- expose Core REST paths directly to `apps/m-ui`.

---

## 7. Required Data and Permission Rules

- Phase 9 acceptance paths must use real Core REST v0 data. Mock data is allowed only for empty-state rendering or contract-test stubs.
- `GET /api/v0/session` returns the current actor and full MVP permission string list only.
- `/session` must not expose role inheritance, policy internals, RBAC table structure, or policy evaluation traces.
- `operator` can demonstrate control execution but sees Audit as visible and access denied when missing `audit:read`.
- `security-admin` can demonstrate Audit visibility.
- **CommandWell Eligibility** is derived from Core-visible facts: the actor has `task:assign`, the selected target is a Leaf node, and the selected target is reachable. The Functional Demo Acceptance Path must use a real `node-agent` Leaf, but the BFF must not add a private `node.mode === "agent"` authorization rule.
- BFF must not cache token permission results across requests.
- `apps/m-ui` must call only M-UI BFF APIs, never Core REST directly.
- BFF OpenAPI covers the UI-facing route schema, overview data, command state, and command execution endpoints without copying Core REST v0 as a second public API.

---

## 8. Required Command Result Rules

- Successful `noop` execution displays `task.id`, `policyDecisionId`, and `correlationId`.
- Successful `noop` execution refreshes Timeline and the selected Leaf node.
- Phase 9 does not add a task list panel.
- The `noop` assignment is audited as a node control action, not because `noop` itself is high risk.
- The command result links to the BFF Minimal Policy Decision Summary endpoint.
- Phase 9 shows only a Minimal Policy Decision Summary: `id`, `actor`, `action`, `resource`, `result`, and `createdAt`.
- Phase 9 does not implement the full `PolicyDecisionPanel`.
- Failures render the Core error envelope inline in CommandWell.

---

## 9. Refresh Rules

- Initial route load requests BFF overview data.
- Manual `Refresh` reloads overview data through BFF.
- Command success refreshes Timeline and selected node state.
- Phase 9 does not use UI WebSocket, SSE, or fixed polling.
- The UI must not reuse `node-agent` session transport.

---

## 10. Acceptance Flow

Functional demo flow:

```text
start Core + internal services
start M-UI BFF
start M-UI
start a real node-agent
open the control-room route
enter or inject an operator token
select a reachable Leaf node
confirm Run noop task in CommandWell
observe task.id, policyDecisionId, correlationId
observe Minimal Policy Decision Summary
observe Timeline refresh
switch to security-admin token
observe Audit Access State according to permissions
```

The `operator` path proves control execution. The `security-admin` path proves Audit visibility. The demo must not rely on a single all-powerful token.

---

## 11. Completion Criteria

- `tests/e2e/phase-8-smoke.test.ts` passes before Phase 9 work is considered ready to implement.
- `apps/m-ui` can render the Phase 9 control-room route through SvelteKit.
- `apps/m-ui` calls only M-UI BFF.
- `services/m-ui-bff` serves the route schema and overview data.
- `services/m-ui-bff` exposes minimal OpenAPI for its UI-facing API.
- BFF uses Core REST v0 only for operational data, `noop` execution, and Minimal Policy Decision Summary retrieval.
- BFF does not perform cross-request caching.
- Core, M-Policy, and M-Log remain the sources of facts.
- CommandWell shows `Run noop task` only as executable for a selected reachable Leaf with `task:assign`.
- Missing permission, wrong node kind, and unreachable node states produce visible disabled command explanations.
- Audit is visible but access-denied for actors without `audit:read`.
- CommandWell confirmation occurs before `POST /api/v0/tasks`.
- Successful execution displays `task.id`, `policyDecisionId`, and `correlationId`.
- Timeline and the selected Leaf refresh after task completion.
- The `noop` control action is audit-linked through Core/M-Log.
- Audit visibility is demonstrated with `security-admin`.
- Policy decision display is a minimal summary, not a full `PolicyDecisionPanel`.
- UI visible text is Chinese without introducing i18n infrastructure.
- BFF contract tests cover route schema, disabled command state, Core error envelope mapping, and policy decision summary trimming.
- Playwright functional demo covers the happy path, missing-permission path, operator -> security-admin token switch, and a lightweight mobile usability smoke.

---

## 12. Verification Checklist

```bash
bun run lint
bun run typecheck
bun run test:contracts
bun run test:e2e
```

Manual checks:

- Start `bun run dev:all`, `bun run dev:m-ui-bff`, and `bun run dev:m-ui`.
- Start a real `node-agent` through the existing Join Ticket flow.
- Confirm the UI shows Core status, nodes, services, Timeline, and Audit access state.
- Confirm `operator` can run `noop` against a reachable Leaf.
- Confirm a token without `task:assign` sees a disabled command explanation and sends no command request.
- Confirm `security-admin` can inspect Audit data according to the existing RBAC contract.
- Confirm mobile viewport can load, accept a token, browse the core regions vertically, and complete CommandWell confirmation.
