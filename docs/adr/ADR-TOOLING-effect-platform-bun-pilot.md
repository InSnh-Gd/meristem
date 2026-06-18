# ADR-TOOLING: @effect/platform-bun coexistence pilot

## Status

Accepted

## Context

Meristem already pins `@effect/platform-bun@0.90.0`, `@effect/platform@0.96.1`, and `effect@3.21.2`. Before any broader adoption work, the repo needs a narrow proof that `@effect/platform-bun` can be imported and execute a trivial Effect program under Bun without disturbing the current internal HTTP boundary.

Meristem also already has production-facing internal service conventions:

- `packages/internal-http` owns the current internal loopback HTTP abstraction.
- Internal service calls must preserve shared-token auth behavior, request correlation, and trace propagation semantics.
- Cross-service responses must stay schema-validated rather than drifting into unchecked casts.

## Decision

Meristem accepts `@effect/platform-bun` as a pilot/coexistence dependency only.

- This change adds an isolated smoke test only; it does not migrate any production service, route, client, or fetch call site.
- `packages/internal-http` remains the default internal HTTP abstraction for production service-to-service calls.
- Any future production pilot using `@effect/platform-bun` must preserve the current internal auth and trace semantics, including the existing internal token boundary, request correlation behavior, and trace propagation expectations.
- Any future production pilot must decode internal HTTP responses with shared schema validation (Effect Schema or equivalent validated adapter path), not unchecked response casts.
- A production pilot requires its own explicit migration decision, targeted contract coverage, and failure-mode proof before replacing any existing internal boundary.

## Consequences

- The repository gains a verified Bun import/runtime compatibility probe for `@effect/platform-bun`.
- Current `packages/internal-http` production semantics stay unchanged.
- Teams may experiment in isolated tooling or tests, but production adoption remains blocked behind a dedicated follow-up decision and proof of semantic parity.

## Revisit When

- A production service needs a concrete `@effect/platform-bun` capability that the current internal HTTP path cannot provide cleanly.
- A pilot demonstrates preserved auth/trace semantics and schema-validated decode behavior with focused contract and failure-mode tests.
- The repo upgrades Effect platform packages in a way that changes Bun runtime compatibility expectations.
