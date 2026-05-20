# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout

This is a single-context repo.

Read:

- `CONTEXT.md` at the repo root for Meristem domain language.
- `docs/adr/` for architectural decisions relevant to the area being changed.
- `AGENTS.md`, `MERISTEM.md`, `MERISTEM-DESIGN.md`, `MERISTEM-DEV.md`, and `MERISTEM-ROADMAP.md` according to the repo's required document order.

There is no `CONTEXT-MAP.md` and no per-context ADR layout currently configured.

## Before exploring, read these

- `CONTEXT.md`
- Relevant ADRs under `docs/adr/`
- The repo-level Meristem documents required by `AGENTS.md`

If a file does not exist, proceed silently unless the current task requires that file.

## Use the glossary's vocabulary

When your output names a domain concept, use the term as defined in `CONTEXT.md`. Do not drift to synonyms the glossary explicitly avoids.

If the concept you need is not in the glossary yet, either reconsider the terminology or note the gap for a future documentation pass.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding it.
