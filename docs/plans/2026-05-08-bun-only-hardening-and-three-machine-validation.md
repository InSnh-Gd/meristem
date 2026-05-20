# Bun-Only Hardening And Three-Machine Validation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.
>
> Status: partially superseded by the Phase 8 Join Ticket runtime design. The Bun-only and comment-hardening parts remain useful, but any runtime validation step that registers agent nodes with `--mode agent` is stale. Current agent-mode validation must create a Join Ticket, redeem it through the M-Net join ingress, and resume with the runtime token returned by `join.accepted`.

**Goal:** Eliminate all Node.js runtime and Node API dependencies from the repository, backfill code comments to the standard required by `meristem_v_next_developer_document_v_0_1.md`, enforce both requirements in `AGENTS.md`, and then run a three-machine logical network plus agent-runtime validation across `45.204.206.45`, `45.204.206.96`, and `47.250.136.141`.
**Architecture:** Keep the existing Meristem split of `Core + M-Policy + M-Log + M-EventBus + M-Net + node-agent`, with internal synchronous control paths using loopback `HTTP + Eden + internal token`, NATS reserved for events and agent bus traffic, and no Node.js runtime anywhere in the stack.
**Tech Stack:** Bun, TypeScript strict, Elysia, Eden, PostgreSQL, NATS, OpenTelemetry, Bash utilities, Docker Compose.

---

## 1. Scope And Constraints

### 1.1 Hard Constraints

- Node.js is forbidden across the repository.
- `node:*` imports are forbidden across the repository.
- Repo scripts, tests, service runners, and tooling must execute with Bun, shell, or other non-Node runtimes.
- Code comments must be brought up to the standard required by:
  - `meristem_v_next_developer_document_v_0_1.md §26.2`
  - `MERISTEM-DEV.md §8.2`
- `FIXME` usage must match:
  - `meristem_v_next_developer_document_v_0_1.md §26.3`
  - `MERISTEM-DEV.md §8.3`
- Elysia method chains that carry auth, policy, lifecycle, logging, failure mapping, or contract semantics must include explicit comments.

### 1.2 Non-Goals

- Do not introduce Node.js as a temporary migration bridge.
- Do not claim real peer-to-peer transport, DERP, UDP, or TCP path selection.
- Do not widen scope into full transport mesh implementation.
- Do not rewrite large stable modules unless required to remove Node.js usage or add missing comments.

## 2. Required Reading Before Implementation

Read in this order before changing code:

1. `AGENTS.md`
2. `MERISTEM.md`
3. `MERISTEM-DESIGN.md`
4. `MERISTEM-DEV.md`
5. `MERISTEM-ROADMAP.md`
6. `docs/README.md`
7. `meristem_v_next_developer_document_v_0_1.md`
8. Relevant contracts, service docs, runbook, testing, security, and event catalog entries touched by the change

## 3. Milestone Breakdown

## Milestone 1: Document And Policy Hardening

**Intent:** Freeze the repo rules before touching implementation.

### Files To Update

- `AGENTS.md`
- `MERISTEM-DEV.md`
- `docs/testing/TESTING.md`
- `docs/operations/RUNBOOK.md`
- `docs/README.md` if a plans index entry is needed

### Required Changes

- Add `meristem_v_next_developer_document_v_0_1.md` to the mandatory reading order in `AGENTS.md`.
- Add an explicit Bun-only rule to `AGENTS.md`.
- Add an explicit Node.js ban to `AGENTS.md`.
- Add explicit comment requirements to `AGENTS.md`:
  - block-level comments for non-trivial logic
  - function comments for exported, boundary, validation, state-transition, and service-lifecycle functions
  - Elysia method-chain comments
  - `FIXME` scope restrictions
- Mirror those hard rules in `MERISTEM-DEV.md`, `docs/testing/TESTING.md`, and `docs/operations/RUNBOOK.md`.

### Verification

- `rg -n "Node.js|Bun-only|注释要求|FIXME|Elysia" AGENTS.md MERISTEM-DEV.md docs/testing/TESTING.md docs/operations/RUNBOOK.md`

### Expected Result

- The repository has one unambiguous source of truth for:
  - no Node.js
  - Bun-only execution
  - mandatory comment backfill
  - Elysia chain comments
  - constrained `FIXME` usage

## Milestone 2: Node.js Elimination

**Intent:** Remove all remaining Node.js runtime and Node API usage.

### Primary Files To Inspect

- `packages/internal-http/src/index.ts`
- `apps/**/*`
- `services/**/*`
- `packages/**/*`
- `scripts/**/*`
- `tests/**/*`
- `package.json`

### Required Changes

- Replace Node HTTP server and stream usage in `packages/internal-http/src/index.ts` with Bun-native server abstractions.
- Ensure all service bootstrap and shutdown paths use Bun-native primitives.
- Remove all `node:*` imports.
- Remove any script entry that requires `node` to execute repository code.
- Add a repository gate script that fails on:
  - `node:*` imports
  - explicit `node` execution of repository TS/JS code

### Recommended Implementation Notes

- Keep internal HTTP behavior unchanged from the caller perspective.
- Preserve existing internal token enforcement.
- Preserve current contract shapes and failure mapping.
- Add comments explaining why the Bun-native boundary exists and what contract it preserves.

### Verification

- `rg -n "from 'node:|from \\\"node:|require\\('node:|require\\(\"node:" apps services packages scripts tests`
- `bun run lint`
- `bun run typecheck`
- `bun run test`
- `bun run <nodejs-ban-script>`

### Expected Result

- Zero Node.js runtime or Node API dependency remains in repo-tracked code.

## Milestone 3: Repository-Wide Comment Backfill

**Intent:** Bring source comments up to the original developer-document standard.

### Scope

- All repo-tracked `.ts` and `.tsx` files under:
  - `apps/`
  - `services/`
  - `packages/`
  - `scripts/`

### Required Comment Rules

- Add block comments before non-trivial logic segments.
- Add function comments to:
  - exported functions
  - route factories
  - boundary adapters
  - validators
  - state-transition handlers
  - lifecycle handlers
  - security-sensitive helpers
- Add explicit comments to Elysia method chains when they encode:
  - auth
  - policy checks
  - audit behavior
  - lifecycle behavior
  - error/status mapping
  - contract versioning behavior
- Avoid trivial comments that restate syntax.
- Where comments explain a contract or rule from Meristem docs, cite the source section when the boundary is non-obvious.

### Execution Strategy

1. Prioritize boundary-heavy files:
   - `apps/core/src/app.ts`
   - `apps/core/src/adapters.ts`
   - `apps/m-cli/src/cli.ts`
   - `services/m-net/src/index.ts`
   - `services/m-log/src/index.ts`
   - `services/node-agent/src/index.ts`
   - `packages/internal-http/src/index.ts`
2. Continue through the remaining source tree.
3. Keep comment style consistent and concise.

### Verification

- Manual review of all changed files.
- `bun run lint`
- `bun run typecheck`
- `bun run test`

### Expected Result

- The repository meets the comment standard from the original developer document without turning source into low-signal noise.

## Milestone 4: Three-Machine Validation Preparation

**Intent:** Prepare the local control plane and both remote machines for agent-runtime validation.

### Topology

- `45.204.206.45`
  - control plane only
  - PostgreSQL + NATS + `dev:all`
- `45.204.206.96`
  - remote `Stem agent`
- `47.250.136.141`
  - remote `Leaf agent`

### Fixed Names

- Stem node name: `tri-remote-stem`
- Leaf node name: `tri-remote-leaf`
- Network name: `tri-lab-mesh-20260508`

### Preparation Steps

1. Start local dependencies:
   - `docker compose up -d postgres nats`
2. Prepare database:
   - `bun run db:migrate`
   - `bun run db:seed`
3. Start control plane:
   - `bun run dev:all`
4. On `45.204.206.96`, install Bun if missing:
   - `sudo pacman -S --needed bun`
5. Sync the repository to both remote hosts using SSH or SCP with `-F /dev/null`.
6. Confirm both remote hosts can reach:
   - `http://45.204.206.45:3000/api/v0/health`
   - `ws://45.204.206.45:4223`

Deployment note:

- This validation exposes `3000` and `4223` publicly as a development exception.
- It does not represent the target M-Net public exposure model.
- After M-Net reaches the intended node-join design, only one node-join ingress should remain public.

### Expected Result

- All three machines are ready for runtime validation without adding Node.js or extra runtime dependencies.

## Milestone 5: Three-Machine Runtime Validation

**Intent:** Prove the currently implemented logical network and agent-runtime path across three machines.

### Execution Order

1. Create a remote Stem Join Ticket:
   - `meristem node ticket create --kind stem --name tri-remote-stem`
2. Create a remote Leaf Join Ticket:
   - `meristem node ticket create --kind leaf --name tri-remote-leaf`
3. Start remote Stem agent on `45.204.206.96` with the Stem Join Ticket.
4. Wait until Stem becomes `healthy/reachable`.
5. Start remote Leaf agent on `47.250.136.141` with the Leaf Join Ticket.
6. Wait until Leaf becomes `healthy/reachable`.
7. Create the network:
   - `meristem network create --name tri-lab-mesh-20260508`
8. Join the Stem to the network.
9. Join the Leaf to the network.
10. Verify members:
   - Stem membership mode is `full`
   - Leaf membership mode is `restricted`
11. Assign a `noop` task to the Leaf:
   - `meristem task assign --leaf <leaf-node-id> --type noop`
12. Stop the remote Leaf agent.
13. Wait for timeout-based transition to `offline/unreachable`.
14. Re-run `noop` assignment against the Leaf and expect failure.
15. Optionally stop the remote Stem agent and confirm it also goes `offline/unreachable`.

### Expected Runtime Outputs

- `meristem node list`
  - `tri-remote-stem` is `mode=agent`, `status=healthy`, `reachability=reachable`
  - `tri-remote-leaf` is `mode=agent`, `status=healthy`, `reachability=reachable`
- `meristem network members`
  - Stem is `full`
  - Leaf is `restricted`
- `meristem task assign --type noop`
  - returns `completed` before the Leaf is stopped
- After stopping Leaf:
  - node becomes `offline/unreachable`
  - task assignment fails with `409 node.unreachable`

## 4. Audit, Timeline, And Failure Expectations

### Timeline Must Show

- remote Stem registration
- remote Leaf registration
- token issuance for both nodes
- reachability transitions to reachable
- network creation
- both network joins
- `noop` completion
- offline transition after agent stop

### Audit Must Show

- `node:register`
- `node:issue-token`
- `network:create`
- `network:join`
- `task:assign`

### Failure Cases To Validate

- If remote host cannot reach `:3000`, stop and report networking precondition failure.
- If remote host cannot reach `:4222`, stop and report agent-bus precondition failure.
- If Leaf join is attempted before Stem join and returns `409 network.stem_required`, treat that as expected behavior.
- If an `operator` token cannot read audit, treat that as expected behavior.
- If a `security-admin` token can read audit, treat that as success.

## 5. Final Verification Checklist

Run these before declaring the work complete:

- `bun run lint`
- `bun run typecheck`
- `bun run test`
- `bun run test:contracts`
- `bun run test:failure-modes`
- `bun run test:cli`
- `bun run <nodejs-ban-script>`

Collect and summarize:

- local control-plane startup result
- both remote agent startup results
- network create and membership results
- successful `noop` execution result
- offline transition result
- post-offline failure result
- doc updates performed

## 6. Commit Strategy

Make small, reviewable commits:

1. `docs: enforce bun-only and comment rules`
2. `refactor: remove nodejs runtime dependencies`
3. `docs: backfill source comments to developer standard`
4. `test: add nodejs-ban gate and validation coverage`
5. `ops: record three-machine validation evidence`

## 7. Definition Of Done

This plan is complete only when all of the following are true:

- Node.js usage is eliminated from repository code and scripts.
- `AGENTS.md` and related docs explicitly enforce Bun-only and comment rules.
- Source comments are backfilled to the required standard.
- Static gates and tests pass.
- Three-machine logical network plus agent-runtime validation succeeds.
- Results are reported without overstating transport capabilities.
