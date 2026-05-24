# ADR-025: Promote M-Task to Canonical Task Service

## Status

Accepted

## Context

The MVP task loop proved that Core can assign a noop task to a Leaf node, persist task state, publish task events, and write Timeline / Full / Audit facts. Phase 11 expands the task domain with cancellation, timeout, task-owned events, task-owned PostgreSQL state, and M-Policy risk foundations.

Keeping Core as the task facade would preserve short-term compatibility, but it would also keep task lifecycle semantics inside the microkernel boundary. That conflicts with the product boundary that Core remains a microkernel and complex behavior moves into explicit M-* domains or microservices.

## Decision

Promote M-Task to the canonical task service in Phase 11.

- M-Task becomes the canonical external REST / OpenAPI task API and task owner.
- M-Task owns task lifecycle state, task definitions, task transitions, task results, task cancellations, and canonical task lifecycle events.
- Core no longer owns the task facade, task state, task orchestration, task lifecycle events, or task log facts.
- M-Task verifies external actor JWT bearer credentials through shared `packages/auth` primitives.
- M-Task calls M-Policy and M-Log directly for authorization, risk decisions, Timeline / Full / Audit behavior, and fail-closed handling.
- M-Task coordinates delivery through M-Net and must not directly hold or call node-agent sessions.
- Phase 11 is a breaking migration from the Core-owned MVP task assignment path; no Core task compatibility window is preserved.
- M-Policy risk foundations attach first to M-Task control actions.

## Consequences

M-Task becomes a real M-* domain boundary instead of a Core helper. Task lifecycle, event ownership, state ownership, and policy risk semantics have one canonical owner.

The migration requires synchronized updates to REST, OpenAPI, Eden, CLI, event catalog, security, data model, testing, runbook, MVP docs, seed permissions, and demo scripts. Existing Core task entrypoints and the `task:assign` permission cannot be treated as stable compatibility surfaces.

M-Task must implement its own external service boundary, including actor authentication, request correlation, trace propagation, M-Policy calls, M-Log writes, and fail-closed behavior. Shared auth primitives must be extracted so Core and M-Task do not duplicate identity handling.

The decision intentionally avoids making M-Task a general workflow engine. Retry execution, leases, multi-instance worker coordination, approval queues, and full multi-party decision workflows are deferred to later phases.

## Revisit When

Revisit if M-Task cannot safely expose an external task API without reintroducing Core as a facade, if task migration creates unacceptable compatibility risk for v0.1 users, or if M-Task begins to own transport, node-agent execution internals, or general workflow automation outside the task lifecycle boundary.
