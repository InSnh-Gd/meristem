# ADR Index

> Architecture Decision Records record the durable decisions behind Meristem. ADRs are referenced by implementation docs, service definitions, and PR reviews.

---

## ADR List

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-001](ADR-001-typescript-first.md) | TypeScript-first | Accepted |
| [ADR-002](ADR-002-elysia-first.md) | Elysia-first | Accepted |
| [ADR-003](ADR-003-eden-first-not-eden-only.md) | Eden-first, Not Eden-only | Accepted |
| [ADR-004](ADR-004-rest-openapi-no-graphql.md) | REST + OpenAPI, No GraphQL | Accepted |
| [ADR-005](ADR-005-lightweight-microservices.md) | Lightweight Microservices | Accepted |
| [ADR-006](ADR-006-core-microkernel.md) | Core Microkernel | Accepted |
| [ADR-007](ADR-007-m-extension-naming.md) | M-Plugin Renamed to M-Extension | Accepted |
| [ADR-008](ADR-008-no-m-services-module.md) | Microservices Are Implementation Form | Accepted |
| [ADR-009](ADR-009-nats-eventbus.md) | NATS for M-EventBus | Accepted |
| [ADR-010](ADR-010-postgresql-write-model.md) | PostgreSQL Write Model | Accepted for v0/MVP |
| [ADR-011](ADR-011-opensearch-read-model.md) | OpenSearch Read Model | Accepted |
| [ADR-012](ADR-012-nats-kv-default-cache.md) | NATS KV as Default Cache | Accepted |
| [ADR-013](ADR-013-three-level-logging.md) | Timeline / Full / Audit Logs | Accepted |
| [ADR-014](ADR-014-m-policy-rbac-first.md) | M-Policy RBAC First | Accepted |
| [ADR-015](ADR-015-opentelemetry.md) | OpenTelemetry | Accepted |
| [ADR-016](ADR-016-effect-without-effect-everywhere.md) | Effect Without Effect Everywhere | Accepted |
| [ADR-017](ADR-017-apisix-optional.md) | APISIX Optional | Accepted |
| [ADR-018](ADR-018-rejected-default-technologies.md) | Rejected Default Technologies | Accepted |
| [ADR-019](ADR-019-no-m-perf-module.md) | No M-Perf Module | Accepted |
| [ADR-020](ADR-020-identity-in-core.md) | Identity in Core | Accepted |
| [ADR-021](ADR-021-secrets-core-policy-log.md) | Secrets Split Across Core / Policy / Log | Accepted |
| [ADR-022](ADR-022-sveltekit-elysia-integration.md) | SvelteKit + Elysia Integration | Accepted |
| [ADR-023](ADR-023-m-net-default-network.md) | M-Net Default Network | Proposed |
| [ADR-024](ADR-024-m-net-cn-profile.md) | M-Net CN Regional Profile | Proposed |

---

## ADR Template

```md
# ADR-XXX: Title

## Status

Accepted / Proposed / Deprecated

## Context

Why this decision exists.

## Decision

What is decided.

## Consequences

What this enables, what it prevents, and what costs it creates.

## Revisit When

Concrete conditions that would justify reopening this decision.
```
