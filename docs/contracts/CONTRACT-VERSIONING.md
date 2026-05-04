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
- M-Extension Manifest
- Webhook Payload
- BFF Contract
- SDUI Schema

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
| Service Definition | `version` field | `0.1.0` |
| Config Schema | `schemaVersion` | `0.1.0` |
| M-Net Profile | `profileVersion` | `m-net-cn@0.1.0` |
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

---

## 5. Prohibited Shortcuts

- Do not silently change event payload shape.
- Do not use `any` for compatibility.
- Do not assume Core, Stem, Leaf, M-CLI, and M-UI are always the same version.
- Do not make OpenSearch projection shape the source of truth.
- Do not remove old event consumers before the compatibility window is closed.
