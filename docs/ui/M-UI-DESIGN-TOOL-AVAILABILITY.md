# M-UI Design Tool Availability

> Wave 1 / Task 1 of the M-UI Transitional Workbench Design Activation plan.
>
> Scope: probe only. No design generation, no Figma writes, no code changes,
> no dependency installation, no package manifest mutation.

## Purpose

Record the actual availability of the design-exploration stack (Stitch, Claude
Design, Figma MCP) so that downstream waves (Wave 2 design exploration, Wave 3
design-system capture and Figma validation) put only available tools on their
critical path and route everything else through a documented fallback.

The four statuses used below mirror the plan:

- `available now` — callable in the current OpenCode session without further
  setup.
- `installed but needs refresh` — present on disk but not active in the running
  session; requires a restart or config reload.
- `configured but needs credentials` — the tool is registered/configured but a
  secret or token is missing.
- `unavailable and fallback required` — not reachable in this session; a
  fallback path must be used to keep the plan unblocked.

## Probe Method

All probes were read-only filesystem / config / environment checks executed on
2026-06-19. No tool was invoked to generate artifacts, and no Figma write
operation was attempted. Specifically:

- Listed `~/.config/opencode/skills/` and confirmed each Stitch skill directory
  and its `SKILL.md`.
- Read `~/.config/opencode/opencode.jsonc` and inspected the `mcp` section.
- Searched the environment for `STITCH*` and `FIGMA*` variables.
- Checked for `stitch`, `figma`, and `@google/design.md` CLIs on `PATH`.
- Checked for the Stitch API key source files the Stitch skills document
  (`.gemini/antigravity/mcp_config.json`, `.gemini/jetski/mcp_config.json`).
- Checked for Claude / Anthropic providers, a `claude` CLI, and a
  `claude-design` skill.
- Checked for `~/.codex/config.toml` (the Figma skill's documented registration
  target).
- Checked the opencode `mcp` section for any Figma entry.

## Tool Matrix

| # | Tool | Status | Evidence |
|---|---|---|---|
| 1 | `stitch::generate-design` (skill) | available now | Skill dir `~/.config/opencode/skills/stitch-generate-design/` present with `SKILL.md`; skill visible in the session's available-skills list. |
| 2 | `stitch::enhance-prompt` (skill) | available now | Skill dir `~/.config/opencode/skills/stitch-enhance-prompt/` present; visible in session. |
| 3 | `stitch::manage-design-system` (skill) | available now | Skill dir `~/.config/opencode/skills/stitch-manage-design-system/` present; visible in session. |
| 4 | `stitch::design-md` (skill) | available now | Skill dir `~/.config/opencode/skills/stitch-design-md/` present; visible in session. |
| 5 | `stitch::code-to-design` (skill) | available now | Skill dir `~/.config/opencode/skills/stitch-code-to-design/` present; visible in session. |
| 6 | `stitch::upload-to-stitch` (skill) | available now | Skill dir `~/.config/opencode/skills/stitch-upload-to-stitch/` present; visible in session. |
| 7 | `stitch::extract-static-html` (skill) | available now | Skill dir `~/.config/opencode/skills/stitch-extract-static-html/` present; visible in session. |
| 8 | `stitch::extract-design-md` (skill) | available now | Skill dir `~/.config/opencode/skills/stitch-extract-design-md/` present; visible in session. |
| 9 | Stitch MCP server (tool calls) | unavailable and fallback required | `~/.config/opencode/opencode.jsonc` `mcp` section registers only `deepwiki`, `github`, `websearch`, `codegraph`. No `stitch` entry. No `stitch` CLI on `PATH`. |
| 10 | Stitch HTTP API (direct upload / generation) | configured but needs credentials | The Stitch skills document an HTTP API and an upload script requiring a Stitch API key sourced from `.gemini/antigravity/mcp_config.json` or `.gemini/jetski/mcp_config.json`, or a `X-Goog-Api-Key` header. None of those files exist; no `STITCH_API_KEY` / `STITCH*` env var is set. The skills explicitly instruct the agent not to proceed without a valid key. |
| 11 | Claude Design workflow | unavailable and fallback required | No Anthropic / Claude provider in `opencode.jsonc`; no `claude` CLI on `PATH`; no `claude-design` skill installed (the only `*claude*` skill dir is `git-guardrails-claude-code`, unrelated). No "Claude Design" callable exists in this session. |
| 12 | Figma MCP server (read-only) | configured but needs credentials | The `figma` skill is installed and documents a remote MCP at `https://mcp.figma.com/mcp` with bearer token env var `FIGMA_OAUTH_TOKEN`. However: no `figma` entry in `opencode.jsonc` `mcp` section; `FIGMA_OAUTH_TOKEN` is absent; `~/.codex/config.toml` does not exist, so the skill's documented registration target is also unset. |
| 13 | `@google/design.md` CLI | unavailable and fallback required | No `design.md` CLI on `PATH`; no `@google/design.md` package installed. (Only relevant for Wave 3 Task 5 evaluation; recorded here for completeness.) |

> Note on rows 1–8: the Stitch **skills** are available as prompt/guidance
> loaders. They describe how to call Stitch MCP tools and the Stitch HTTP API,
> but they do not themselves provide a backend. Without row 9 (Stitch MCP
> server) or row 10 (Stitch API key), the skills can guide the exploration
> *method* but cannot drive actual Stitch generation or upload.

## Next Actions

| Tool | Next action |
|---|---|
| `stitch::generate-design` (skill) | Use the skill as the prompt-enhancement and concept-structure guide for Wave 2 Task 3; do not call Stitch MCP tools until a Stitch backend is available. |
| `stitch::enhance-prompt` (skill) | Apply its prompt-enhancement pipeline to the Transitional Workbench brief before producing written concepts. |
| `stitch::manage-design-system` (skill) | Reference its design-system management guidance when structuring `DESIGN.md` in Wave 3 Task 5; the MCP-tool portions stay dormant until a Stitch backend exists. |
| `stitch::design-md` (skill) | Use its DESIGN.md structure guidance for Wave 3 Task 5; no MCP upload. |
| `stitch::code-to-design` (skill) | Not needed for exploration; keep available for a future code-to-design upload if a Stitch backend is later provisioned. |
| `stitch::upload-to-stitch` (skill) | Dormant; the upload script cannot run without a Stitch API key. |
| `stitch::extract-static-html` (skill) | Dormant for Wave 1–3; potentially useful later if a built M-UI artifact needs static-HTML extraction for upload. |
| `stitch::extract-design-md` (skill) | Dormant for Wave 1–3; useful later for reverse-engineering an existing frontend, not for greenfield exploration. |
| Stitch MCP server (tool calls) | If actual Stitch generation is desired in a later wave, register a Stitch MCP server in `opencode.jsonc` `mcp` (or the platform the Stitch skills target) and restart the session. Until then, route Wave 2 through the written-concept fallback. |
| Stitch HTTP API (direct upload) | Provide a Stitch API key via `STITCH_API_KEY` (or the `.gemini/.../mcp_config.json` source the skills document) before attempting any upload. Out of scope for Wave 1; do not request it unless a later wave activates Stitch generation. |
| Claude Design workflow | Represent the Wave 2 Task 4 "Claude Design refinement" as a structured writing/design refinement pass executed by the agent (see fallback below). Do not treat Claude Design as a callable. |
| Figma MCP server (read-only) | For Wave 3 Task 6: either (a) register the Figma MCP server in `opencode.jsonc` `mcp` and set `FIGMA_OAUTH_TOKEN`, then restart, or (b) execute the documented fallback (no Figma source exists today, so write the fallback recommendation). No Figma writes at any point. |
| `@google/design.md` CLI | Evaluate adopt/defer in Wave 3 Task 5 without installing; activation, if any, happens in a separate implementation task. |

## Fallback Paths

Each fallback preserves the Transitional Workbench ownership boundaries
defined in `docs/ui/M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md` and the activation
plan:

- M-UI owns UI structure.
- Services own facts and capabilities.
- BFF adapts facts into UI-facing data.
- SDUI is a contract registry, not a runtime renderer.
- Plugin UI is deferred architecture.
- Frontend modularity happens inside M-UI.

### Stitch generation fallback (covers rows 9, 10, and 11)

Since neither the Stitch MCP backend, the Stitch API key, nor Claude Design is
available, Wave 2 Task 3 (multi-concept exploration) and Wave 2 Task 4
(refinement + convergence) proceed as **agent-authored written concepts**:

1. Load `docs/ui/M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md` as the source brief.
2. Use the `stitch::enhance-prompt` and `stitch::generate-design` skills as
   *method* guidance (prompt-enhancement pipeline, concept-structure mapping,
   professional UI/UX terminology, design-token framing) — but do not invoke
   Stitch MCP tools or the upload script.
3. Produce at least two distinct workbench-structure concepts in
   `docs/ui/M-UI-STITCH-CONCEPTS.md`, each explicitly covering:
   - the four experience layers: Orientation, Investigation, Controlled action,
     Traceability;
   - all six core workflows: Orient on system state, Inspect an entity,
     Evaluate command eligibility, Execute a controlled action, Trace after
     action, Handle degraded / fail-closed state;
   - which workflow path each concept optimizes and the tradeoff it makes;
   - explicit rejection of marketing/dashboard-only concepts.
4. Refine the selected concept in Wave 2 Task 4 via a structured
   writing/design refinement pass (the Claude Design substitute): re-read the
   brief's evaluation criteria, compare the concepts across the four layers,
   six workflows, ownership-boundary correctness, and implementation path to
   SvelteKit-owned `layout / modules / ui`, then record the decision and
   tradeoffs in `docs/ui/M-UI-DESIGN-EXPLORATION-DECISION.md`.

This fallback fully satisfies the plan's Wave 2 acceptance criteria because
those criteria require *concepts and a convergence decision*, not a Stitch
artifact. The plan already states: "If Stitch is unavailable, create
equivalent written concepts manually using the brief."

The fallback preserves all ownership boundaries because the written concepts
are pure M-UI structural proposals; they do not introduce service/plugin
runtime UI, SDUI runtime composition, direct M-UI-to-Core calls, or premature
component-library adoption.

### Figma MCP fallback (covers row 12)

Wave 3 Task 6 (Figma MCP validation) executes the plan's documented fallback:
"If no Figma source exists, write a fallback recommendation for when a Figma
file should be created."

1. Record in `docs/ui/M-UI-FIGMA-CONTEXT-VALIDATION.md` that no Figma file
   exists today and the Figma MCP server is not registered/authenticated in
   this session.
2. State that component-tree, token/variable, and auto-layout extraction
   cannot be performed until a Figma file exists and the MCP server is
   registered with a valid `FIGMA_OAUTH_TOKEN`.
3. Recommend the trigger condition for creating a Figma file: only after
   Wave 2 convergence selects a direction and Wave 3 Task 5 produces
   `DESIGN.md`, so that any future Figma file reflects a converged design
   rather than an exploratory one.
4. Include the no-write guarantee: no Figma write operation is attempted in
   Wave 1 or Wave 3 Task 6. If a later wave activates Figma writes, it must
   load the `figma-use` skill, which is explicitly omitted from this task.

### `@google/design.md` CLI fallback (covers row 13)

Wave 3 Task 5 evaluates the CLI without installing it. The evaluation doc
`docs/ui/M-UI-DESIGN-MD-CLI-EVALUATION.md` records an adopt/defer
recommendation; if "adopt" is chosen, activation occurs in a separate
implementation task that installs the dependency — never inline in Wave 3.

## Scope-Fidelity Notes

- No Figma write occurred. No Figma operation was attempted at all, because the
  MCP server is not registered and no token is present.
- No Stitch MCP tool call occurred. The Stitch skills were read as guidance
  only.
- No dependency was installed. `package.json`, lockfiles, and all tracked
  source files are unchanged by this task; the only tracked file created is
  this document.
- No M-UI code was created or modified.

## Conclusion

The current session can run the full Wave 2 design exploration and Wave 3
design-system capture **without any new tool provisioning**, by treating the
Stitch skills as method guidance and producing agent-authored written
concepts. Stitch MCP tool calls, the Stitch HTTP API, Claude Design, and
Figma MCP are all unavailable in this session (the first three for lack of a
backend/credentials, Figma for lack of registration and token), so the plan's
critical path must route through the written-concept fallback for Wave 2 and
the no-Figma-source fallback for Wave 3 Task 6. This does not block the plan:
the Wave 2 and Wave 3 acceptance criteria are defined in terms of concept and
decision artifacts, not Stitch or Figma artifacts, and the activation plan
explicitly anticipates these fallbacks. The recommended design-exploration
path is therefore: load the Transitional Workbench brief, apply the
`stitch::enhance-prompt` + `stitch::generate-design` skills as prompt and
structure guidance, author at least two written concepts covering the four
experience layers and six core workflows, converge via a structured writing
refinement pass (the Claude Design substitute), and defer all Stitch-backend
and Figma-MCP work to a later activation gate that first provisions the
missing credentials and registrations.

## Acceptance Satisfaction

This document explicitly satisfies **Wave 1 / Task 1** of the activation plan.
The plan required four things, all of which are recorded here:

1. **Tool availability matrix** — completed in the Tool Matrix with one row per
   required skill/backend.
2. **Concrete status per tool** — each row is labeled `available now`,
   `installed but needs refresh`, `configured but needs credentials`, or
   `unavailable and fallback required`.
3. **Fallback path for blocked tools** — documented in the Stitch generation,
   Figma MCP, and `@google/design.md` fallback sections.
4. **No premature activation** — this document makes no tool call, performs no
   design generation, and does not mutate code, configs, or package manifests.

Wave 1 / Task 1 is therefore complete even though Stitch MCP, the Stitch HTTP
API, Claude Design, and Figma MCP are not presently callable in this session,
because the plan's acceptance criteria require an availability decision and an
unblocking fallback — not live backend execution.
