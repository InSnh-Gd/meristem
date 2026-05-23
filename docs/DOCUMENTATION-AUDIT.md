# Meristem Documentation Audit

> Status: documentation hygiene audit, 2026-05-20.
>
> Purpose: identify stale, duplicate, confusing, or conflicting documentation so future implementation work has a clear reading path. This file does not change product intent; it records cleanup recommendations.

---

## 1. Source Of Truth Order

Keep the current top-level authority order:

1. `AGENTS.md`
2. `MERISTEM.md`
3. `MERISTEM-DESIGN.md`
4. `MERISTEM-DEV.md`
5. `MERISTEM-ROADMAP.md`
6. `docs/README.md`
7. relevant `docs/**` contract documents

`meristem_v_next_developer_document_v_0_1.md` is historical context. The remaining binding Bun-only, Eden-first, comment, and FIXME rules are now carried by `AGENTS.md`, `MERISTEM-DEV.md`, and relevant `docs/**` contract files.

Recommended cleanup:

- Done: the historical draft now has a stronger banner that says it is historical context only.
- Done: `AGENTS.md` reading order no longer requires the historical draft.
- Optional future cleanup: move `meristem_v_next_developer_document_v_0_1.md` to `docs/archive/` after checking external references.

---

## 2. High-Signal Findings

| Area | Finding | Risk | Recommendation |
|------|---------|------|----------------|
| historical developer draft | `meristem_v_next_developer_document_v_0_1.md` duplicates large parts of current root docs and phase plans. It is no longer required reading in `AGENTS.md` and now has a historical banner. | Lower residual risk: readers may still find it in root. | Optional later move to `docs/archive/` after checking external references. |
| roadmap numbering | `MERISTEM-ROADMAP.md` keeps an explicit temporary double-track mapping for Phase 6/7/9, while `docs/roadmap/PHASE-*.md` now has executable numbering through Phase 10. | Readers can pick the wrong phase document or believe both tracks are active. | Collapse root roadmap into an overview that points to executable phase docs; remove the temporary mapping once no references depend on it. |
| ADR status | `docs/adr/ADR-010-postgresql-write-model.md` and `docs/adr/README.md` marked PostgreSQL as `Proposed`, but MVP docs and runbook treat PostgreSQL as required authoritative state. | Decision status did not match implementation contracts. | Fixed: ADR-010 now says `Accepted for v0/MVP`. |
| state model table | `docs/data/STATE-MODEL.md` used a `Not Allowed` column with terse phrases like `authoritative database` and `source of truth`. | Fast readers could misread the forbidden target as the allowed role. | Fixed: column now says `Must Not Become`. |
| MVP user stories | `docs/mvp/MVP-SPEC.md` had duplicate numbering around stories 6/7. | Low severity, but it signaled doc drift. | Fixed: list is renumbered. |
| CLI contract duplication | `docs/contracts/CLI-COMMANDS.md` repeated the agent-node requirement twice for `task assign`. | Low severity, but made the contract look patched. | Fixed: duplicate bullets were merged. |
| historical plan | `docs/plans/2026-05-08-bun-only-hardening-and-three-machine-validation.md` is already labeled partially superseded. | Low, because the warning is present. | Keep in `docs/plans/` or move to `docs/archive/plans/` if active plans need a cleaner index. |
| `doc-driven-ai/` | Side directory has its own `AGENTS.md` and `README.md` outside the main docs index. | It may be unclear whether it is product documentation, tooling, or reference material. | Add a one-line entry in `docs/README.md` or move under `docs/tools/` if it is still active. |

---

## 3. Keep

Keep these as current, active documentation families:

- Root intent and contract docs: `AGENTS.md`, `MERISTEM.md`, `MERISTEM-DESIGN.md`, `MERISTEM-DEV.md`, `MERISTEM-ROADMAP.md`.
- Contract index: `docs/README.md`.
- ADRs: `docs/adr/*.md`, with status cleanup for ADR-010.
- Executable contracts: `docs/contracts/*.md`, `docs/events/EVENT-CATALOG.md`, `docs/services/*.md`, `docs/security/SECURITY-MODEL.md`, `docs/data/POSTGRES-SCHEMA-MVP.md`, `docs/config/CONFIG-LIFECYCLE.md`, `docs/testing/TESTING.md`, `docs/operations/RUNBOOK.md`, `docs/ui/SDUI-SCHEMA.md`.
- Phase docs: `docs/roadmap/PHASE-0.md` through `docs/roadmap/PHASE-10.md`.
- Project-local skills: `.agents/skills/elysiajs/SKILL.md`, `.agents/skills/functional-programming/SKILL.md`.
- Technology snapshots: `docs/references/*.md`, provided they are periodically refreshed when implementation work touches those technologies.

---

## 4. Update

Update these documents first because they create the most confusion:

1. `AGENTS.md`
   - Done: direct required reading of `meristem_v_next_developer_document_v_0_1.md` was removed; the draft is now described as historical context only.

2. `MERISTEM-ROADMAP.md`
   - Make it a short strategic roadmap and v0.1 guardrail document.
   - Treat `docs/roadmap/PHASE-*.md` as the executable source of phase truth.
   - Remove temporary double-track mapping once the root phase sections are normalized.

3. `docs/README.md`
   - Add a `Documentation Status` section with `active`, `superseded`, `historical`, and `reference snapshot` labels.
   - Add `docs/plans/` and `doc-driven-ai/` to the index if they remain in the repository.

4. `docs/adr/ADR-010-postgresql-write-model.md`
   - Change status from `Proposed` to `Accepted for v0/MVP` or `Accepted`.
   - Keep the revisit condition before production freeze.

5. `docs/data/STATE-MODEL.md`
   - Rewrite the state class table so each row says what the carrier owns and what it must not own.

6. `docs/mvp/MVP-SPEC.md`
   - Fix duplicate user-story numbering.
   - Ensure the MVP demo script names simulated node paths and real `node-agent` Join Ticket flow separately.

7. `docs/contracts/CLI-COMMANDS.md`
   - Merge the duplicate `agent nodes require reachable state and active runtime token` rules under `task assign`.

---

## 5. Archive Or Relabel

Recommended archive candidates:

- `meristem_v_next_developer_document_v_0_1.md`
  - The binding Bun-only, comment, FIXME, and Eden-first constraints are carried by current docs.
  - The file now has a historical banner.
  - Suggested target: `docs/archive/meristem-v-next-developer-document-v0.1.md`.

- `docs/plans/2026-05-08-bun-only-hardening-and-three-machine-validation.md`
  - Keep if historical implementation plans are useful.
  - Otherwise move to `docs/archive/plans/` because it is explicitly partially superseded by Phase 8 Join Ticket runtime design.

---

## 6. Recommended Cleanup Order

1. Done: fix small drift in MVP numbering, CLI duplicate bullet, ADR-010 status, and state-model table wording.
2. Done: add status labels to `docs/README.md` for active, superseded, historical, and reference docs.
3. Done: relabel the original developer draft and remove it from active required-reading rules.
4. Normalize `MERISTEM-ROADMAP.md` so executable phase truth lives in `docs/roadmap/PHASE-*.md`.
5. Optionally archive the original developer draft under `docs/archive/` after checking external references.
6. Decide whether `docs/plans/` and `doc-driven-ai/` are active documentation families or archived/tooling references.
