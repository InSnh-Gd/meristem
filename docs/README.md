# Meristem Documentation Index

> This directory contains the executable contract layer for Meristem. Root documents define intent; files under `docs/` define implementation-facing contracts.

---

## 1. Root Documents

| Document | Role |
|----------|------|
| `../AGENTS.md` | AI agent protocol and document reading order |
| `../MERISTEM.md` | Product intent, product taboos, privacy and safety principles |
| `../MERISTEM-DESIGN.md` | M-UI visual and interaction contract |
| `../MERISTEM-DEV.md` | Engineering baseline, domain boundaries, data structures, frozen rules |
| `../MERISTEM-ROADMAP.md` | Phased delivery plan and v0.1 guardrails |

---

## 2. Executable Contract Documents

| Directory | Purpose | Start Here |
|-----------|---------|------------|
| `adr/` | Architecture decision records | `adr/README.md` |
| `services/` | Service Definition template and first service specs | `services/SERVICE-DEFINITION-TEMPLATE.md` |
| `events/` | NATS subject and event schema catalog | `events/EVENT-CATALOG.md` |
| `contracts/` | API, Eden, event, webhook, and versioning rules | `contracts/CONTRACT-VERSIONING.md` |
| `security/` | RBAC, policy, audit, secrets, LLM and webhook security | `security/SECURITY-MODEL.md` |
| `data/` | Authoritative state, event state, cache, read model boundaries | `data/STATE-MODEL.md` |
| `config/` | Config lifecycle state machine and rollback rules | `config/CONFIG-LIFECYCLE.md` |
| `operations/` | Local runbook, dependencies, ports, failure response | `operations/RUNBOOK.md` |
| `testing/` | Test strategy and CI gates | `testing/TESTING.md` |
| `ui/` | SDUI schema and operational component contract | `ui/SDUI-SCHEMA.md` |
| `roadmap/` | Phase-level implementation specs | `roadmap/PHASE-0.md` |
| `mvp/` | MVP product and engineering target | `mvp/MVP-SPEC.md` |
| `skills/` | Project-local Codex skill sources | `skills/elysiajs/SKILL.md` |
| `references/` | Current upstream technology snapshots | `references/elysiajs-latest.md` |

---

## 3. MVP Document Set

The current implementation target is the Core + Stem/Leaf node MVP:

| Document | Purpose |
|----------|---------|
| `mvp/MVP-SPEC.md` | MVP scope, demo loop, acceptance criteria |
| `roadmap/PHASE-0.md` | project skeleton and engineering baseline |
| `roadmap/PHASE-1.md` | Core microkernel and base API |
| `roadmap/PHASE-2.md` | NATS event loop |
| `roadmap/PHASE-3.md` | Core / Stem / Leaf node model and noop task |
| `roadmap/PHASE-4.md` | Timeline / Full / Audit minimum logs |
| `roadmap/PHASE-5.md` | M-Policy RBAC MVP |
| `roadmap/PHASE-6.md` | logical node networks and M-Net orchestration |
| `roadmap/PHASE-7.md` | service lifecycle and reload prototype |
| `roadmap/PHASE-8.md` | real node-agent runtime prototype |
| `contracts/REST-API-MVP.md` | REST v0 routes and schemas |
| `contracts/EDEN-MVP.md` | internal Eden MVP contract |
| `contracts/CLI-COMMANDS.md` | CLI MVP command behavior |
| `contracts/SERVICE-LIFECYCLE-PROTOTYPE.md` | service list and reload prototype contract |
| `data/POSTGRES-SCHEMA-MVP.md` | authoritative PostgreSQL schema |

Phase numbering note:

- `roadmap/PHASE-6.md` is the inserted logical-network execution phase.
- root `MERISTEM-ROADMAP.md` phase names continue from the original sequence.
- use the mapping table in `MERISTEM-ROADMAP.md` when matching root phases to executable docs.

---

## 4. Technology Reference Set

Read these before implementing or reviewing code that touches the corresponding technology:

| Document | Purpose |
|----------|---------|
| `skills/elysiajs/SKILL.md` | ElysiaJS route, plugin, schema, Eden, OpenAPI, and test workflow |
| `skills/functional-programming/SKILL.md` | Pure-first TypeScript domain logic and explicit side-effect boundaries |
| `references/elysiajs-latest.md` | ElysiaJS current release snapshot and Meristem usage guidance |
| `references/svelte-latest.md` | Svelte current release snapshot and Svelte 5 runes guidance |
| `references/wasm3-latest.md` | Wasm3 current release snapshot, maintenance status, and adoption checklist |

---

## 5. Update Rule

When a code change touches a boundary defined in a `docs/` contract, update that contract in the same change. If the root intent changes, update `MERISTEM.md` first, then cascade into the affected `docs/` files.
