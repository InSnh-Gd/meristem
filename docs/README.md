# Meristem Documentation Index

> This directory contains the executable contract layer for Meristem. Root documents define intent; files under `docs/` define implementation-facing contracts.

---

## 1. Root Documents

| Document | Role |
|----------|------|
| `../AGENTS.md` | AI agent entrypoint and project skill routing |
| `../MERISTEM.md` | Product intent, product taboos, privacy and safety principles |
| `../MERISTEM-DESIGN.md` | M-UI visual and interaction contract |
| `../MERISTEM-DEV.md` | Engineering baseline, domain boundaries, data structures, frozen rules |
| `../MERISTEM-ROADMAP.md` | Phased delivery plan and v0.1 guardrails |

---

## 2. Executable Contract Documents

| Directory | Purpose | Start Here |
|-----------|---------|------------|
| `DOCUMENTATION-AUDIT.md` | Documentation hygiene findings and cleanup order | `DOCUMENTATION-AUDIT.md` |
| `adr/` | Architecture decision records | `adr/README.md` |
| `services/` | Service Definition template and first service specs | `services/SERVICE-DEFINITION-TEMPLATE.md` |
| `events/` | NATS subject and event schema catalog | `events/EVENT-CATALOG.md` |
| `contracts/` | API, Eden, Effect Schema, event, webhook, and versioning rules | `contracts/CONTRACT-VERSIONING.md` |
| `security/` | RBAC, policy, audit, secrets, LLM and webhook security | `security/SECURITY-MODEL.md` |
| `data/` | Authoritative state, event state, cache, read model boundaries | `data/STATE-MODEL.md` |
| `config/` | Config lifecycle state machine and rollback rules | `config/CONFIG-LIFECYCLE.md` |
| `operations/` | Local runbook, dependencies, ports, failure response | `operations/RUNBOOK.md` |
| `testing/` | Test strategy and CI gates | `testing/TESTING.md` |
| `ui/` | SDUI schema and operational component contract | `ui/SDUI-SCHEMA.md` |
| `roadmap/` | Phase-level implementation specs | `roadmap/PHASE-0.md` |
| `mvp/` | MVP product and engineering target | `mvp/MVP-SPEC.md` |
| `plans/` | Active and accepted implementation plans that are not phase documents | `plans/2026-05-23-effect-projection-hardening.md` |
| `references/` | Current upstream technology snapshots | `references/elysiajs-latest.md` |
| `archive/` | Historical drafts and superseded plans | `archive/meristem-v-next-developer-document-v0.1.md` |

Related repository documentation outside this index:

- `../.agents/skills/` contains project-local Codex skill sources.
- `../.agents/skills/meristem-context-protocol/SKILL.md` contains the full AI context protocol, document reading order, conflict resolution, and task-specific doc routing.
- `../.agents/skills/meristem-engineering-guardrails/SKILL.md` contains Meristem implementation guardrails for code, contracts, services, events, config, state, tests, security, logging, policy, telemetry, CLI, and UI.
- `../.agents/skills/meristem-service-definition/SKILL.md` contains the service definition workflow for Core, M-* services, node services, task services, extension services, and BFFs.
- `../.agents/skills/meristem-contract-versioning/SKILL.md` contains versioning and migration rules for Meristem boundary contracts.
- `../.agents/skills/meristem-ui-contract/SKILL.md` contains M-UI, SDUI, CommandWell, BFF display, and Phase 9 functional demo guardrails.
- `../.agents/skills/meristem-testing-gates/SKILL.md` contains test selection, TDD, failure-mode, e2e, and completion-gate rules.
- `../doc-driven-ai/` is an ignored local tooling checkout when present; it is not part of the tracked product documentation set.

---

## 3. Documentation Status Labels

Use these labels when adding or reviewing docs:

| Label | Meaning |
|-------|---------|
| Active | Current source of truth for implementation or review. |
| Superseded | Kept for context, but a newer document owns current behavior. |
| Historical | Original rationale or completed plan; do not treat as implementation guidance. |
| Reference Snapshot | External technology snapshot that must be refreshed when relevant work touches it. |

---

## 4. MVP and Follow-on Phase Document Set

The current implementation target starts with the Core + Stem/Leaf node MVP and continues into bounded follow-on phase specs:

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
| `roadmap/PHASE-9.md` | M-UI functional demo shell and control-room flow |
| `roadmap/PHASE-10.md` | OpenSearch read model projection and log search |
| `roadmap/PHASE-10.1.md` | projection platform track for projector metadata, cursor, retry, DLQ, backfill, and health |
| `roadmap/PHASE-11.md` | M-Task service cutover, M-Policy risk foundation, and v0.1 MVP closure |
| `contracts/REST-API-MVP.md` | REST v0 routes and schemas |
| `contracts/EDEN-MVP.md` | internal Eden MVP contract |
| `contracts/CLI-COMMANDS.md` | CLI MVP command behavior |
| `contracts/SERVICE-LIFECYCLE-PROTOTYPE.md` | service list and reload prototype contract |
| `data/POSTGRES-SCHEMA-MVP.md` | authoritative PostgreSQL schema |

Phase numbering note:

- `roadmap/PHASE-6.md` is the inserted logical-network execution phase.
- `roadmap/PHASE-9.md` is the inserted M-UI functional demo phase after the real node-agent runtime prototype.
- root `MERISTEM-ROADMAP.md` contains mapping notes for historical phase numbering.
- use the mapping table in `MERISTEM-ROADMAP.md` when matching root phases to executable docs.

---

## 5. Technology Reference Set

Read these before implementing or reviewing code that touches the corresponding technology:

| Document | Purpose |
|----------|---------|
| `../.agents/skills/elysiajs/SKILL.md` | ElysiaJS route, plugin, schema, Eden, OpenAPI, and test workflow |
| `../.agents/skills/effect-ts/SKILL.md` | Effect v4 patterns, services, layers, Schema, errors, testing, HTTP, CLI, and config references |
| `../.agents/skills/functional-programming/SKILL.md` | Pure-first TypeScript domain logic and explicit side-effect boundaries |
| `references/elysiajs-latest.md` | ElysiaJS current release snapshot and Meristem usage guidance |
| `references/effect-latest.md` | Effect current project snapshot and Meristem usage guidance |
| `references/svelte-latest.md` | Svelte current release snapshot and Svelte 5 runes guidance |
| `references/wasm3-latest.md` | Wasm3 current release snapshot, maintenance status, and adoption checklist |

---

## 5.1 Project Skill Set

Load these project skills when their trigger matches the task:

| Skill | Purpose |
|-------|---------|
| `../.agents/skills/meristem-context-protocol/SKILL.md` | Repository context, document order, conflict resolution, task-specific doc routing |
| `../.agents/skills/meristem-engineering-guardrails/SKILL.md` | General implementation guardrails and completion boundaries |
| `../.agents/skills/meristem-service-definition/SKILL.md` | Service definition, ownership, lifecycle, dependency, policy, and log behavior |
| `../.agents/skills/meristem-contract-versioning/SKILL.md` | Versioned contracts, breaking changes, migrations, adapter drift tests |
| `../.agents/skills/meristem-ui-contract/SKILL.md` | M-UI, SDUI, CommandWell, BFF display contract, Phase 9 UI behavior |
| `../.agents/skills/meristem-testing-gates/SKILL.md` | Test matrix, TDD loop, failure-mode coverage, completion evidence |

---

## 6. Update Rule

When a code change touches a boundary defined in a `docs/` contract, update that contract in the same change. If the root intent changes, update `MERISTEM.md` first, then cascade into the affected `docs/` files.
