# M-UI Figma Context Validation

> Wave 3 / Task 6 of the M-UI Transitional Workbench design activation plan.
>
> Scope: documentation only. No Figma writes, no dependency installation, no
> M-UI code changes, no mutation of tracked files other than this document.

---

## 1. Executive Summary

Figma context validation is **deferred**. The Figma MCP backend is not
configured in this environment, so live component-tree, auto-layout, color-style,
and text-style extraction against a Figma file cannot be performed in this task.

This document records the missing Figma context and the exact activation steps a
future operator must run before validation can proceed. It is the fallback
artifact prescribed by the design activation plan and by
[`M-UI-DESIGN-TOOL-AVAILABILITY.md`](./M-UI-DESIGN-TOOL-AVAILABILITY.md): when no
Figma source exists and the Figma MCP server is not registered, the task
documents the gap and the activation path rather than fabricating validation
results.

No Figma operation of any kind — read or write — was attempted in this task,
because the MCP server is not registered and no token is present.

---

## 2. Current Environment State

The environment was probed on 2026-06-19. The findings below mirror row 12 of the
tool matrix in [`M-UI-DESIGN-TOOL-AVAILABILITY.md`](./M-UI-DESIGN-TOOL-AVAILABILITY.md).

### 2.1 Figma skill installed, MCP backend not registered in OpenCode

The `figma` skill is installed and visible in the session's available-skills
list. It documents a remote Figma MCP endpoint and the read/write tool surface.

However, the OpenCode MCP configuration (`~/.config/opencode/opencode.jsonc`)
registers only `deepwiki`, `github`, `websearch`, and `codegraph`. There is **no
`figma` entry** in the `mcp` section. As a result, no Figma MCP tool is callable
in this session.

### 2.2 No `FIGMA_OAUTH_TOKEN` environment variable

The Figma MCP backend authenticates with a bearer token supplied through the
`FIGMA_OAUTH_TOKEN` environment variable. The environment contains no `FIGMA*`
variable, so even if the server were registered, authentication would fail.

### 2.3 Skill reference points to Codex, not OpenCode

The `figma` skill's documented registration target is `~/.codex/config.toml`
(Codex), not the OpenCode config. That file does not exist on this machine. The
skill's instructions therefore do not apply directly to this OpenCode session;
an equivalent registration must be made in the OpenCode config instead (see
Section 4).

### 2.4 No Figma file exists

No Figma file for the M-UI Transitional Workbench has been created or shared.
There is no file URL to validate against. Per the plan, a Figma file should only
be created after Wave 2 convergence selects a direction and Wave 3 Task 5
produces `DESIGN.md`, so that any future Figma file reflects a converged design
rather than an exploratory one. Wave 2 has converged on Concept 2 — Focus-Flow
Ledger (see [`M-UI-DESIGN-EXPLORATION-DECISION.md`](./M-UI-DESIGN-EXPLORATION-DECISION.md));
`DESIGN.md` is produced by Task 5. A Figma file is therefore now a valid next
artifact, but it must be created by a human operator or a later task, not by
this documentation-only task.

---

## 3. What Would Be Validated If Figma Were Available

Once a Figma file exists and the Figma MCP server is registered and
authenticated, validation would confirm that the Figma source faithfully
represents the converged Focus-Flow Ledger direction and the ownership
boundaries from
[`M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md`](./M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md).
The five validation targets are:

1. **Component tree matches the selected Focus-Flow Ledger structure.**
   Each page should be a vertical stack — `RouteHeader` → `InlineOperationalAlert`
   banner → `FilterBar` → domain content stream → sticky `CommandWellPanel`
   footer — inside a shell that provides `NavRail` and `StateSourceBadge`. This
   is the structure selected in
   [`M-UI-DESIGN-EXPLORATION-DECISION.md`](./M-UI-DESIGN-EXPLORATION-DECISION.md)
   and maps directly to the future `layout / modules / ui` split.

2. **Auto-layout frames map to vertical rhythm and sticky footer.**
   Figma auto-layout frames should encode the vertical rhythm (spacing scale,
   section stacking) and the sticky command footer described in `DESIGN.md`. The
   footer must be persistent within the shell, not per-section.

3. **Color styles align with the `DESIGN.md` semantic palette.**
   Figma color styles should map 1:1 to the semantic palette tokens (state
   source, degraded, command eligibility, audit/policy emphasis) rather than to
   ad-hoc hex values. Color must not be the sole carrier of critical state, per
   the brief's route rules.

4. **Text styles align with the `DESIGN.md` typography scale.**
   Figma text styles should correspond to the typography scale tokens. Visible
   operator-facing text should be Chinese; machine fields, permission names,
   event names, error codes, and component kinds remain English, per the
   transitional workbench rules in [`SDUI-SCHEMA.md`](./SDUI-SCHEMA.md).

5. **No plugin/service-supplied UI assumptions in the Figma file.**
   No frame, component, or annotation should imply that pages, components,
   layouts, or rendered elements are supplied at runtime by M-* services,
   M-Extension, or plugins. The Figma file must depict an M-UI-owned workbench
   structure, consistent with ownership principle 7 in the brief and the
   deferred plugin-UI architecture.

Validation would use only **read-only** Figma MCP tools (see Section 4). No
write tool would be used during validation.

---

## 4. Exact Activation Steps

A future operator performs the following, in order, before running the
validation checklist in Section 5.

### 4.1 Register the Figma MCP server in OpenCode

Add a `figma` entry to the `mcp` section of the OpenCode config
(`~/.config/opencode/opencode.jsonc`). Two equivalent forms are acceptable.

Command form (local MCP via `npx`):

```jsonc
{
  "mcp": {
    "figma": {
      "command": "npx",
      "args": ["-y", "@figma/mcp"],
      "env": { "FIGMA_OAUTH_TOKEN": "<token>" }
    }
  }
}
```

Remote-URL form (the endpoint the `figma` skill documents,
`https://mcp.figma.com/mcp`):

```jsonc
{
  "mcp": {
    "figma": {
      "type": "url",
      "url": "https://mcp.figma.com/mcp",
      "env": { "FIGMA_OAUTH_TOKEN": "<token>" }
    }
  }
}
```

Use whichever form the installed Figma MCP distribution supports. The skill's
documented `~/.codex/config.toml` target does **not** apply to OpenCode; register
in the OpenCode config instead.

### 4.2 Set `FIGMA_OAUTH_TOKEN`

Obtain a Figma OAuth token and provide it through the `env` block above, or
export it in the shell that launches OpenCode. The token must have read access
to the target file.

### 4.3 Create a Figma file named "M-UI Transitional Workbench"

Create the file in Figma. The name is the canonical handle validation checks
for in Section 5. Populate it from the converged Focus-Flow Ledger direction and
the `DESIGN.md` produced by Task 5 — not from an exploratory concept.

### 4.4 Share the file URL

Share the file URL with the OpenCode session (or ensure the token's account has
access). Validation reads the file by URL/node ID; the MCP client cannot browse
Figma, so the exact file or frame link must be supplied to the validation step.

### 4.5 Use only read-only MCP tools for validation

Validation may use only read-only Figma MCP tools. Permitted tools include:

- `get_document` — file-level document structure.
- `get_components` — component library inventory.
- `get_styles` — color and text style definitions.
- `get_files` / `get_file` — page and frame tree.
- `get_metadata` / `get_screenshot` — high-level node map and visual reference,
  as described by the Figma MCP integration rules in `AGENTS.md`.

### 4.6 Do not use write tools until a separate design handoff phase is approved

No Figma write tool (`use_figma` create/edit/delete operations, variable
binding, auto-layout mutation, etc.) may be used during validation. Writes
require a separately approved design handoff phase and a prior load of the
`figma-use` skill, which is explicitly out of scope for this task. This task
performs no Figma write at all.

---

## 5. Validation Checklist

Run this checklist once the Figma MCP server is active and a file URL is
available. Each item is pass/fail; record the result inline.

- [ ] File exists and is named exactly **"M-UI Transitional Workbench"**.
- [ ] Pages present: **Control Room**, **Nodes**, **Networks**, **Policy**,
      **Audit**, **Timeline**, **Services**, **MNet**.
- [ ] Each page uses the **Focus-Flow Ledger vertical stack**:
      `RouteHeader` → `InlineOperationalAlert` → `FilterBar` → content stream →
      sticky `CommandWellPanel` footer.
- [ ] Component library contains all of:
      `NavRail`, `RouteHeader`, `StateSourceBadge`, `InlineOperationalAlert`,
      `FilterBar`, `CommandWellPanel`, `KeyValueInspector`, `TraceLink`,
      `RawEnvelopeView`, `AuditLedger`, `TimelineStream`,
      `DecisionQueueSummary`.
- [ ] Color styles match the `DESIGN.md` semantic palette (state source,
      degraded, command eligibility, audit/policy emphasis); no ad-hoc hex
      values for semantic roles.
- [ ] Text styles match the `DESIGN.md` typography scale; visible operator text
      is Chinese, machine fields remain English.
- [ ] No frames, components, or annotations are labeled as owned by M-*
      services, M-Extension, or plugins.

A failed checklist item must be resolved in the Figma file (by a separate
design task) before validation is considered passed. Do not edit the Figma file
from within this validation task.

---

## 6. Risk Note

Until the Figma MCP server is registered, authenticated, and pointed at a
"M-UI Transitional Workbench" file, **visual validation is limited to `DESIGN.md`
plus code review**. Specifically:

- Component-tree conformance can only be inferred from `DESIGN.md` and the
  SDUI route/component registry in [`SDUI-SCHEMA.md`](./SDUI-SCHEMA.md), not
  confirmed against a Figma source of truth.
- Token conformance (color, typography, spacing) can only be checked against
  `DESIGN.md` and the implemented M-UI code; Figma-side drift cannot be
  detected.
- Auto-layout and sticky-footer behavior can only be reviewed in the running
  SvelteKit UI, not in Figma frames.

This is an accepted risk for the current wave. The plan's Wave 3 acceptance
criteria for Task 6 are satisfied by this fallback artifact (documenting the
missing context and the activation steps), not by a Figma-side validation
result. Once the activation steps in Section 4 are complete, a follow-up task
should run the Section 5 checklist and record the results.

---

## 7. Scope-Fidelity Notes

- No Figma write occurred. No Figma operation was attempted at all, because the
  MCP server is not registered and no token is present.
- No dependency was installed. `package.json`, lockfiles, and all tracked source
  files are unchanged by this task; the only tracked file created is this
  document.
- No M-UI code was created or modified.

---

## 8. Acceptance Satisfaction

This document explicitly satisfies **Wave 3 / Task 6** of the activation plan in
fallback form.

The task acceptance required the work to either validate Figma context through a
registered, authenticated read-only MCP path, or to produce a deterministic
fallback artifact when no Figma source/backend was available. This document
meets that fallback acceptance by recording:

1. **Exact environment blockers** — no Figma MCP registration in OpenCode, no
   `FIGMA_OAUTH_TOKEN`, no target file URL, and no applicable Codex config.
2. **Read-only validation scope** — the precise component-tree, token, and
   auto-layout checks that will be performed once a Figma source exists.
3. **Concrete activation steps** — registration, credential provisioning,
   canonical file naming, and allowed read-only MCP tools.
4. **No-write guarantee** — no Figma write tool is permitted in this task.
5. **Scope fidelity** — no package install, no M-UI code mutation, no fabricated
   validation results.

Wave 3 / Task 6 is therefore complete for the current environment because the
plan's fallback path requires a gap-and-activation record, not a fabricated
Figma validation transcript.
- No `.omo/` paths are referenced in commands, examples, or assertions. The
  orchestration plan location is not named here; the activation path is
  expressed entirely through `docs/ui/` cross-references and the OpenCode config
  path.
- The ownership boundaries from
  [`M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md`](./M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md)
  are preserved: the future Figma file depicts an M-UI-owned workbench
  structure; services own facts; BFF adapts; SDUI is a registry; plugin UI is
  deferred; no service/plugin-supplied runtime UI is assumed.
