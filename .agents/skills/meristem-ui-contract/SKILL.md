---
name: meristem-ui-contract
description: Use when implementing, reviewing, or documenting Meristem M-UI, SvelteKit UI, SDUI schemas, BFF display contracts, CommandWell actions, transitional workbench structure, audit/policy/log visibility, or operator workflow behavior.
---

# Meristem UI Contract

## Use With

Use after `meristem-context-protocol` and `meristem-engineering-guardrails`. For Svelte/SvelteKit work also read `docs/references/svelte-latest.md`; for route and BFF contracts use `elysiajs` and `meristem-contract-versioning` as needed.

Primary source documents:

- `docs/ui/SDUI-SCHEMA.md`
- `docs/services/m-ui-bff.md`
- `docs/testing/TESTING.md`
- `CONTEXT.md`

Preserved M-UI design exploration docs under `docs/ui/` are historical context only. They should not override explicit current user requirements or the active SDUI/BFF contracts.

## Product Frame

M-UI is the **M-UI Transitional Workbench**: the operator-facing transitional frontend for the future formal Meristem workbench. It is a Control Room Ledger for orientation, traceability, and conservative action. It is not a generic SaaS dashboard, marketing UI, decorative admin panel, or disposable prototype.

The transitional workbench starts carrying real workbench structure, operation flow, information hierarchy, state-source visibility, and CommandWell boundaries while preserving room for later redesign.

## Ownership Principles

- M-UI owns route surfaces, Svelte components, layout decisions, interaction structure, and the future `layout / modules / ui` component split.
- Capability domain services own facts, capabilities, events, policy state, audit state, and domain state; services do not own frontend pages or components.
- M-UI BFF adapts facts into UI-facing data by aggregating, trimming, ordering, annotating `stateSource`, and deriving display-oriented command eligibility; it must not own final facts, final authorization, final policy decisions, or UI component structure.
- SDUI is a route/component contract registry, not a runtime page renderer or page composition engine.
- M-Extension and plugin UI contribution are deferred architecture and require a future ADR, security model, SDUI extension, BFF boundary, and component/page registration design.
- Frontend modularity happens inside M-UI; domain modules consume BFF-shaped data rather than service- or plugin-provided frontend modules.
- Design exploration tools and agents must target an M-UI-owned workbench structure and must not assume service/plugin-supplied runtime UI.

## Route Rules

- Privileged routes declare `requiredPermissions`.
- Destructive or high-risk actions appear in `CommandWell`.
- The inspector may be closed or omitted; the primary surface must still work.
- Critical state must declare a source: authoritative, event, cache, read-model, log, audit, or policy.
- Critical state must not be color-only and must expose traceable source information where applicable.

## CommandWell Rules

- High or critical risk commands require M-Policy and Audit Log.
- A command displays impact summary before execution.
- Destructive commands are never icon-only.
- Disabled commands display a reason and do not send requests.
- Enabled commands require CommandWell confirmation before execution.
- UI command eligibility is display-only; Core, M-Policy, and M-Log remain fact sources.

## Forbidden UI Patterns

Do not introduce:

- Toasts or snackbars for contract-relevant feedback.
- Decorative cards, marketing banners, confetti, carousel UI.
- Floating action buttons.
- Unscoped dropdown action menus.
- Unlabeled destructive icon buttons.
- Hidden destructive controls.
- Final authorization logic inside the BFF or frontend.

## Transitional Workbench Rules

These rules apply to the current M-UI Transitional Workbench surface and its SDUI/BFF contract.

- Visible UI text is Chinese; machine fields, permission names, event names, error codes, and component kinds remain English.
- The single control action is rendered as `运行 noop 任务` for `task.noop.run` / `task:submit`.
- It is enabled only for a selected reachable Leaf with `task:submit`.
- Missing permission, wrong node kind, and unreachable node state must show visible Chinese disabled reasons.
- Disabled commands create no Audit facts.
- Confirmation displays target node, task type, permission, policy requirement, and audit requirement.
- Success displays `task.id`, `policyDecisionId`, and `correlationId`, then refreshes Timeline and selected Leaf state.
- Failure displays the Core error envelope inline in CommandWell.
- Audit regions stay visible but access-denied for actors without `audit:read`.
- Mobile must remain usable through a single-column or vertically scrollable layout.
- Realtime UI transport is out of scope until explicitly added to the contract.

## Test Expectations

- Route schema validates before rendering.
- Unknown component kind fails closed.
- Forbidden component kinds are rejected.
- High-risk commands cannot bypass M-Policy.
- BFF exposes minimal OpenAPI for UI-facing endpoints.
- M-UI calls M-UI BFF only, not Core REST directly.
- BFF does not cache Core data or permission context across requests.
- SDUI remains a contract registry; runtime page composition requires a future ADR and contract update.
- Services, M-Extension, and plugins do not supply M-UI pages, components, layouts, or runtime frontend modules.

## Expansion Track Boundaries

M-UI expansion work is contract-gated rather than design-doc-gated. Styling and visual direction may be redefined by the current task, but the following boundaries remain:

- UI state must continue to flow through `M-UI -> M-UI BFF -> Core public facade -> M-*`.
- New frontend dependencies must not leak library-specific shapes into BFF contracts or SDUI schemas.
- Critical state cannot be color-only and must expose traceable source information where applicable.
- High-risk or destructive commands must remain explicit, confirmed, and auditable.

### ADR / security / contract-gated (no implementation)

- **SDUI runtime renderer:** ADR / contract-migration work only. Until an
  accepted ADR and versioned contract migration authorise a runtime renderer,
  SDUI remains a route/component contract registry. No runtime renderer
  implementation exists. Reference: `ADR-U01-sdui-runtime-renderer-migration.md`.

- **Plugin UI:** ADR / security / contract work only. No runtime plugin UI
  implementation exists. Plugin-delivered UI remains blocked until sandbox, CSP,
  signing/provenance, registration, and ownership-boundary rules are accepted.
  Reference: `ADR-U02-plugin-ui-sandbox-security-model.md`.

### Cross-track boundary rules

- Runtime frontend tracks may introduce bounded pilots inside M-UI only. They must not
  break the `M-UI -> M-UI BFF -> Core public facade -> M-*` data flow.
- ADR-gated tracks remain decision-only. No runtime implementation, composition
  engine, or plugin-delivered production UI is authorised.
- Existing ownership principles (§Ownership Principles), route rules, CommandWell
  rules, and forbidden UI patterns remain authoritative for all tracks.
