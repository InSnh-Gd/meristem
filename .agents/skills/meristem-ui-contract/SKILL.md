---
name: meristem-ui-contract
description: Use when implementing, reviewing, or documenting Meristem M-UI, SvelteKit UI, SDUI schemas, BFF display contracts, CommandWell actions, operational layout, audit/policy/log visibility, or Phase 9 functional demo behavior.
---

# Meristem UI Contract

## Use With

Use after `meristem-context-protocol` and `meristem-engineering-guardrails`. For Svelte/SvelteKit work also read `docs/references/svelte-latest.md`; for route and BFF contracts use `elysiajs` and `meristem-contract-versioning` as needed.

Primary source documents:

- `MERISTEM-DESIGN.md`
- `docs/ui/SDUI-SCHEMA.md`
- `docs/services/m-ui-bff.md`
- `docs/testing/TESTING.md`
- `CONTEXT.md`

## Product Frame

M-UI is a Control Room Ledger: an operational surface for orientation, traceability, and conservative action. It is not a generic SaaS dashboard, marketing UI, or decorative admin panel.

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

## Phase 9 Functional Demo Rules

Phase 9 uses the temporary **M-UI Functional Demo Shell**, not the final M-UI design.

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
- Realtime UI transport is out of scope for Phase 9.

## Test Expectations

- Route schema validates before rendering.
- Unknown component kind fails closed.
- Forbidden component kinds are rejected.
- High-risk commands cannot bypass M-Policy.
- BFF exposes minimal OpenAPI for UI-facing endpoints.
- M-UI calls M-UI BFF only, not Core REST directly.
- BFF does not cache Core data or permission context across requests.
