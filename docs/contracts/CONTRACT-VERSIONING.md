# Contract Versioning

> Meristem contracts cross service, node, runtime, and time boundaries. Anything that crosses those boundaries must be versioned.

---

## 1. Versioned Objects

The following objects must carry explicit versions:

- REST API
- OpenAPI schema
- Eden Contract
- Event Schema
- Service Definition
- M-Net Profile
- M-Policy Rule
- M-Log Schema
- Config Schema
- SecretRef
- Identity Token
- M-Extension Manifest
- Webhook Payload
- BFF Contract
- SDUI Schema

Internal executable contracts should be modeled with Effect Schema when they are complex enough to cross service, node, runtime, or time boundaries. REST/OpenAPI schemas remain the external HTTP contract, but they should not be the only runtime definition for internal policy, event, log, projection, service definition, config, webhook, or BFF command-state shapes.

MVP concrete contracts:

- REST: `docs/contracts/REST-API-MVP.md`
- Eden: `docs/contracts/EDEN-MVP.md`
- CLI: `docs/contracts/CLI-COMMANDS.md`

---

## 2. Version Shape

| Contract | Version Location | Example |
|----------|------------------|---------|
| REST | URL or header | `/api/v0/nodes`, `X-Meristem-Api-Version: 0` |
| OpenAPI | document `info.version` | `0.1.0` |
| Eden | package semver | `@meristem/contracts-core@0.1.0` |
| Event | subject major + payload schema semver | `node.status.changed.v0`, schema `0.1.0` |
| Effect Schema | exported schema module + semver | `ProjectionHealth@0.1.0` |
| Service Definition | `version` field | `0.1.0` |
| Config Schema | `schemaVersion` | `0.1.0` |
| SecretRef | `version` | `secret-ref@0.1.0` |
| Identity Token | `jti` + issuer/audience contract | `identity-token@0.2.0` |
| M-Net Profile | `profileVersion` | `m-net-cn@0.1.0` |
| M-Extension Manifest | `manifestVersion` | `m-extension-manifest@0.1.0` |
| Webhook Payload | header + payload field | `X-Meristem-Webhook-Version`, `version` |

---

## 3. Compatibility Rules

Breaking changes:

- removing a field
- changing a field type
- changing enum meaning
- changing authorization behavior
- changing event subject semantics
- changing config lifecycle order
- changing node kind semantics

Non-breaking changes:

- adding optional fields
- adding new enum values only when consumers explicitly tolerate unknown values
- adding new read-only REST routes
- adding new event subjects
- adding new Service Definition fields with defaults

---

## 4. Migration Rule

A breaking change must include:

- old contract version
- new contract version
- compatibility window
- migration script or documented manual migration
- rollback behavior
- affected Core / Stem / Leaf / M-CLI / M-UI versions
- test cases for old and new versions

When an Effect Schema backs an internal contract, the migration must also include schema decode/encode tests for the old and new shapes. Elysia TypeBox or OpenAPI adapters must be checked against the same contract so HTTP metadata does not drift from internal validation.

---

## 5. Prohibited Shortcuts

- Do not silently change event payload shape.
- Do not use `any` for compatibility.
- Do not duplicate literal vocabularies across route files without a shared contract source or a contract drift test.
- Do not assume Core, Stem, Leaf, M-CLI, and M-UI are always the same version.
- Do not make OpenSearch projection shape the source of truth.
- Do not remove old event consumers before the compatibility window is closed.
