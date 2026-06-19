# M-UI DESIGN.md CLI Evaluation

This document evaluates the ability of the current OpenCode and CLI environment to produce, validate, and maintain the `docs/ui/DESIGN.md` contract for the M-UI Transitional Workbench.

## 1. Using the `design-md` Skill

The OpenCode environment includes the `design-md` and `stitch::extract-design-md` skills, which are designed to synthesize a semantic design system into a `DESIGN.md` file.

*   **How it can be used:** The `design-md` skill can be manually invoked by an agent to review existing component code, parse tokens (like Tailwind configurations or CSS variables), and generate human-readable, Stitch-compatible documentation of the visual language. It ensures the resulting markdown uses the correct YAML frontmatter and section hierarchy.
*   **Why `stitch::extract-design-md` is not applicable yet:** The M-UI codebase currently relies on a flat component structure (`apps/m-ui/src/lib/components/`). The `stitch::extract-design-md` skill relies on extracting patterns from a mature, separated component hierarchy (e.g., a formal `layout / modules / ui` split) to infer accurate layout principles and domain-specific compositions. Because M-UI has not yet undergone this structural refactoring, automated extraction would yield a disorganized list of primitive wrappers rather than a coherent design system map. Therefore, the DESIGN.md must currently be authored based on intent and the design briefs, rather than purely extracted from code.

## 2. Validating DESIGN.md via CLI

Until automated tooling is fully integrated, the alignment of `DESIGN.md` with the `M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md` and `M-UI-DESIGN-EXPLORATION-DECISION.md` can be validated using a simple CLI recipe consisting of `grep` checks.

Run the following commands in the repository root to verify that key structural components and terminology are present in the design contract:

```bash
# 1. Verify Focus-Flow Ledger concept
grep -q "Focus-Flow Ledger" docs/ui/DESIGN.md || echo "Missing Focus-Flow Ledger intent"

# 2. Verify sticky footer / CommandWell presence
grep -q "CommandWellPanel" docs/ui/DESIGN.md || echo "Missing CommandWellPanel"
grep -q "sticky" docs/ui/DESIGN.md || echo "Missing sticky layout primitive"

# 3. Verify State Source and Traceability coverage
grep -q "StateSourceBadge" docs/ui/DESIGN.md || echo "Missing StateSourceBadge"
grep -q "TraceLink" docs/ui/DESIGN.md || echo "Missing TraceLink"

# 4. Verify Degraded State visibility
grep -q "InlineOperationalAlert" docs/ui/DESIGN.md || echo "Missing InlineOperationalAlert"

# 5. Verify strict YAML frontmatter for Stitch parsing
grep -q "^colors:" docs/ui/DESIGN.md || echo "Missing YAML color tokens"
```

## 3. Stitch MCP Availability

*   **Current Status:** The Stitch upload, synchronization, and automated design-system creation workflows are currently **unavailable**. 
*   **Reason:** The Stitch MCP server is not configured, and the necessary API keys/authentication are not present in the environment.

## 4. Recommendation

Based on the current environmental constraints and the flat structure of the M-UI frontend:

1.  **Keep `DESIGN.md` Hand-Authored:** Treat `docs/ui/DESIGN.md` as a hand-authored, intent-driven contract. Do not rely on automated extraction tools until the `apps/m-ui` codebase completes its migration to the `layout / modules / ui` structure.
2.  **Defer Stitch Synchronization:** Maintain the tokens, typography, and component definitions strictly within the Markdown file. 
3.  **Future Activation:** Once the Stitch MCP is configured and authenticated, and the component refactor is complete, invoke the `stitch::manage-design-system` skill to parse `DESIGN.md` and push the definitions, tokens, and primitives into the Stitch platform.