# Phase 0 - Project Skeleton and Engineering Baseline

> Goal: establish the Monorepo, engineering rules, and minimum runnable Core skeleton.

---

## 1. Scope

Phase 0 includes:

- Monorepo initialization
- TypeScript strict configuration
- no-`any` lint rule
- base package structure
- Elysia app minimum startup
- minimum OpenAPI generation
- test framework
- TDD workflow
- comment rules for code blocks, functions, and Elysia method chains
- FIXME / TODO / HACK convention
- baseline CI

Phase 0 does not include:

- full M-Policy
- full M-EventBus
- node registration
- M-Net implementation
- M-UI production shell
- OpenSearch
- APISIX
- Redis / KeyDB

---

## 2. Target Files

Exact paths may change after scaffold, but the first implementation should create:

```text
package.json
pnpm-workspace.yaml
tsconfig.base.json
eslint.config.*
apps/core/
packages/contracts/
packages/events/
packages/service-definition/
packages/testing/
docs/
```

---

## 3. Required Scripts

```json
{
  "scripts": {
    "lint": "...",
    "typecheck": "...",
    "test": "...",
    "test:contracts": "...",
    "dev:core": "..."
  }
}
```

The concrete runner is decided during scaffold, but these script names are the project contract.

---

## 4. Completion Criteria

```text
Core can start.
Minimum REST API is reachable.
OpenAPI document can be generated.
Tests can run.
TypeScript strict is active.
No-any rule is active.
CI runs lint, typecheck, tests, and contract tests.
```

---

## 5. Verification Checklist

- Run lint.
- Run typecheck.
- Run tests.
- Run contract tests.
- Start Core locally.
- Fetch health endpoint.
- Fetch OpenAPI document.
- Confirm a deliberate `any` usage fails lint or type gate.
