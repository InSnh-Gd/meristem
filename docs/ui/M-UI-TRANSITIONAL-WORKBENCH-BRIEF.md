# M-UI Transitional Workbench Brief

> This brief is the structured input for M-UI redesign exploration and later frontend implementation. It is intended for human reviewers, AI design exploration tools, Figma workflows, and frontend agents.
>
> This document points direction. `docs/ui/SDUI-SCHEMA.md` remains the executable SDUI/BFF contract for the currently implemented route and component surface.

---

## 1. Purpose

M-UI has been repositioned as Meristem's transitional frontend for the future formal operator workbench. The next frontend work should no longer treat the UI as a disposable feature-validation surface. It should begin establishing a workbench structure that can carry real operator tasks while preserving room for redesign.

This brief provides a shared input for:

- Google Stitch or similar design exploration tools.
- Claude Design or similar refinement workflows.
- Figma MCP and future design-context workflows.
- SvelteKit frontend implementation planning.
- Bits UI or other primitive-layer evaluation.

The goal is to make design exploration comparable and implementation-aware without turning this brief into the final UI contract.

---

## 2. Current Role

M-UI Transitional Workbench is the current operator-facing frontend role for Meristem.

It starts carrying:

- real workbench structure;
- operation flow;
- information hierarchy;
- state-source visibility;
- CommandWell boundaries;
- audit, policy, log, and degraded-state visibility.

It is not the final visual design, and it must remain open to later restructuring. It is also not merely a visual wrapper over API endpoints: it should organize the way operators understand state, inspect entities, evaluate command eligibility, execute controlled actions, and trace outcomes.

---

## 3. Outcome Shape and Development Latitude

The Transitional Workbench should produce a real, operable, traceable, and evolvable workbench ancestor inside this repository. It is not the final frontend, but the future formal workbench should be able to evolve from its validated structure rather than restart from a blank slate.

The Transitional Workbench is the structural predecessor of the formal workbench, not a temporary bypass. Later work may redesign visual language, refine local interactions, replace component implementations, or reorganize internal modules, but it should not discard validated workflows, information domains, ownership boundaries, or the M-UI -> BFF -> Core / M-* data path without a deliberate architecture change.

The first design exploration does not need to produce final visual signoff or a final component system. It must produce a direction that clearly expresses:

- workbench structure;
- primary operator workflows;
- information hierarchy;
- the controlled-action path;
- the traceability path after an action.

The first exploration must cover four experience layers:

1. **Orientation**
   Operators can quickly understand current system, service, node, network, and degraded states.

2. **Investigation**
   Operators can move from state into entity, log, approval, policy, or network context and understand source and cause.

3. **Controlled action**
   Operators can see whether a command is executable, why it is unavailable, what impact it has before execution, and what result or error follows execution.

4. **Traceability**
   Operators can connect operation, policy decision, audit facts, logs, Timeline entries, and correlation identifiers.

The first exploration may defer:

- final visual language, brand polish, and complete design-system rules;
- final primitive/component library decisions and APIs;
- final state architecture, including whether to introduce an external store;
- advanced charting, visualization, and motion systems;
- plugin-provided UI, runtime composition, remote frontend modules, and dynamic component registration.

Future implementers may decide implementation details that do not change the final result shape. This includes component split granularity, local layout choices, primitive wrappers, Svelte implementation style, local interaction pattern, and CSS/token mechanics. They must not change the result target, four experience layers, ownership boundaries, M-UI -> BFF -> Core / M-* data path, or SDUI registry role without updating this brief and the relevant contracts.

---

## 4. Ownership Principles

Design exploration and implementation planning must keep these ownership boundaries intact:

1. **M-UI owns UI structure**
   M-UI owns the workbench shell, core route surfaces, Svelte components, interaction structure, and future `layout / modules / ui` split.

2. **Services own facts and capabilities**
   M-* services own facts, capabilities, events, policy state, audit state, and domain state. They do not own frontend pages, Svelte components, or rendered workbench elements.

3. **BFF adapts facts into UI-facing data**
   M-UI BFF may aggregate, trim, order, annotate state sources, and derive display-oriented command eligibility. It must not own final business facts, final authorization, final policy decisions, or UI component structure.

4. **SDUI is contract registry, not runtime renderer**
   SDUI records the route/component inventory and operational boundaries M-UI commits to support. It does not create pages or dynamically instantiate components at runtime in the current Transitional Workbench stage.

5. **Plugin UI is deferred architecture**
   M-Extension and plugin UI contribution are outside the current mainline. Future plugin-provided UI requires a separate architecture track covering ADR, security model, SDUI extension, BFF boundary, and component or page registration.

6. **Frontend modularity happens inside M-UI**
   Modularity should happen in M-UI-owned `layout / modules / ui` layers. Domain modules consume BFF-shaped data; services and plugins do not ship frontend modules.

7. **Design exploration must respect this boundary**
   Google Stitch, Claude Design, Figma MCP workflows, and frontend agents must explore an M-UI-owned workbench structure. They must not assume service- or plugin-supplied runtime UI.

---

## 5. Design Goals

1. **Move from feature display to workbench structure**
   M-UI should organize real operations, state understanding, and trace paths rather than merely showing that backend capabilities exist.

2. **Support multi-domain workflows**
   Control room, nodes, approvals, network profiles, and M-Net data-plane surfaces should be able to share a coherent workbench model instead of becoming isolated pages.

3. **Strengthen traceability before and after actions**
   Command entry, policy checks, audit outcomes, Timeline entries, Full Log context, and correlation identifiers should form an understandable path.

4. **Preserve room for the future formal frontend**
   This brief defines a transitional structure. It must not lock the final visual language, layout system, or component architecture prematurely.

5. **Make AI design exploration comparable**
   Design outputs must be comparable by information architecture, workflow fit, boundary correctness, traceability, and implementation path, not only visual quality.

---

## 6. Non-Goals

1. **Not final M-UI visual signoff**
   The first exploration pass should not attempt to finalize brand expression, complete design-system rules, or final visual polish.

2. **Not a marketing page, SaaS landing page, or generic dashboard**
   Do not center the design around hero sections, decorative metric cards, or a generic admin dashboard pattern.

3. **Not a frontend rewrite that bypasses SDUI/BFF contracts**
   Exploration may propose new structure, but it must not assume that M-UI calls Core directly or owns authoritative facts.

4. **Not a one-shot adoption of a full component library or state architecture**
   Bits UI, state stores, charting, and other libraries should serve the selected structure rather than define it first.

5. **Not a single giant page containing every domain**
   Explore workbench structure and navigation between domains rather than one infinite overview.

6. **Not a replacement for product judgment**
   AI tools may generate and compare options, but final decisions must come from Meristem goals, operator workflows, and system boundaries.

---

## 7. Operators and Contexts

1. **Platform operator**
   Observes system health, node state, service state, Timeline, network state, and normal operating actions.

2. **Security / policy operator**
   Focuses on high-risk commands, insufficient permissions, policy decisions, audit visibility, approvals, and fail-closed outcomes.

3. **Network operator**
   Focuses on Stem / Leaf topology, M-Net profiles, data-plane status, node credentials, network changes, migrations, and break-glass operations.

4. **Read-only auditor / viewer**
   Views allowed state, logs, audit visibility, and disabled-command reasons without executing high-risk actions.

These are operator contexts rather than rigid personas. A single authenticated actor may move between contexts depending on permission and task.

---

## 8. Core Workflows

1. **Orient on system state**
   An operator enters M-UI and understands Core, services, nodes, network state, Timeline, and degraded dependencies.

2. **Inspect an entity**
   An operator moves from a node, service, network, approval, policy result, or log event into detail and source context.

3. **Evaluate command eligibility**
   Before acting, an operator sees whether a command is available, why it is unavailable, and which permission, policy, or audit requirement applies.

4. **Execute a controlled action**
   An operator uses CommandWell to confirm a controlled action, review impact, submit it, and see the result or error envelope.

5. **Trace after action**
   After execution, an operator can connect task id, policy decision id, correlation id, Timeline entries, Audit facts, and log context.

6. **Handle degraded / fail-closed state**
   When Core, M-Policy, M-Log, M-Net, projection, or BFF dependencies degrade, the workbench shows what is unavailable and why actions fail closed.

---

## 9. Information Domains

1. **System health and service registry**
   Core readiness, service health, service lifecycle, reload state, and degraded state.

2. **Node topology and node state**
   Stem / Leaf records, reachable / degraded / offline states, node permissions, and task capability.

3. **Network and M-Net profile state**
   Logical networks, profile enable / disable / default state, migration state, and control-plane / data-plane status.

4. **CommandWell and command eligibility**
   Available commands, disabled reasons, permissions, policy requirements, audit requirements, and impact summaries.

5. **Policy and approval state**
   Policy decisions, pending escalation, approval queue/detail, and fail-closed outcomes.

6. **Timeline / Full / Audit / traceability**
   Timeline entries, Full Log context, Audit facts, correlation id, causation id, and trace id.

7. **Configuration and SecretRef visibility**
   Config lifecycle, SecretRef metadata, rotation state, and redaction state. Only display metadata that is safe for the current actor.

8. **Degraded dependency state**
   Core, M-Policy, M-Log, M-Net, projection, and BFF dependency failures, including visible reasons for unavailable operations.

---

## 10. AI Design Exploration Instructions

Use these instructions when prompting design exploration or design-refinement tools.

1. Design for a control / workbench interface, not a marketing page.
2. Generate multiple layout concepts, not one polished screen.
3. Prioritize information architecture and workflow fit before visual style.
4. Use the six core workflows in this brief as scenario anchors.
5. Represent state source, disabled-command reasons, policy / audit visibility, and degraded state explicitly.
6. Do not assume direct frontend access to Core; design around M-UI -> BFF -> Core / M-* service boundaries.
7. Do not assume that pages, components, layouts, or rendered elements are supplied by M-* services, M-Extension, or plugins at runtime.
8. Treat SDUI as a route/component contract registry, not as a runtime page builder.
9. For each concept, explain the workflow path it optimizes and the tradeoff it makes.

The first exploration pass should focus on structured workbench screens such as control room, operations workspace, multi-panel operator surface, network operations workspace, and policy / audit review workspace. It should not use landing pages or generic SaaS dashboards as the primary reference pattern.

---

## 11. Evaluation Criteria

Evaluate generated concepts in this order:

1. **Workflow fit**
   Does the concept support orienting on state, inspecting entities, evaluating command eligibility, controlled execution, post-action tracing, and degraded-state handling?

2. **Information hierarchy clarity**
   Are high-frequency state, action entry, detail context, and trace evidence clearly layered?

3. **Multi-domain extensibility**
   Can the structure carry nodes, approvals, network, policy, logs, and service state without becoming a one-off page?

4. **Boundary correctness**
   Does the concept respect M-UI -> BFF -> Core / M-* boundaries and avoid assigning fact ownership or final authorization to the frontend?

5. **Traceability**
   Does it make source, correlation id, policy decision, audit, and log relationships understandable?

6. **Failure and disabled-state visibility**
   Are disabled reasons, insufficient permissions, degraded dependencies, and fail-closed outcomes visible and actionable?

7. **Implementation path to SvelteKit**
   Can the concept map to SvelteKit with a future `layout / modules / ui` component split and a primitive layer such as Bits UI if selected?

8. **Visual quality**
   Visual quality matters, but it is evaluated after workflow, hierarchy, boundaries, traceability, failure visibility, and implementation path.
