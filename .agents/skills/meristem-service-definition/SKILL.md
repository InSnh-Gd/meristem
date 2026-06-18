---
name: meristem-service-definition
description: Use when adding, changing, reviewing, or documenting a Meristem Core, M-* service, node service, task service, extension service, BFF, service lifecycle behavior, or service definition.
---

# Meristem Service Definition

## Use With

Use after `meristem-context-protocol` and `meristem-engineering-guardrails`. Also use `elysiajs`, `effect-ts`, or `functional-programming` when the implementation touches those boundaries.

Primary source documents:

- `docs/services/SERVICE-DEFINITION-TEMPLATE.md`
- The matching service doc under `docs/services/`
- `docs/contracts/CONTRACT-VERSIONING.md`
- `docs/events/EVENT-CATALOG.md`
- `docs/security/SECURITY-MODEL.md`
- `docs/data/STATE-MODEL.md`
- `docs/testing/TESTING.md`

## Required Pass

Before implementing or reviewing a service change, identify:

- Service identity: `name`, `version`, `domain`, `kind`, owner.
- What the service owns and must not own.
- Whether the change touches M-UI, SDUI, BFF display contracts, or extension UI-adjacent behavior; services must not claim frontend page/component/layout ownership.
- API, Eden, REST, event, and BFF contracts it exposes or consumes.
- Permissions and risk level for every control action.
- Dependencies and failure behavior.
- Config schema and hot-reload behavior.
- Liveness, readiness, lifecycle, degradation, reload, rollback.
- Timeline / Full / Audit log behavior.
- M-Policy requirements and fail-closed behavior.

If any item is unknown, update the service definition before coding.

## Boundary Rules

- Core stays a microkernel. Move complex capability into the correct M-* service.
- A service must not read another service's private state.
- A service must not publish events absent from `docs/events/EVENT-CATALOG.md`.
- A service must not introduce unversioned contracts.
- A service must not supply M-UI pages, Svelte components, layouts, runtime frontend modules, or plugin UI surfaces. Services expose facts, capabilities, events, policy state, audit state, and domain state; M-UI owns frontend structure and M-UI BFF adapts facts into UI-facing data.
- High-risk operations require M-Policy and Audit Log when the docs require them.
- Degraded behavior must be explicit; do not leave dependency failure as an accidental exception path.

## Implementation Checklist

- Keep route schemas, service definitions, event subjects, permissions, and docs in the same change.
- Add contract tests for required fields and route/event compatibility.
- Add failure-mode tests for unavailable dependencies and denied permissions.
- Add readiness behavior for required backing services.
- Add logs according to the service definition, not ad hoc handler logic.
- Keep shared code in `packages/*` only when it is stateless schema, validator, parser, policy, event envelope, or adapter helper logic.

## Done Criteria

- Service definition is versioned.
- Contracts, permissions, dependencies, health, lifecycle, and logs are declared.
- Failure behavior is documented and tested.
- Contract and failure-mode tests cover the service boundary.
- Documentation and code agree on source of truth and ownership.
