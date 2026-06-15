# Contract Versioning

> 本文档定义 Meristem 契约的版本化总规则。凡是跨 service、node、runtime 或 time 边界的对象，都必须显式版本化。
>
> `REST-API-MVP.md` 是外部 HTTP / OpenAPI 主契约；`CLI-COMMANDS.md`、`EDEN-MVP.md`、`SERVICE-LIFECYCLE-PROTOTYPE.md` 只在各自消费面补充映射与运行时约束，不覆盖主契约。

---

## 1. Contract Set

| 文档 | 角色 | 状态 |
|------|------|------|
| `README.md` | 目录索引与权威边界说明 | Index |
| `REST-API-MVP.md` | 外部 REST / OpenAPI 契约 | Canonical |
| `CLI-COMMANDS.md` | CLI 命令映射与操作约束 | Supporting |
| `EDEN-MVP.md` | Eden typed client 契约 | Supporting |
| `SERVICE-LIFECYCLE-PROTOTYPE.md` | 服务 lifecycle 运行时补充约束 | Supporting |

Canonical 文档定义契约 shape 与权威规则；Supporting 文档只解释某一消费面如何使用这些契约。

---

## 2. Versioned Objects

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

当前最小契约集：

- REST / OpenAPI: `REST-API-MVP.md`
- CLI: `CLI-COMMANDS.md`
- Eden: `EDEN-MVP.md`
- Service lifecycle runtime supplement: `SERVICE-LIFECYCLE-PROTOTYPE.md`

---

## 3. Version Shape

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

## 4. Compatibility Rules

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

## 5. Migration Rule

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

## 6. Authority Rules

- 外部 HTTP request / response shape 以 `REST-API-MVP.md` 为准。
- CLI 文档可以复述命令侧行为，但若权限、错误语义或返回 shape 与 REST 文档冲突，以 REST 文档为准。
- Eden 文档不单独发明外部 schema 名称；若 REST 文档已命名类型，Eden 文档应直接引用。
- 运行时补充文档可以说明 lifecycle、logging、retry、non-goal 与 fail-closed 语义，但不得覆盖主 REST 路由契约。

---

## 7. Prohibited Shortcuts

- Do not silently change event payload shape.
- Do not use `any` for compatibility.
- Do not duplicate literal vocabularies across route files without a shared contract source or a contract drift test.
- Do not assume Core, Stem, Leaf, M-CLI, and M-UI are always the same version.
- Do not make OpenSearch projection shape the canonical authority.
- Do not remove old event consumers before the compatibility window is closed.
