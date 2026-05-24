---
name: meristem-contract-versioning
description: Use when adding, changing, reviewing, migrating, or testing Meristem REST, OpenAPI, Eden, event, Effect Schema, service definition, config, policy, log, webhook, BFF, SDUI, or M-Net profile contracts.
---

# Meristem Contract Versioning

## Use With

Use after `meristem-context-protocol` and `meristem-engineering-guardrails`. Use `effect-ts` when the contract is modeled with Effect Schema and `elysiajs` when exposing REST/OpenAPI or Eden adapters.

Primary source documents:

- `docs/contracts/CONTRACT-VERSIONING.md`
- `docs/contracts/REST-API-MVP.md`
- `docs/contracts/EDEN-MVP.md`
- `docs/contracts/CLI-COMMANDS.md`
- `docs/events/EVENT-CATALOG.md`
- `docs/testing/TESTING.md`

## Versioned Objects

Explicitly version contracts that cross service, node, runtime, or time boundaries:

- REST API and OpenAPI schema
- Eden contract
- Event schema and subject semantics
- Effect Schema internal executable contract
- Service Definition
- Config schema
- M-Net profile
- M-Policy rule
- M-Log schema
- M-Extension manifest
- Webhook payload
- BFF contract
- SDUI schema

## Change Classification

Treat these as breaking changes:

- Removing a field.
- Changing a field type.
- Changing enum meaning.
- Changing authorization behavior.
- Changing event subject semantics.
- Changing config lifecycle order.
- Changing Core / Stem / Leaf node kind semantics.

Treat these as non-breaking only when consumers tolerate them:

- Adding optional fields.
- Adding enum values.
- Adding read-only REST routes.
- Adding event subjects.
- Adding Service Definition fields with defaults.

## Migration Checklist

For every breaking change, include:

- Old and new contract versions.
- Compatibility window.
- Migration script or documented manual migration.
- Rollback behavior.
- Affected Core, Stem, Leaf, M-CLI, and M-UI versions.
- Tests for old and new versions.
- Effect Schema decode/encode tests if an internal executable contract backs the shape.
- Drift tests when Effect Schema and Elysia TypeBox/OpenAPI adapters coexist.

## Prohibited Shortcuts

- Do not silently change event payload shape.
- Do not use `any` for compatibility.
- Do not duplicate literal vocabularies across route files without a shared contract source or a drift test.
- Do not assume Core, Stem, Leaf, M-CLI, and M-UI are always the same version.
- Do not make OpenSearch projection shape the source of truth.
- Do not remove old event consumers before the compatibility window closes.

## Review Questions

- What exactly crosses a boundary?
- Where is the version encoded?
- Which consumers can lag behind?
- How does rollback behave?
- What test proves HTTP metadata, internal validation, docs, and examples still agree?
