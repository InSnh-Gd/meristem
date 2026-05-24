---
name: meristem-testing-gates
description: Use when implementing, reviewing, or claiming completion for Meristem features, fixes, contracts, services, CLI, BFF, UI, migrations, failure modes, or phase acceptance work.
---

# Meristem Testing Gates

## Use With

Use after `meristem-context-protocol` and `meristem-engineering-guardrails`. Use `superpowers:verification-before-completion` before claiming work is complete.

Primary source documents:

- `docs/testing/TESTING.md`
- Relevant contract, service, roadmap, security, state, and operations docs for the touched area
- `package.json` scripts

## Required Test Types

Select tests by boundary touched:

- `typecheck`: TypeScript strict and no `any`.
- `unit`: pure logic, Effect Schema decode/encode, schema narrowing.
- `contract`: API, Eden, event, service definition compatibility.
- `integration`: Core with service, NATS, PostgreSQL, OpenSearch, or internal HTTP boundaries.
- `failure-mode`: degraded behavior and fail-closed behavior.
- `e2e`: Core REST, BFF, CLI, auth, RBAC, and full request path.
- `migration`: old and new contract versions.
- `UI contract`: SDUI schema and forbidden component rules.

## TDD Loop For Core Logic

1. Write the failing test.
2. Run it and confirm failure.
3. Implement minimum code.
4. Run the test and confirm pass.
5. Add failure-path test.
6. Update docs if the contract changed.

## Baseline Commands

Use Bun-only commands:

```bash
bun run lint
bun run typecheck
bun run test
bun run test:contracts
bun run test:cli
bun run test:failure-modes
bun run test:integration
bun run test:e2e
bun run nodejs-ban
```

For Phase 10 OpenSearch work also run or justify:

```bash
bun run test:opensearch-failure-modes
bun run test:opensearch-contracts
bun run test:opensearch-integration
```

`test:opensearch-integration` may skip gracefully when OpenSearch is not running; failure-mode and contract tests should not require OpenSearch.

## Minimum Coverage Rules

Every new capability needs:

- One happy-path test through REST or CLI when externally visible.
- One auth failure-mode test for insufficient permissions.
- One boundary test for documented state or input restrictions.
- Contract tests if a versioned contract changes.
- Failure-mode tests for degraded dependencies and fail-closed policy/audit behavior.
- Effect success and typed failure-path tests when complex workflows move into Effect.

Do not claim a capability complete until the relevant gates pass or a documented exception names the failing gate and reason.

## Hard Gates

- Repository code remains Bun-only.
- Repository code does not import `node:*`.
- Source comments satisfy `MERISTEM-DEV.md §8.2` for touched code.
- Elysia method chains explain auth, policy, lifecycle, logging, and error mapping where non-obvious.
- Contract docs, tests, and implementation are updated together.

## Timeout Rule

- Keep default `bun test` per-test timeout at `5000ms`.
- Only real TLS, WebSocket, or subprocess integration tests may opt into longer per-test timeout.
- Prefer test-level timeout over widening the whole suite or script timeout.
