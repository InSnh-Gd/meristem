# Deferred Work Register

> This register records work deliberately deferred during v0.1 scope planning. Deferred means "not in the current scope"; it does not mean forgotten, rejected, or safe to implement opportunistically without reopening the owning service definition, ADR, or contract doc.

---

## 1. Rules

- Do not implement a deferred item unless its trigger is met and the owning root roadmap / ADR / service document is updated first.
- If a deferred item changes REST, Eden, event, policy, log, config, SDUI, profile, or service contracts, update the matching contract docs and tests in the same change.
- If a deferred item expands Core responsibility, re-check `MERISTEM.md` and `MERISTEM-DEV.md` first; Core must remain a microkernel.
- If a deferred item involves authorization, high-risk operations, network routing, secrets, approval, or LLM output, update `docs/security/SECURITY-MODEL.md` and Audit rules before implementation.

---

## 1a. Audit Index (2026-09-11)

This register is a **ledger**, not a to-do list. All 41 `DFW-*` entries were adjudicated on
2026-09-11 into one terminal state each. "Terminal" means the entry has a defensible status
with evidence, not that the underlying capability was built.

States:

- `resolved` — the concern no longer exists; evidence is a command or `file:line`.
- `obsolete` — superseded by other work; the entry no longer applies.
- `re-scoped-with-trigger` — still relevant, but its reopen trigger/precondition was corrected.
- `active` — reopened or in-progress work tracked elsewhere.
- `feature-scope` — a real future capability, gated on its owning ADR/service doc; not actionable
  without first reopening that doc (register §1).

| State | Entries (41 total) |
|---|---|
| resolved | DFW-014, DFW-015, DFW-033, DFW-034, DFW-035, DFW-036, DFW-038, DFW-040, DFW-041 (9) |
| resolved (correctness defects only; lifecycle sweep still deferred) | DFW-032 (1) |
| obsolete | DFW-037 (1) |
| active / in-progress | DFW-011, DFW-013, DFW-016, DFW-027, DFW-028, DFW-030 (6) |
| re-scoped-with-trigger | DFW-039, DFW-042 (2) |
| feature-scope (gated on owning doc) | DFW-001–010, DFW-012, DFW-017–026, DFW-029 (22) |

(DFW-031 does not exist — the register's numbering skips it. New entries DFW-043–048 are
registered below and do not count toward the original 41.)

Measured evidence (re-run on 2026-09-11, not carried over from prior prose):

- `bun run format:check` → exit 0, 1038 files, 0 violations (closes DFW-036, which claimed a
  release blocker).
- `bun run test:contracts` → 1249 pass / 0 fail across 156 files (DFW-037's recorded 1174
  baseline was stale; see DFW-037).
- `bun run depcruise` → 0 violations, 0 cycles (DFW-040 4→0, DFW-041 14→0; rules promoted to
  `error` for `apps/core` and `services/m-net`).

New entries registered by this effort: **DFW-043** (Core network-lifecycle event outbox /
publisher move — not implemented), **DFW-044** (operator-facing M-Net ledger-prune endpoint —
not implemented), **DFW-045** (dependency-cruiser false-green history — **fixed**, retained as
regression guard), **DFW-046** (orphan test roots not typechecked — **runtime gate added**,
typecheck inclusion still deferred), **DFW-047** (node-agent deep-imports m-net data-plane
constants — debt), **DFW-048** (local IAM production persistence/wiring gate — debt).

---

## 2. Deferred Items

### DFW-001: LLM-Assisted Approval Review

Status: partially resolved (internal context contract + redaction + tests). Still deferred: LLM provider execution, prompts, user-visible summaries.

Owner: M-Policy with M-Log / M-UI / BFF integration.

Source: Approval flow and M-Policy contract docs.

Resolved now:

- Internal context contract for approval review: structured log, policy, and task context retrieval scoped to approval records.
- Redaction tests proving secrets and sensitive fields do not enter LLM context inputs.
- LLM boundary rules in security model: LLM must not make authorization decisions, must not bypass M-Policy, must not modify Audit Log.

Still deferred:

- LLM-assisted risk explanation.
- Human-visible LLM approval summary in M-UI.
- LLM unavailability behavior in approval review.
- Real LLM provider execution (API calls, prompt construction, response parsing).
- Prompt / input redaction contract for production LLM providers.

Reason deferred:

- Approval flow must first prove approval, quorum, timeout, resume, and Audit behavior without introducing LLM ambiguity.
- LLM must not become an authorization root.
- Useful LLM summaries depend on stable approval records, log retrieval, and a formal operator UI.
- Real LLM provider integration requires secret lifecycle, rate limits, and provider-specific failure modes.

Reopen trigger:

- Approval flow is implemented and tested.
- Formal M-UI / BFF has an approval review surface.
- Read-model or log retrieval contracts can provide bounded, redacted context.
- A concrete LLM provider and prompt strategy are chosen.

Required before implementation:

- LLM security section update.
- Prompt / input redaction contract for the chosen provider.
- Audit rule for LLM-assisted explanation as auxiliary fact.
- Failure-mode tests proving LLM cannot authorize and LLM outage does not block non-LLM approval paths.

---

### DFW-002: Formal Approval Queue UI

Status: partially resolved (approve/reject CommandWell execution implemented). Still deferred: LLM-assisted review, Control Room Ledger integration.

Owner: M-UI / M-UI BFF.

Source: Approval flow and M-Policy contract docs.

Resolved now:
- Approval queue screen (read-only).
- Approval detail screen (read-only + execute).
- Approve / reject CommandWell execution flow: `POST /api/v0/commands/policy.approval.approve.execute/execute` and `POST /api/v0/commands/policy.approval.reject.execute/execute` → Core public facades `POST /api/v0/policy/approvals/:id/approve|reject` → M-Policy public routes.

Still deferred:
- LLM-assisted approval review (DFW-001 readiness-only in this tranche; real LLM provider calls remain deferred).
- Approval status display in the Control Room Ledger.

Implementation summary:
- Core approval write facades with coarse auth/authorization, forwarding to M-Policy public HTTP.
- BFF execute mappings for approve/reject via Core-only dispatch (no /internal/v0/* calls).
- M-UI approval detail page with inline CommandWell: confirmation, success evidence (correlationId, policyDecisionId), error passthrough, post-success refresh. No toast/snackbar. Chinese labels.

Reopen trigger: Approval flow REST and CLI contracts are stable. Formal M-UI route set / SDUI v0.2 work complete.

---

### DFW-003: Approval Origins Beyond M-Task And M-Net Profile Enable

Status: deferred from approval flow / M-Policy approval and M-Net profile lifecycle.

Owner: originating service plus M-Policy.

Source: Approval flow and M-Net profile lifecycle contract docs.

Deferred work:

- node registration approval.
- network profile operations beyond M-Net CN enable.
- projection backfill / DLQ approval.
- service reload approval.
- config publish approval.
- secret rotation approval.
- extension registration approval.

Reason deferred:

- Approval flow supports only M-Task origin operations.
- M-Net profile lifecycle adds only M-Net CN enable as the next origin pattern.
- Each origin needs its own suspended operation model, resume contract, stale checks, idempotency rules, events, and Audit behavior.

Reopen trigger:

- A specific origin operation becomes high-risk enough to require `require_manual_review` or `require_multi_approval`.
- The origin service has a clear owner and authoritative state model.

Required before implementation:

- origin-specific suspended operation table or contract.
- source-service resume contract.
- Audit / Timeline / Full Log rules.
- failure-mode tests for stale resume and double execution.

---

### DFW-004: Configurable Approval Policy

Status: deferred from approval flow / M-Policy approval.

Owner: M-Policy.

Source: Approval flow and M-Policy contract docs.

Deferred work:

- per-action configurable quorum.
- approver groups.
- department / team ownership.
- approval delegation.
- approval claim / lock ownership.
- approval policy DSL.
- time-window escalation chains.

Reason deferred:

- Current identity model is still a fixed actor set (`viewer`, `operator`, `admin`, `security-admin`, `break-glass-reviewer`) rather than groups or teams.
- Approval flow quorum is intentionally fixed: manual review requires one eligible approval actor; high-risk `security-admin` operations can be reviewed by the distinct `break-glass-reviewer` actor, while multi approval still requires distinct eligible actors.

Reopen trigger:

- group / team / on-call identity concepts exist.
- multiple domains require distinct approval policies.

Required before implementation:

- identity / group model ADR.
- M-Policy approval policy schema.
- migration path from fixed quorum to configurable policy.
- tests proving old approvals remain interpretable.

---

### DFW-005: Separate M-Approval Service

Status: deferred from approval flow / M-Policy approval.

Owner: undecided; current owner remains M-Policy.

Source: Approval flow and M-Policy contract docs.

Deferred work:

- extracting approval records, votes, quorum, and queue APIs into a new capability domain service.

Reason deferred:

- Approval flow behavior is part of M-Policy's decision flow.
- A new service would add service definition, API, event, storage, policy, log, and deployment overhead before there is enough complexity to justify it.

Reopen trigger:

- approval workflows become broad enough that they no longer fit M-Policy without making it an orchestration service.
- approval state needs independent lifecycle, scaling, retention, or operator ownership.

Required before implementation:

- ADR for M-Approval service creation.
- migration plan for existing `policy_approvals` and `policy_approval_votes`.
- compatibility contract for M-Policy decision records.

---

### DFW-006: HTTP Request Replay For Approved Operations

Status: deferred and prohibited for approval flow and M-Net profile lifecycle.

Owner: originating service if ever reopened.

Source: Approval flow and M-Net profile lifecycle contract docs.

Deferred work:

- replaying original external HTTP requests after approval.

Reason deferred:

- Request replay risks duplicate policy decisions, duplicate Audit facts, stale auth context, and non-idempotent execution.
- Approval flow and M-Net profile lifecycle use source-service resume contracts instead.

Reopen trigger:

- a future ADR proves a replay-safe envelope, idempotency model, and Audit model are necessary and safer than explicit resume.

Required before implementation:

- ADR.
- replay envelope contract.
- idempotency and stale-state proof.
- Audit semantics proving approval and execution remain distinct facts.

---

### DFW-007: Real M-Task Retry Execution

Status: deferred from M-Task cutover / canonical task service and approval flow. Still deferred as of v0.1.

Owner: M-Task.

Source: M-Task service definition and approval flow contract docs.

Deferred work:

- retry attempts.
- retry backoff.
- duplicate execution prevention.
- attempt history.
- retry execution after approval.

Reason deferred:

- M-Task cutover and approval flow keep retry as policy-aware `not_implemented_yet` (the REST endpoint exists but returns HTTP 501).
- Real retry requires task attempts, leases, idempotency, backoff, and worker coordination semantics.
- Event subjects `task.retry.requested.v0` and `task.retry.rejected.v0` are cataloged but not yet emitted.

Reopen trigger:

- M-Task supports more than noop or requires real recovery from failed task execution.

Required before implementation:

- `task_attempts` and possibly `task_leases` schema.
- retry event subjects.
- retry policy and Audit rules.
- failure-mode tests for duplicate execution and stale retry.

---

### DFW-008: Agent Interrupt And Running-Task Cancellation Hardening

Status: deferred from M-Task cutover / canonical task service. Still deferred as of v0.1.

Owner: M-Task / M-Net / node-agent.

Source: M-Task service definition and node-agent protocol docs.

Deferred work:

- node-agent interrupt frames.
- running-task registries.
- force-interrupt of running tasks.
- idempotent cancellation races.
- execution race handling between completion and cancellation.

Reason deferred:

- M-Task cutover cancel is best-effort and does not require node-agent force-interrupt.
- The current node-agent task frame is minimal and noop-focused.
- There is no node-agent running-task registry or interrupt frame yet.

Reopen trigger:

- tasks can run long enough or perform meaningful side effects where cancellation semantics matter.

Required before implementation:

- node-agent protocol version update.
- M-Net delivery / cancel contract update.
- M-Task state transition and race tests.
- Audit / Full Log rules for interrupt outcomes.

---

### DFW-009: M-Task Multi-Worker Coordination And Queue Infrastructure

Status: deferred from M-Task cutover / canonical task service. Still deferred as of v0.1.

Owner: M-Task.

Source: M-Task service definition.

Deferred work:

- distributed locks.
- leader election.
- leases.
- multi-worker timeout coordination.
- Redis / KeyDB queues.
- general retry / backoff infrastructure.

Reason deferred:

- M-Task cutover uses a lightweight timeout worker and single-service, in-memory + PostgreSQL semantics.
- Redis / KeyDB are optional supplements, not default dependencies.
- No distributed locks, leader election, or task leases exist yet.

Reopen trigger:

- M-Task runs multiple workers or instances that can race on task timeout / retry / scheduling.

Required before implementation:

- concurrency model ADR.
- storage / cache dependency update.
- failure-mode tests for split-brain, duplicate timeout, and lease expiry.

---

### DFW-010: Production Historical Task Migration Compatibility

Status: deferred from M-Task cutover / canonical task service. Partially resolved as of v0.1.

Owner: M-Task / Core.

Source: M-Task service definition.

Deferred work:

- production-grade migration from Core-owned historical `tasks` rows to M-Task tables.
- compatibility window for old task routes or old task records.

What is already in place:

- The old Core-owned `tasks` table is preserved as a read-only historical compatibility shim.
- M-Task owns canonical task state in its own table group (`taskRequests`, `taskTransitions`, `taskResults`, `taskCancellations`).

Reason deferred:

- M-Task cutover is a breaking v0.1 baseline migration.
- Local development reset or explicit migration is acceptable at this stage.
- No production-grade migration script, rollback plan, or old/new contract compatibility tests exist yet.

Reopen trigger:

- real user data exists in Core-owned task tables and must be preserved.

Required before implementation:

- migration script.
- rollback plan.
- old/new contract compatibility tests.
- documentation for affected CLI / REST versions.

---

### DFW-011: M-Net CN Data Plane

Status: active target — superseded by ADR-N03, implementation in progress.

Owner: M-Net.

Source: `docs/adr/ADR-N02-m-net-cn-profile.md`.

Resolved now:

- ADR, runbook, and contract documentation for `m-net-cn@0.1.0` Regional Network Profile.
- Feature-gated noop skeleton: `services/m-net/src/data-plane/noop-adapter.ts` with `DATA_PLANE_FEATURE_GATE_DEFAULT = false`.
- When gate is off, adapter returns `{ enabled: false, status: 'noop' }` and cannot mutate any runtime transport paths.
- When gate is on, adapter still returns noop status since real transport is not yet implemented.
- The skeleton does not expose runtime ports, protocols, endpoints, secrets, relays, or probes.
- `controlPlaneOnly: true` preserved on `m-net-cn@0.1.0`; enabling changes control-plane state only.

Still deferred:

- Real DERP relay.
- Real TCP interconnect.
- Real UDP path switching.
- Headscale control plane integration.
- Active reachability probing beyond existing session heartbeat.
- Latency measurement.
- Automatic path optimization.

Reason deferred:

- M-Net profile lifecycle accepts only control-plane Regional Profile lifecycle; `m-net-cn@0.1.0` is `controlPlaneOnly: true`.
- Runtime transport changes require concrete regional connectivity testing and stronger operational safety rules.
- Real DERP relay, TCP interconnect, UDP path switching, Headscale control, and active reachability probing are not implemented.

Reopen trigger:

- control-plane profile lifecycle is implemented and audited.
- concrete regional connectivity requirements and test environments exist.

Required before implementation:

- ADR update or new ADR for data-plane behavior.
- M-Net service definition update.
- Operations runbook for regional networking.
- Event subjects for path and relay changes.
- Failure-mode tests for fallback, degraded regional paths, and public DERP disablement.

---

### DFW-012: Generic Config Lifecycle Subsystem

Status: deferred from M-Net profile lifecycle / regional network profile. Partially resolved as of v0.1.

Owner: Core / config subsystem, with M-Net as a consumer.

Source: `docs/config/CONFIG-LIFECYCLE.md`.

Deferred work:

- draft / validate / commit / version / hash-sign / publish / apply / ack / rollback implementation.
- node-level apply acknowledgements.

What is already in place:

- Generic config records for multiple domains (`core`, `m-net`, `m-policy`, `m-log`, `m-extension`, `m-ui`).
- Executable subset: draft → validated → published → applied → rolled_back.
- Hash-versioning, secretRef compliance, and M-Policy support.

Still deferred:

- node-level apply acknowledgements (distributed ack from multiple nodes).
- Absorbing M-Net profile lifecycle into the generic config lifecycle.

Reason deferred:

- M-Net profile lifecycle needs only profile lifecycle, not a broad config platform.
- M-Net profile terminology remains compatible with future Config Lifecycle absorption.
- Node-level convergence for config state is not required in v0.1.

Reopen trigger:

- multiple config domains need the same publish / apply / ack lifecycle.
- M-Net profile state needs node-level convergence rather than central applied state.

Required before implementation:

- config service / owner decision.
- config schema and versioning contracts.
- rollback and failed-node semantics.
- migration path for M-Net profile state.

---

### DFW-013: M-Net CN Runtime Configuration And Secrets

Status: active target — superseded by ADR-N03, implementation in progress.

Owner: M-Net / Core secrets / M-Policy / M-Log.

Source: `docs/adr/ADR-N02-m-net-cn-profile.md`.

Resolved now:

- Runtime config secretRef skeleton: `MNetRuntimeConfigSchema` Effect Schema with `SecretRefFieldSchema` pattern for all credential-bearing fields (`derpRelay`, `tcpInterconnect`, `udpPath`, `headscaleEndpoint`, `routingTable`).
- Plaintext secret fields fail decode/validation; only `secretRefId` values survive.
- Redaction tests proving secrets do not enter logs, OpenSearch, UI error envelopes, or LLM context inputs.
- `controlPlaneOnly: true` preserved; runtime config is a control-plane declaration, not a live transport config.

Still deferred:

- Actual DERP endpoint URLs.
- TLS private material.
- STUN / TURN credentials.
- Headscale keys.
- Regional IP ranges.
- Routing tables.
- Node-specific relay assignment.
- Latency probes.

Reason deferred:

- Profile definition must be `controlPlaneOnly` and must not mislead operators into thinking runtime transport has changed.
- Secret-bearing runtime configuration requires Core / M-Policy / M-Log secret lifecycle rules.
- SecretRef v0.1 control plane exists, but M-Net does not yet consume it for runtime transport secrets.

Reopen trigger:

- M-Net data-plane work is accepted.
- secretRef and network runtime config contracts are ready.

Required before implementation:

- Security model update.
- secretRef policy and Audit rules.
- Config lifecycle or M-Net runtime config contract.
- Redaction tests proving secrets do not enter logs, OpenSearch, UI errors, or LLM prompts.

---

### DFW-014: Global M-Net Profile Defaults Or Global Switch

Status: resolved now (global defaults, batched migration, resumable rollback, control-plane only).

Owner: M-Net / config subsystem.

Source: M-Net service definition and `docs/adr/ADR-N02-m-net-cn-profile.md`.

Resolved now:

- Global defaults for M-Net CN profile selection: new networks inherit the configured default profile.
- Batched migration: fleet-wide profile application supports batched execution with per-network progress tracking.
- Resumable rollback: if a batched migration fails mid-way, operators can resume from the last successful network or roll back all applied profiles.
- Control-plane only: global defaults and migration only affect profile state, events, and audit entries; no runtime transport paths are mutated.
- `controlPlaneOnly: true` preserved on `m-net-cn@0.1.0`.

Still deferred:

- Real data-plane rollout that would require fleet-wide profile migration beyond control-plane state.

Reason deferred:

- M-Net profile lifecycle uses per-network enable / disable to reduce blast radius and support clear rollback.
- Global defaults and batched migration are control-plane operations that do not change the per-network execution model.

Reopen trigger:

- profile behavior is proven per network and operators need defaulting or fleet-wide rollout for data-plane behavior.

Required before implementation:

- config lifecycle or global setting owner.
- migration / rollback plan for data-plane rollout.
- Audit and approval rules for fleet-wide changes.

---

### DFW-015: Approval Requirement For M-Net CN Disable

Status: resolved now (disable approval gate disabled, security-admin break-glass implemented).

Owner: M-Net / M-Policy.

Source: M-Net service definition and M-Policy contract docs.

Resolved now:

- Approval gate for M-Net CN disable is disabled by default: disable executes immediately with M-Policy allow + Audit.
- Security-admin break-glass path: when M-Policy is unavailable, a security-admin can force disable through the break-glass path, which writes Audit Log before state change.
- Disable is the risk-reduction and rollback path, so M-Net profile lifecycle executes it immediately.
- Disable is allowed from `failed` state as a recovery path.
- Audit tests prove recovery cannot be blocked accidentally.

Still deferred:

- Production approval-gated disable if a future deployment identifies disable as high-risk enough to require approval.

Reason deferred:

- Disable is the risk-reduction and rollback path, so M-Net profile lifecycle executes it immediately with M-Policy allow + Audit.

Reopen trigger:

- a production deployment identifies disable as high-risk enough to require approval.

Required before implementation:

- policy rule explaining when disable requires approval.
- Emergency break-glass path (implemented for M-Policy unavailability).
- Audit tests proving recovery cannot be blocked accidentally (implemented).

---

### DFW-016: M-Net Profile UI

Status: active target — superseded by ADR-N03, implementation in progress.

Owner: M-UI / M-UI BFF.

Source: M-Net service definition and M-UI contract docs.

Resolved now:
- Network profile list / detail screens (read-only + execute).
- Enable / disable CommandWell: `POST /api/v0/commands/network.profile.enable.execute/execute` and `POST /api/v0/commands/network.profile.disable.execute/execute` → Core public facades `POST /api/v0/networks/:id/profile` → M-Net public routes.
- controlPlaneOnly warning display (Chinese: "配置变更仅影响控制平面，运行时数据面不受影响").
- Explicit network target selection via BFF `GET /api/v0/networks` → Core `GET /api/v0/networks`.

Still deferred:
- Real M-Net data-plane behavior (DERP/TCP/UDP/Headscale).
- Per-network profile state in the formal Control Room Ledger UI.

Implementation summary:
- Core profile write facades with coarse auth/authorization, forwarding to M-Net public HTTP.
- BFF execute mappings for profile enable/disable via Core-only dispatch.
- BFF `GET /api/v0/networks` proxy route.
- M-UI profile detail page with network selector, inline CommandWell confirmation, success evidence, error passthrough, post-success refresh. `m-net-cn@0.1.0` remains `controlPlaneOnly: true`.

Reopen trigger: Formal M-UI route set / SDUI v0.2 work complete. Real data-plane acceptance remains separate.

---

### DFW-017: Broad Event Mesh Or Projection Expansion For Deferred Flows

Status: partially resolved (vote-level events, profile/behavior-analysis projections). Still deferred: approval comment events.

Owner: M-EventBus / M-Log / projection platform.

Source: Approval flow and M-Net profile lifecycle contract docs.

Resolved now:

- Vote-level events: `policy.approval.vote.approved.v0` and `policy.approval.vote.rejected.v0` capture individual actor votes as distinct facts.
- Profile lifecycle events: `mnet.profile.enable.requested.v0`, `mnet.profile.enabled.v0`, `mnet.profile.disable.requested.v0`, `mnet.profile.disabled.v0`, `mnet.profile.apply_failed.v0`, `mnet.profile.enable.canceled.v0` are active and published.
- Behavior-analysis projections for approvals and profile changes are supported through vote-level and lifecycle event streams.
- Approval authorization and resume execution are distinct facts: `policy.approval.approved.v0` does not imply the origin operation executed.

Still deferred:

- Approval comment events (`approval.comment.*` subjects remain deferred).
- Query-oriented approval / profile views not covered by existing log and event streams.

Reason deferred:

- Approval flow and M-Net profile lifecycle publish only lifecycle events needed for traceability.
- PostgreSQL and Audit Log remain the authoritative facts for votes, approvals, and profile state.
- Approval comment events require additional event schema, storage, and UI integration.

Reopen trigger:

- M-UI or analytics needs query-oriented approval / profile views not covered by existing log and event streams.
- Approval comment events are needed for richer approval context.

Required before implementation:

- Event catalog update for `approval.comment.*` subjects.
- Projection schema and ownership.
- Tests proving projections are not authoritative state.

---

### DFW-018: Real M-Extension Wasm Runtime

Status: deferred from M-Extension control plane.

Owner: M-Extension.

Source: `docs/services/m-extension.md`, `docs/references/wasm3-latest.md`.

Deferred work:

- Wasm3 / Wasmtime / WasmGC runtime adoption.
- WASI policy.
- WIT / Component Model contract.
- module loading and validation.
- fuel / gas / memory / timeout limits.
- runtime failure isolation.
- execution logs and metrics.

Reason deferred:

- Meristem is not Wasm-first.
- M-Extension control plane must first prove manifest, policy, Audit, lifecycle, and state ownership without introducing runtime supply-chain and sandbox risks.
- Wasm3 is an optional future runtime boundary and currently requires a dedicated adoption checklist.

Reopen trigger:

- a concrete extension use case requires isolated code execution that cannot be modeled as a capability domain service.
- M-Extension control plane is implemented and audited.

Required before implementation:

- ADR for runtime choice and isolation model.
- manifest runtime contract update.
- permissions and resource-limit schema.
- operations runbook for runtime failures.
- tests for sandbox limits, timeout, crash isolation, logging redaction, and Audit behavior.

---

### DFW-019: M-Extension Webhook Ingress And Execution

Status: deferred from M-Extension control plane.

Owner: M-Extension / M-Policy / M-Log.

Source: `docs/security/SECURITY-MODEL.md`.

Deferred work:

- public webhook ingress routes.
- webhook source verification.
- replay protection.
- rate limiting.
- payload schema registry.
- webhook-triggered extension execution.
- rejected webhook Full / Audit behavior.

Reason deferred:

- M-Extension control plane supports only `webhook-declared` manifests and no runtime execution.
- Webhook ingress is an external untrusted boundary and must not be added as a side effect of registry work.

Reopen trigger:

- a concrete external integration needs webhook-triggered behavior.
- verification, replay, idempotency, and Audit rules are accepted.

Required before implementation:

- webhook payload contract versioning.
- source verification schema.
- replay and rate-limit storage owner.
- failure-mode tests for invalid signature, stale timestamp, replay, malformed payload, and unavailable M-Policy / M-Log.

---

### DFW-020: M-Extension HTTP Callback Or Cloud-Function Runtime

Status: deferred from M-Extension control plane.

Owner: M-Extension.

Source: `docs/services/m-extension.md`.

Deferred work:

- outbound HTTP callback execution.
- callback retry / timeout / idempotency behavior.
- script execution.
- cloud-function runtime behavior.
- callback secret binding.

Reason deferred:

- M-Extension control plane allows only `http-callback-placeholder` and does not execute callbacks.
- Callback and cloud-function behavior require secret lifecycle, retry semantics, rate limits, and blast-radius controls.

Reopen trigger:

- an accepted extension use case requires managed outbound callbacks or lightweight function execution.

Required before implementation:

- ADR for execution model.
- secretRef binding and redaction rules.
- retry / timeout / idempotency contract.
- Audit and Full Log behavior.
- failure-mode tests for callback outage, duplicate delivery, secret redaction, and denied execution.

---

### DFW-021: Non-System Extension Scopes

Status: deferred from M-Extension control plane.

Owner: M-Extension plus the owning scoped domain.

Source: `docs/services/m-extension.md`.

Deferred work:

- node-scoped extension instances.
- network-scoped extension instances.
- service-scoped extension instances.
- tenant or user scoped extension instances.

Reason deferred:

- M-Extension control plane stores the two-layer definition / instance model but only enables `system/default` to avoid cross-domain lifecycle coupling.

Reopen trigger:

- a specific domain needs scoped extension behavior and can define ownership, reads, writes, policy, and rollback semantics.

Required before implementation:

- scope ownership contract.
- authorization and Audit rules per scope.
- state migration from `system/default` assumptions.
- tests for scope isolation and denied cross-scope access.

---

### DFW-022: M-Extension UI And BFF Surfaces

Status: deferred from M-Extension control plane.

Owner: M-UI / M-UI BFF.

Source: M-Extension service definition and M-UI contract docs.

Scope note: this entry covers M-UI-owned extension management screens only.
Plugin-supplied UI, page slots, or sandboxed contribution runtime remain a
separate ADR/security/contract track under
`docs/adr/ADR-U02-plugin-ui-sandbox-security-model.md`; DFW-022 does not reopen
or authorize that runtime.

Deferred work:

- extension list screen.
- extension detail screen.
- extension register CommandWell flow.
- extension enable / disable CommandWell flow.
- extension manifest validation display.

Reason deferred:

- M-Extension control plane uses REST and CLI as the acceptance surface.
- M-UI route set / SDUI v0.2 explicitly excludes M-Extension UI.

Reopen trigger:

- M-Extension REST and CLI contracts are implemented and stable.
- operators need extension lifecycle visibility inside Control Room Ledger.

Required before implementation:

- BFF display contract.
- SDUI route schema update if server-driven.
- CommandWell contract for register / enable / disable.
- UI tests for source visibility, disabled reasons, high-risk rejection wording, and no direct UI calls to fact-source services when BFF is required.
- Plugin-supplied UI must satisfy ADR-U02 first; M-UI-owned extension management
  screens must not introduce plugin runtime, dynamic component registration, or
  service/plugin-provided frontend modules.

---

### DFW-023: Dynamic Extension Permission Registry And Marketplace

Status: deferred from M-Extension control plane.

Owner: M-Extension / M-Policy.

Source: M-Extension service definition and `docs/adr/ADR-F02-architecture-organization.md`.

Deferred work:

- extension-defined permissions.
- permission namespace registration.
- marketplace install / upgrade / uninstall.
- extension package signing and distribution.
- compatibility windows for extension packages.

Reason deferred:

- M-Extension control plane uses four fixed permissions and prohibits extensions from creating permissions.
- Marketplace and dynamic permission behavior would push Meristem toward plugin-first architecture before the control plane is proven.

Reopen trigger:

- a real extension ecosystem need exists and Meristem intentionally accepts the operational and security burden.

Required before implementation:

- ADR revisiting M-Extension boundaries (`docs/adr/ADR-F02-architecture-organization.md`).
- permission namespace contract.
- package signature and provenance rules.
- migration and compatibility policy.
- tests for permission namespace collision, downgrade, malicious package metadata, and denied install.

---

### DFW-024: Runtime Redis / KeyDB Adapter Integration

Status: deferred from optional deployment pack.

Owner: owning service plus data / cache boundary.

Source: `docs/operations/OPTIONAL-DEPLOYMENT-PACK.md`, `docs/data/STATE-MODEL.md`.

Deferred work:

- Redis / KeyDB runtime adapter.
- moving any session, rate-limit, lock, queue, task coordination, or cache state to Redis / KeyDB.
- Redis client dependency.
- Redis fallback or fail-closed implementation.

Reason deferred:

- Optional deployment pack only ships a Redis optional profile and adapter contract boundary.
- NATS KV remains the default cache model.

Reopen trigger:

- a concrete capability requires Redis-only semantics such as sorted sets, high-frequency rate limiting, complex distributed locks, or external Redis protocol compatibility.

Required before implementation:

- service owner decision.
- state model update naming the cache class and owner.
- config lifecycle update.
- operations failure behavior.
- tests for fallback, fail-closed behavior, unavailable Redis, and stale cache safety.

---

### DFW-025: Production APISIX Gateway Hardening

Status: deferred from optional deployment pack.

Owner: operations / security with affected service owners.

Source: `docs/operations/OPTIONAL-DEPLOYMENT-PACK.md`, `docs/adr/ADR-F03-infrastructure-backbone.md`.

Deferred work:

- production APISIX TLS termination.
- APISIX auth preflight plugins.
- production rate-limit policy.
- canary / gray release traffic control.
- webhook ingress through APISIX.
- APISIX deployment hardening.

Reason deferred:

- Optional deployment pack uses APISIX only as an optional local edge gateway example.
- APISIX must not become a Meristem authorization or policy root.

Reopen trigger:

- production edge gateway requirements become concrete and service-level authorization remains owned by Meristem services plus M-Policy.

Required before implementation:

- security model update.
- route allowlist update tied to REST contract docs.
- TLS and secret lifecycle plan.
- Audit and correlation header rules.
- tests proving APISIX cannot expose internal routes.

---

### DFW-026: Split-Container Service Runtime And Image Publishing

Status: deferred from optional deployment pack.

Owner: operations / service owners.

Source: `ops/compose/full-stack.example.yml`.

Deferred work:

- production images for Core and capability domain services.
- split-container internal service URL configuration.
- container health checks for every service.
- image publishing and registry workflow.
- full-stack compose as an executable CI gate.

Reason deferred:

- current internal service URLs are loopback-oriented in code.
- Optional deployment pack full-stack compose is topology documentation, not a production deployment or default workflow.

Reopen trigger:

- services need to run as separate containers rather than Bun dev processes on one host.

Required before implementation:

- internal service URL configuration contract.
- service health and readiness contract per service.
- image build strategy.
- migration and startup order rules.
- integration tests for split-container service communication.

---

### DFW-027: Production Identity Provider Integration

Status: **重新打开（reopened）** — 由生产轨道（post-v0.1 Production Track, `MERISTEM-ROADMAP.md §7`）重新激活。

Owner: Core / security / M-UI BFF.

Source: `MERISTEM-ROADMAP.md §7`, `docs/adr/ADR-F02-architecture-organization.md`.

#### 重新打开范围

生产轨道将 DFW-027 范围聚焦为 OIDC 联邦 + 本地 IAM + 浏览器会话管理，排除 SAML、通用 SSO 联邦和完整用户管理 UI。

**包含（acceptance conditions）**：

1. **OIDC 联邦**：Keycloak 作为 OIDC Provider，Meristem Core 作为 Relying Party。OIDC Discovery、authorization code flow + PKCE、token validation（签名、issuer、audience、expiry）。
2. **本地 IAM 作为身份权威源**：本地 IAM 持有 principal 记录（角色、权限、状态）。Keycloak 仅做认证，不做授权。OIDC subject 映射到本地 principal，不信任外部 claims 中的角色断言。
3. **issuer + subject 绑定**：principal 由 `(oidc_issuer, oidc_subject)` 元组唯一标识。issuer 变更视为不同主体。
4. **JIT pending approval**：首次 OIDC 登录且无匹配 principal 时，自动创建 pending 状态的 principal 记录，写入 Audit Log，等待安全管理员审批。pending principal 不可执行任何操作。审批路径通过现有 M-Policy approval flow。
5. **BFF HttpOnly session**：M-UI BFF 在 OIDC callback 验证成功后签发 HttpOnly、Secure、SameSite=Strict session cookie。BFF 持有 session → principal 映射，前端不接触 token。session TTL、refresh 和 logout 由 BFF 管理。
6. **break-glass**：双人 30 分钟 TTL break-glass 路径。通过现有 `break-glass-reviewer` 角色 + M-Policy multi-approval 实现。break-glass session 写入强制 Audit 事实。
7. **OIDC 故障矩阵**：覆盖以下故障场景的 fail-closed 行为：provider 不可达、token 签名无效、issuer 不匹配、subject 无匹配 principal（pending 创建）、session 过期、BFF 不可用、M-Policy 不可用（break-glass）。每个场景必须有对应测试。

**明确排除**：

- SAML / 通用 SSO 联邦。
- MFA 实现（架构预留，不在本轨道实现）。
- password authentication。
- 用户管理 UI（通过 CLI 和 API 管理 principal）。
- group / team / department identity model（DFW-004 仍推迟）。
- refresh token / token family model（BFF session 替代）。

#### 实现前置文档更新

实现前必须先更新：

- 新增 OIDC/IAM 架构 ADR（`docs/adr/ADR-{N}-oidc-iam-architecture.md`，标题待定）。
- 更新 `docs/security/SECURITY-MODEL.md`：OIDC 威胁模型、session 安全、break-glass 访问控制。
- 更新 `docs/services/m-ui-bff.md`：OIDC callback、session 管理、logout 行为。
- 更新 `docs/contracts/REST-API-MVP.md`：OIDC login/logout/session 端点。
- 更新 `docs/testing/TESTING.md`：OIDC 故障矩阵测试门禁。

#### 验收测试要求

- OIDC login 成功路径：从 Keycloak redirect 到 BFF session 建立。
- OIDC login 失败矩阵：每种故障场景的 fail-closed 验证。
- JIT pending principal：首次登录自动创建、不可操作、审批后可操作。
- Session 安全：HttpOnly/Secure/SameSite cookie 属性、session 过期、logout 清除。
- Break-glass：双人审批、30 分钟 TTL、强制 Audit。

---

### DFW-028: Production Secret Backend

Status: **重新打开（reopened）** — 由生产轨道（post-v0.1 Production Track, `MERISTEM-ROADMAP.md §7`）重新激活。

Owner: Core / security / operations.

Source: `MERISTEM-ROADMAP.md §7`, `docs/adr/ADR-F02-architecture-organization.md`.

#### 重新打开范围

生产轨道将 DFW-028 范围聚焦为 Vault HA 部署 + 密钥托管与轮换 + SecretProvider v0.2 对齐。

**包含（acceptance conditions）**：

1. **Vault HA 部署**：HashiCorp Vault 在 3 台 control/state VM 上以 HA 模式运行，使用 Integrated Storage (Raft) 后端。Vault 集群健康检查接入 Core 服务生命周期。
2. **auto-unseal / key custody**：Vault auto-unseal 机制（通过 cloud KMS 或本地 shamir 方案，具体由实现 ADR 确定）。unseal key 分片保管流程文档化。Vault seal 状态由 Core 监控并在只读模式下拒绝密钥操作。
3. **secret-zero 问题**：Vault 初始 root token 和 unseal key 的安全注入与保管。禁止将 root token 写入配置文件或环境变量。
4. **secret rotation**：支持手动触发的 secret rotation（`POST /api/v0/secrets/:id/rotate`）。rotation 写入 Audit Log（旧版本停用、新版本激活、rotation 操作者）。自动 rotation 调度在架构中预留接口，不在本轨道实现。
5. **SecretProvider v0.2 对齐**：将 Core SecretRef 的 SecretProvider 接口从 v0.1（本地开发存储）升级到 v0.2（Vault backend）。Provider 接口支持 read / write / rotate / revoke 操作，fail-closed 语义（Vault 不可达时拒绝所有 secret 操作）。
6. **redaction 与审计**：所有 secret 值不得进入日志、OpenSearch、事件 payload、错误响应、或 trace span attributes。secret 访问操作（read/write/rotate/revoke）写入 Audit Log，记录操作者、secret ID、操作类型和 correlation ID，不记录 secret 值。

**明确排除**：

- cloud KMS 直接集成（如 AWS KMS、GCP Cloud KMS）作为 secret 存储后端。
- envelope encryption 服务。
- 跨节点 secret 自动分发。
- 生产备份 / restore 流程（运维 ADR 中预留）。
- 自动 rotation 调度执行。

#### 实现前置文档更新

实现前必须先更新：

- 新增 Vault 集成 ADR（`docs/adr/ADR-{N}-vault-integration.md`，标题待定）：Vault HA 拓扑、unseal 策略、secret-zero 处理、SecretProvider v0.2 契约。
- 更新 `docs/security/SECURITY-MODEL.md`：Vault 访问控制、secret 操作审计规则、redaction 规则。
- 更新 `docs/operations/RUNBOOK.md`：Vault HA 运维（seal/unseal、备份、故障恢复）。
- 更新 `docs/testing/TESTING.md`：Vault 集成测试门禁（HA failover、seal 状态拒绝、rotation 审计）。

#### 验收测试要求

- Vault HA：节点故障时集群自动 failover，secret 读写正常。
- auto-unseal：Vault 重启后自动解封，无需人工干预。
- Seal 状态拒绝：Vault sealed 时所有 secret 操作返回 fail-closed 错误。
- Rotation：手动 rotation 成功、旧版本停用通知、Audit Log 记录。
- Redaction：secret 值不进入日志/OpenSearch/事件/错误响应/trace span。
- Provider v0.2 迁移：从 v0.1 本地存储到 v0.2 Vault backend 的迁移路径可测试。

---

### DFW-029: Broad Config Platform And Config Authoring UI

Status: deferred from Config Lifecycle v0.1.

Owner: Core / M-UI / affected domain services.

Source: `docs/config/CONFIG-LIFECYCLE.md`.

Deferred work:

- collaborative config editing.
- M-UI config authoring workflows.
- rollout waves.
- broad node-level config distribution.
- feature flag platform.
- automatic drift remediation.
- cross-cluster config federation.

Reason deferred:

- Config Lifecycle v0.1 implements the minimum authoritative lifecycle, not a broad configuration product.

Reopen trigger:

- multiple domains need operator-authored configuration with safe rollout and rollback beyond the v0.1 control plane.

Required before implementation:

- UI / BFF contracts.
- domain apply contracts.
- rollout / rollback semantics.
- collaborative draft state owner.
- tests for partial apply, failed ack, rollback, and permission-aware UI behavior.

---

### DFW-042: Event Catalog Parity For Deferred Subjects

Status: deferred from v0.1 closure / acceptance closure.

Owner: Core / M-Task / M-Net / M-Policy / M-Log (per subject).

Source: `docs/events/EVENT-CATALOG.md`, `tests/contracts/schema-coverage.md`, `docs/events/DEFERRED-EVENT-GAP-MAP.md`.

Deferred work:

- Implement real publishers and Effect Schema contracts for subjects listed in `docs/events/DEFERRED-EVENT-GAP-MAP.md`.
- Add contract test fixtures and round-trip tests when each subject becomes active.
- Update `tests/contracts/schema-coverage.md` active / deferred sections when a subject moves from deferred to active.

Reason deferred:

- Acceptance closure scope is audit and signoff only.
- These catalog subjects have documented payload skeletons but no active publisher in the current codebase.
- Implementing them would expand Core, M-Task, M-Net, identity, SecretRef, config, or audit behavior beyond v0.1 closure scope.

Reopen trigger:

- A deferred subject gains a real publisher in its owning service.
- The owning service definition or ADR explicitly accepts the new runtime capability.

Required before implementation:

- `docs/events/DEFERRED-EVENT-GAP-MAP.md` row updated with owner, reason, and reopen trigger.
- Effect Schema payload contract in `packages/contracts`.
- Publisher implementation in the owning service.
- Contract tests covering decode/encode and at least one failure path.
- `tests/contracts/schema-coverage.md` active / deferred update.
- `docs/events/EVENT-CATALOG.md` update if subscribers or payload semantics change.

---

### DFW-030: M-UI v0.2 Approval And Profile Foundation Scope

Status: foundation declared for DFW-002 and DFW-016 reopening path. Foundation now includes mutation execution flows.

Owner: M-UI / M-UI BFF.

Source: `docs/ui/SDUI-SCHEMA.md`, `docs/services/m-ui-bff.md`.

This entry is **not** full completion of DFW-002 or DFW-016. Foundation read-only UI pages, display-only command previews, and BFF route contracts were implemented under the m-ui-v02-approval-profile-foundation plan. **Approve/reject/profile mutation execution flows have been implemented** under the deferred-work-commandwell-mutations plan. Remaining deferred items are documented below.

Foundation + mutation work completed:

- SDUI v0.2 route schema entries for `policy.approvals`, `policy.approvals.detail`, `network.profiles`, `network.profiles.detail`.
- Allowed component kinds: `ApprovalQueuePanel`, `ApprovalDetailPanel`, `NetworkProfileListPanel`, `NetworkProfileDetailPanel`, `OperationalCommandPreview`.
- Display-only command entries: `policy.approval.approve.preview`, `policy.approval.reject.preview`, `network.profile.enable.preview`, `network.profile.disable.preview`.
- BFF route entries for approval and profile data, plus Core/public read and write facades.
- Foundation M-UI pages for approval queue, approval detail, network profile list, and profile detail.
- **Execute command implementation**: `policy.approval.approve.execute`, `policy.approval.reject.execute`, `network.profile.enable.execute`, `network.profile.disable.execute` — all routed through BFF → Core public facades → M-Policy/M-Net public routes.
- Inline CommandWell mutation UI with confirmation, success evidence, error passthrough, post-action refresh. No toast/snackbar. Chinese labels.
- Explicit BFF rule: must not call `/internal/v0/*` M-Policy or M-Net routes.
- Contract, UI-contract, failure-mode, and e2e test coverage.

Still deferred (DFW-002):

- LLM-assisted approval review.

Still deferred (DFW-016):

- Real M-Net data-plane behavior (DERP/TCP/UDP/Headscale).

Reopen trigger:

- Approval flow REST and CLI contracts are stable and DFW-002 reopens.
- M-Net profile lifecycle REST and CLI contracts are stable and DFW-016 reopens.

Resolved in this tranche:

- DFW-002: SDUI / BFF display contract, CommandWell behavior for approve / reject, UI contract tests.
- DFW-016: BFF display contract, SDUI schema update, UI contract tests for high-risk command placement and non-misleading data-plane wording.
- DFW-030: Foundation now includes mutation execution flows. Display-only previews coexist with live execute commands.

---

## 3. Deferred Refactor Work (Repo-Wide Cleanup Pass)

> 以下条目记录 repo-wide 结构清理通过（8 commits）中识别但**刻意未执行**的重构工作。主要阻塞原因：78 个未提交文件属于 M-Deploy facade feature WIP，清理会纠缠该分支。每条记录具体原因和解除条件，确保 WIP 落地后可立即拾起。

---

### DFW-040: apps/core 四条循环依赖

Status: **resolved（2026-09-11）**——apps/core 循环 4 → 0，规则已提为 `error`。

Owner: Core。

Source: `apps/core/src/types.ts`, `apps/core/src/types/shared.ts`, `apps/core/src/types/mdeploy-facade.ts`, `apps/core/src/routes/facade/facade-support.ts`, `apps/core/src/middleware/auth.ts`。

问题描述:

- `apps/core/src/types/mdeploy-facade.ts:14` 从 `../routes/facade-support.ts` 导入 `FacadeServiceResult`，形成 `types/ → routes/` 反向边，引发四条循环依赖。
- `FacadeServiceResult<T>` 结构上等价于 `Result<T, ServiceErrorLike>`。

已实施修复:

1. 新建 `apps/core/src/types/facade-result.ts`，定义 `ServiceErrorLike` 与 `FacadeServiceResult<T> = Result<T, ServiceErrorLike>`。
2. `apps/core/src/routes/facade/facade-support.ts` 改为从 `../types/facade-result.ts` re-export（保持兼容）。
3. `apps/core/src/types/mdeploy-facade.ts:14` 改为从 `./facade-result.ts` 导入。
4. `no-circular` 对 `apps/core` 提为 `error`（`no-circular-core`）。

Resolution evidence（2026-09-11 实测）:

- `bun run depcruise` → apps/core 循环 4 → **0**；`no-circular-core` 为 error 后仍 exit 0。

---

### DFW-041: services/m-net 六条预存循环依赖

Status: **resolved（2026-09-11）**——`warn` 期间实测的 SCC 是 **13 文件 / 14 条循环边**（原记录的
「6 条」不准确），依赖反转后 0；规则已提为 `error`。

Owner: M-Net。

Source: `services/m-net/src/deps.ts`, `services/m-net/src/clients.ts`, `services/m-net/src/migration/migration-engine.ts`, `services/m-net/src/migration/migration-engine-rollback.ts`, `services/m-net/src/profile/profile-workflow-types.ts`, `services/m-net/src/data-plane/mnet-dataplane-support.ts`, `services/m-net/src/data-plane/data-plane-security-support.ts`。

问题描述:

- hub 循环经过 `deps.ts` ⇄ `clients.ts` ⇄ `migration-engine*.ts` ⇄ `profile-workflow-types.ts`。`deps.ts` 出现在 3 条循环中，`clients.ts` 出现在 2 条，其余文件各出现 1 次。
- 需要真正的依赖反转而非简单文件移动。

Reason deferred:

- 预存问题，超出结构清理通过的范围。

Reopen trigger:

- 一个专门的 m-net 依赖反转任务。

---

### DFW-033: 文档内容去重与目录移动

Status: **resolved（2026-09-11）**——去重、目录移动与结构树对齐均已完成。

Owner: docs / operations。

Source: `docs/operations/RUNBOOK.md`, `docs/operations/MNET-V02-RUNBOOK.md`, `docs/operations/M-NET-THREE-NODE-VALIDATION.md`, `docs/operations/READINESS-SUMMARY.md`, `docs/releases/`, root `README.md`。

已实施（2026-09-11）:

- **RUNBOOK §5.1 去重**：`v0.2 NetBird Direction` 段落改为指向 `MNET-V02-RUNBOOK.md` §2 的
  故障矩阵，不再复述；`Closed-Loop Failure and Recovery Semantics` 收敛为「权威来源 +
  运维结论」形式，删除与 `SECURITY-MODEL.md` / `services/m-net.md` 重复的条文，但**保留运维
  专属结论**（tunnel health 只经 node runtime-token 上报、PostgreSQL fact 解码失败的处置、
  break-glass 30 分钟硬过期）。
- **RUNBOOK §6.1 去重**：删掉重复的 `mnet-harness` 命令列表（同一组命令此前列了两遍：`bun run
  mnet:harness:*` 与 `mnet-harness *`），命令集中为规范形式，完整分步流程指向
  `M-NET-THREE-NODE-VALIDATION.md` §4–§5。
- **READINESS-SUMMARY 移动**：`docs/production-readiness/READINESS-SUMMARY.md` ->
  `docs/operations/READINESS-SUMMARY.md`（该文件此前**无任何入链**，原「会断开 README:249
  链接」的顾虑不成立，README 中并无该链接）；`docs/README.md` 的 operations 行已补引；
  其 gate 记录中过期的「5 条循环警告」已更新为「0 循环 + 规则提为 error」。
- **结构树对齐**：`README.md`「Monorepo 结构」补全缺失的 services（m-deploy）与 packages
  （auth/common/db/internal-http/nats-rpc/secrets/telemetry），docs 子目录同步为 operations /
  releases；`MERISTEM-DEV.md` §1.2 的 Core 树改为分层后的实际形态（`storage/` 目录、
  `routes/` 按域子目录）。
- **`docs/` 保持独立**：`docs/releases/` 未被移动——其 release notes 内容被
  `tests/contracts/v02-gate-split.contract.test.ts` 断言，移动只会增加风险而无收益。

Resolution evidence（2026-09-11 实测）:

- `test:contracts` 全绿（含 `v02-gate-split.contract.test.ts`）。
- 仓库内已无指向 `docs/production-readiness/` 的引用。
- `README.md` 与 `MERISTEM-DEV.md §1.2` 的结构树与当前目录一致。

---

### DFW-034: apps/core/src/ 与 apps/core/src/routes/ 目录分层整合

Status: **resolved（2026-09-11）**——按域分层已完成，两个目录均降到 flat-directory 阈值内。

Owner: Core。

Source: `apps/core/src/`（分层前 20 flat files）, `apps/core/src/routes/`（分层前 33 flat files）。

已实施分层（纯搬迁，行为不变）:

- 根目录 9 个 `storage-adapter*.ts` 收敛到 `src/storage/`；根文件 20 -> 11。
- `routes/` 33 个文件按域收敛到 11 个子目录（identity / config / secrets / network /
  node / log / policy / projection / service / health / facade）；routes 根平铺 33 -> 0。
- 复用既有 `types/`、`schemas/`、`middleware/`、`adapters/`、`testing/` 子目录，未新建
  catch-all 目录；入口 `app.ts` / `index.ts` / `public-types.ts` 保留在 `src/` 根。
- 所有相对导入（含指向 `packages/` 的）按新深度重算；仓库外部导入点极少（仅 3 个测试文件
  触碰 routes），无 path alias 变更。

Resolution evidence（2026-09-11 实测）:

- typecheck / lint / depcruise（0 循环）/ contracts / failure-modes / integration 全绿。
- 净改动仅为导入路径与随新位置的 import 排序，逐例核实无逻辑新增。

---

### DFW-035: 两个超尺寸文件无法拆分

Status: **resolved（2026-09-11）**——两个文件已拆分到 500 行内，allowlist 条目已移除。

Owner: scripts / M-Deploy。

Source: `scripts/v02-deploy-proof.ts`（拆分前 1271 行）, `services/m-deploy/src/testing.ts`（拆分前 602 行）。

已实施拆分（行为不变）:

- `scripts/v02-deploy-proof.ts` 1271 -> 437 行，抽出三个共址模块：
  - `v02-deploy-proof-types.ts`（143 行）：类型/端口契约。
  - `v02-deploy-proof-support.ts`（365 行）：环境/进程工具、受管服务定义、`defaultDeps`、
    `finalizeReport`。
  - `v02-deploy-proof-context.ts`（415 行）：context 准备、基础设施与受管服务拉起。
  - 主文件 re-export `DeployProofReport` 等公共类型，保持既有消费点（`mnet-v02-live-proof-*`）兼容。
- `services/m-deploy/src/testing.ts` 602 -> 441 行，抽出 `testing-store.ts`（228 行）承载内存 store 端口。
- 移除 `tests/contracts/file-size-budget.contract.test.ts` 中两条含过期 `WIP-BLOCKED` 理由的
  allowlist 条目（该守卫要求 allowlist 是收缩棘轮——条目对应的文件已合规即必须移除）。

Resolution evidence（2026-09-11 实测）:

- 全部拆出文件 < 500 行；`file-size-budget.contract.test.ts` 4/4 通过（含「收缩棘轮」与
  「条目必须仍存在」两条守卫）。
- typecheck / lint / depcruise（0 违规）/ contracts / failure-modes / integration 全绿。

---

### DFW-036: WIP 文件格式化漂移（发布阻塞项）

Status: **resolved（2026-09-11）**——原有 23 个 WIP 违规文件的格式化随 M-Deploy facade
一起落地，`test:v02-gates` 的第一个 gate 已不再阻塞。

Owner: M-Deploy facade feature owner。

Source: `bun run format:check` output, `scripts/git-hooks/pre-push`。

问题描述（历史）:

- `bun run format:check` 是 `scripts/git-hooks/pre-push` 和 `test:v02-gates` 链的**第一个** gate。HEAD 时报 106 个违规文件。
- 其中 83 个已在清理通过中格式化（commits `5dc36d2` 和 `a70c0f5`，经 transpiler normalization 验证语义等价）。
- 剩余 23 个违规文件全部为当时的 WIP 文件。

Resolution evidence（2026-09-11 实测）:

- `bun run format:check` → **exit 0，1038 个文件，0 违规**。
- `test:v02-gates` 全链通过（exit 0）。

Reopen trigger:

- 无。若未来再次出现格式化漂移，作为新的 WIP 落地项处理，而不是重开本项。

---

### DFW-037: 已知合约测试间歇性失败（flake）

Status: obsolete（作为 deferred 工作项）——保留为观察记录，不构成待办。

Owner: test infrastructure。

Source: `bun run test:contracts`。

观察记录:

- 规划阶段发现一次间歇性失败：1156 pass / 1 fail → 连续三次 re-run 均 1157 / 0。
- 清理通过中再次出现：`packet forwarding architecture guard` 测试 1158 pass / 2 fail → re-run 即 1160 / 0。
- 无代码变更即恢复通过，确认为 flake 而非回归。

基线更新（2026-09-11 实测，替代原记录的 1174）:

- **1249 pass / 0 fail across 156 files**（`bun run test:contracts`）。原 1174 记录已过期。
- 本项已无可执行的工程动作，故标记 obsolete；仅保留以下操作建议。

处理建议:

- 未来 agent 遇到 `test:contracts` 单次不可复现失败时，**re-run 一次**再开始诊断。
- 如同一测试连续两次失败，则视为真实回归进行调查。

---

### DFW-038: services/m-net/src 120 个平铺文件的目录分层

Status: **resolved（2026-09-11）**——三项硬前置全部满足（DFW-041 已解决、M-Deploy facade
WIP 已落地、`@m-net/*` path alias 已独立落地并通过全 gate 链），搬迁已完成。

Owner: M-Net。

Source: `services/m-net/src/`（搬迁前 123 个平铺 `.ts` 文件，实测；登记表原记的 115/120 均已过期）。

已实施搬迁（2026-09-11）:

- 按登记表冻结的**六领域**切分（不再重新决策）：`profile/`(20)、`closed-loop/`(15)、
  `migration/`(15)、`agent/`(20，含原观察到的 node 簇)、`forced-relay/`(8)、`data-plane/`(18，
  复用既存目录)。96 个文件迁入，27 个横切模块留在 `src/` 根（`deps`/`clients`/`types`/
  `shared`/`config`/`runtime`/`store-codecs`/`route-helpers`/`route-schemas`/
  `event-log-factories`/`external-client-factories`/`readiness`/`ready-route`/`internal-routes`/
  `policy-guard`/`suspended-operations`/`network-service`/`operational-*` 等），入口文件
  `app`/`index`/`public-types`/`startup` 保留在 `src/` 根。
- 未采用 `node/`/`global/`/`network/`/`operational/` 独立簇：`src/` 根保留 61 个 barrel 转发
  文件被登记表明令禁止，而横切模块在六簇里无自然归属；`global-defaults-store*`（全局 profile
  默认值与批量 switch）并入 `profile/`，`operational-read-model*` 与 `network-service` 属网络
  读取/服务边界，留在根。
- 外部导入点（63 个文件）改用 `@m-net/<cluster>/<name>.ts` 别名；路径字符串类引用
  （spawn args / `Bun.file` / allowlist 的精确 `source:`）改为新的字面路径。实测量级高于登记表
  记录的「70 文件 / 61 模块」。
- **纯搬迁，零行为变更**：所有内容改动仅为导入说明符重写与随别名变化的 import 排序
  （格式化器把部分长 import 拆成多行，故 numstat 有少量净增行，已逐例核实无逻辑新增）。

Resolution evidence（2026-09-11 实测）:

- `typecheck` 通过；`depcruise` 0 违规（774 模块 / 2727 依赖边，`no-circular-*` 保持 error）；
  `test:contracts` 1249 / 0；`test:failure-modes` 335 / 0；`test:integration` 98 / 0。
- 新增 `tests/contracts/m-net-path-alias.contract.test.ts` 锁定别名在三个消费方
  （Bun / tsc / depcruise）与边界守卫中的解析。

保留（未搬迁）: `services/m-net/src/` 根仍有 27 个横切模块 + 6 个领域目录，属预期终态。

Reopen trigger:

- 无。若未来需要把横切模块进一步归类，应另开条目，而不是重开本项。

---

### DFW-038-original-notes: 搬迁前的问题描述（存档）

问题描述:

- `services/m-net/src/` 是仓库内最大的单层目录，仅有一个既存子目录 `data-plane/`。
- 命名已自然聚成领域簇：profile（15）、closed-loop（15）、migration（13）、agent（12）、node（8）、forced-relay（8）、data（5）、operational（4）、network（4）、global（4）。
- 后缀同时聚成层次簇：workflow（11）、types（9）、support（9）、routes（9）、store（4）、runtime（4）。

爆炸半径（已实测）:

- 仓库外部文件从 `services/m-net/src/` 导入，集中在 `tests/contracts`、`tests/integration`、
  `tests/failure-modes`、`scripts/`、`tests/perf`、`tests/services/m-net`、
  `apps/core/src/adapters` 等。
- 全部为硬编码相对路径，搬迁前仓库没有配置任何 path alias。
- 引用最密集：`profile-store.ts`、`suspended-operations.ts`、`app.ts`、`data-plane-store-memory.ts`。

搬迁目标形态（当时定档）:

- 采用按领域（feature-based）切分：`profile/`、`closed-loop/`、`migration/`、`agent/`、`forced-relay/`、`data-plane/`。已按此执行。
- 不在 `src/` 根保留单文件 re-export barrel。已遵守。
- 外部导入先引入 path alias，再据此更新外部导入点。已执行。

---

### DFW-039: Real NetBird Infrastructure Viability Proof And Cross-Host Dataplane Verification

Status: re-scoped-with-trigger —— 依赖运营商提供的真实 NetBird Signal/Relay/STUN 基础设施与
跨主机网络，agent 不可完成；`Resolved now` 部分已落地，余下为运营商执行的验收步骤。

Owner: M-Net / node-agent with ADR-N04.

Source: ADR-N04 viability gate (`bun run mnet:v02:sidecar-proof`), production
networking plan.

Resolved now:

- M-Net NetBird adapter `probeRuntime()` performs a real `netbird status`
  probe with typed outcomes (running / unreachable / management dependency).
- node-agent sidecar supervisor spawns the NetBird client with config-path
  argv, supervises crashes with backoff restarts, escalates SIGTERM → SIGKILL
  on stop, and probes process health.
- node-agent periodically reports tunnel/sidecar health to M-Net
  (`mnet.sidecar.health.v0` operational events) via the node-runtime
  tunnel-status route; the operational snapshot and M-UI dataplane panel
  surface the reported state.
- Contract tests cover the adapter probe matrix, supervisor lifecycle
  transitions, the tunnel-status ingest route and the reporter derivation.

Still deferred:

- Running `mnet:v02:sidecar-proof` against real NetBird Signal / Relay / STUN
  infrastructure (requires operator-provisioned infrastructure; the proof is
  the viability gate, and the ADR-N04 fallback is the existing local WireGuard
  rendering plus NetBird Signal/Relay infrastructure).
- Cross-host ICMP verification and NAT traversal (relay fallback) evidence
  through the real sidecar in the multi-host harness.

Reason deferred:

- The proof gate and cross-host dataplane evidence depend on physical hosts
  and NetBird artifacts outside this repository; per ADR-N04 they are an
  operator-executed acceptance step, not automatable in CI.

Reopen trigger:

- Operator provisions real NetBird Signal/Relay/STUN infrastructure and runs
  `bun run mnet:v02:sidecar-proof` against it, then supplies cross-host
  ICMP/NAT-traversal evidence from the multi-host harness.

### DFW-032: Same-Host Fleet Operator Tooling And Member Lifecycle Hygiene

Status: partially resolved（2026-09-11）——正确性缺陷（无效占位公钥、生产接线缺失、
relay/空 map/锁泄漏）已修复；剩余的 heartbeat 驱动自动清理与 correlationId 透传仍 deferred。

Owner: M-Net / node-agent.

Source: WSL2 five-container fleet smoke (`meristem-cli` deployed control
plane + five agent-mode node containers on one podman bridge).

Resolved now:

- agent-mode onboarding deadlock removed: a connected node with no membership
  yet reports healthy (heartbeat), and the runtime-key registration 404
  (`network.not_found`) is tolerated as pre-membership state instead of
  degrading the agent.
- default reported agent version bumped to `0.2.0` — `0.1.*` agents are
  rejected by the v0.3 data-plane legacy guard.
- `Dockerfile.service` gained `EXTRA_PACKAGES` (node-agent ships
  iproute2 + wireguard-tools so it can actually apply WireGuard).
- bootstrap generates the network-map signing keypair (Ed25519) into the
  certs volume; m-net loads it via
  `MERISTEM_MNET_MAP_SIGNING_PRIVATE_KEY_FILE`.
- node-agent accepts `MERISTEM_NODE_AGENT_ADVERTISED_ENDPOINT` to override
  STUN discovery (same-host fleets / 1:1-NAT hosts).
- WSL2 five-container smoke passed end to end: join ingress ticket redemption,
  runtime key registration, signed map distribution and verification,
  `wg` interface + peers with real keys, and HTTP traffic across all tunnel
  pairs (stem↔stem, stem↔leaf, leaf↔leaf).

Resolved now (2026-09-11, 续批):

- Placeholder runtime keys eliminated: map materialization no longer derives or
  persists a `bootstrap-<nodeId>` placeholder key. A member is rendered into peer
  sets only when it holds a real registered runtime key (`keyId` not
  `bootstrap-<nodeId>` and `status = active`); keyless members are quarantined
  out of the rendered map instead of emitting keys `wg setconf` rejects.
  Read-time detection plus an idempotent cleanup of historical placeholder rows
  in `migrateMNetDataPlane` cover already-deployed data.
- Fail-closed on an all-keyless member set: if NO member holds a runtime key,
  materialization returns typed `409 network.no_runtime_keys` instead of
  publishing a signed map with zero members (which would report enable success
  while no node could establish a tunnel). Node key registration does not depend
  on the map, so this does not deadlock first enable.
- Relay selection now uses the **quarantined** rendered member set: a keyless
  member can no longer be chosen as relay and written into `mnet_relay_assignments`,
  the enable response, or the `mnet.relay.assigned` payload.
- Enable-path operation lock is released on every failure return (previously only
  the success path released it, so a failed enable blocked retries for the 15-min
  TTL).
- Deterministic key selection: `listByNode` now orders by `created_at desc`, so a
  stale placeholder can no longer outrank a real key under non-deterministic row
  order.
- Production wiring fixed: `deleteNetwork` / `removeMember` /
  `updateNetworkMetadata` / `refreshNetworkMap` were never injected in
  `startup.ts`, so the internal routes returned `503 feature.unavailable` and the
  Core DELETE/PATCH endpoints were unusable in a deployed service. All four are
  now wired, with member removal re-materializing the signed map
  (`network-map-refresh.ts`) and a last-member removal treated as a no-op.
- Member removal no longer deletes the node-scoped sidecar desired config until
  the node has left every network.

Still deferred:

- Automated re-render/purge driven by heartbeat expiry: ghost membership rows are
  now harmless for map rendering (their purged/absent runtime key quarantines
  them), but the membership-of-record row still needs an operator
  `network remove-member` or a future approved lifecycle sweep. `offline` is
  deliberately kept out of the map-exclusion seam because `listMembers` also
  feeds operator listings, topology, and migration offline assessment.
- End-to-end correlationId propagation for the M-Net network-mutation port family:
  the refresh currently generates a local correlationId (marked `FIXME` in
  `network-service.ts`); threading it through would be a cross-service contract
  change.

Reason deferred:

- Both remaining items are operator-policy/lifecycle-hygiene work beyond the
  smoke scope; the correctness defects (invalid placeholder keys, dead endpoints)
  are resolved above.


---

### DFW-043: Core Network-Lifecycle Event Outbox And Publisher Ownership

Status: deferred — registered 2026-09-11 by the register audit. Not implemented.

Owner: Core / M-Net.

Source: `apps/core/src/routes/network/networks-support.ts`, `apps/core/src/routes/network/networks.ts`,
`services/m-net/src/network-service.ts`, `docs/events/EVENT-CATALOG.md`,
`docs/contracts/REST-API.md`, `docs/contracts/CONTRACT-VERSIONING.md`.

问题描述:

- Core 的 `mnet.network.*` / `mnet.membership.*` 事件发布是「先提交后发布」的双写：变更在
  M-Net 提交，事件在 Core 内联发布。发布失败时 Core 返回 typed 503，但**已提交的变更没有持久
  补发路径**（除 DELETE 的幂等重放外），客户端不重试或 Core 在提交后崩溃时事件永久丢失。
- 对照：M-Deploy（`event-outbox.ts`）与 M-Net closed-loop（`closed-loop-store-pg.ts`）都有
  「变更 + event-intent 同事务提交」的持久 outbox，只有 Core 的网络生命周期没有。
- 现状缓解：会重试的客户端可经 `unwrapNetworkDeleteResult` 把 `network.not_found` 收敛为幂等
  成功并补发 `payload.replayed=true`；该路径**只覆盖 DELETE**，且不覆盖「客户端不重试」。
  `replayed=true` 同时覆盖「补发」与「从未存在」，消费方不可区分——区分语义以本条
  tombstone 台账为前置（2026-09-12 审查注记）。

Reason deferred:

- 这不是本批最小正确性范围内的机械修复：需要新表 + store + sweep 子系统、把发布者从 Core 迁到
  M-Net（或让 Core 拥有 outbox）、并重新设计 `replayed` 语义。
- 发布者迁移本身 wire 不变（subject/payload 相同），但 REST 的 503→pending 响应语义属破坏性
  公开契约变更，按 `CONTRACT-VERSIONING.md` 需要版本 + 兼容窗口。
- 登记表 §1 要求先重开 owning service definition / ADR；本项目前没有决定事件发布者归属的 ADR。

Required before implementation:

- 新 ADR 决定事件发布者归属（谁拥有变更 => 谁拥有事件）。
- 更新 `docs/services/core.md` §3 与 `docs/services/m-net.md` §3/§5。
- REST `503 -> typed pending publication` 的版本化 + 兼容窗口 + 迁移说明。
- outbox 表 `network_id` **不得** FK 到 `networks.id`（删除 intent 必须活过网络行）。

Reopen trigger:

- 上述 ADR 与版本化契约落地后，作为独立 PR 实施。

---

### DFW-044: M-Net Operator-Facing Ledger-Prune Endpoint

Status: deferred — registered 2026-09-11 by the register audit. Not implemented.

Owner: M-Net.

Source: `docs/contracts/REST-API.md`（网络删除的「permanently undeletable in v0.2」consequence）,
`services/m-net/src/network-service.ts`（`network.closed_loop_facts_present` 等留存台账门禁）。

问题描述:

- 删除网络时，closed-loop facts / profile-switch 成员关系 / 未终结挂起操作属于**留存台账**，
  存在即 409 拒绝；REST-API.md 明确记载：一旦网络累积了这些引用，它在 v0.2 **永久不可删**，
  因为没有面向运维的 ledger-prune 端点。

Reason deferred:

- 新增 prune 端点属新 REST 契约 + 权限/审计面，需要先更新契约文档与 SECURITY-MODEL；
  超出本批最小正确性范围。

Required before implementation:

- 新 REST 契约 + `network:*` 权限族声明 + Audit 事实定义。
- `docs/security/SECURITY-MODEL.md` 与 `docs/contracts/REST-API.md` 同步更新。
- 明确 prune 的留存语义（哪些台账可销毁、是否需要双人审批）。

Reopen trigger:

- 运维需要删除已被留存台账门禁挡住的网络时。

---

### DFW-045: dependency-cruiser False-Green (Regression Guard)

Status: **resolved（2026-09-11）**——根因已修复，本项保留为回归防护记录。

Owner: CI / repo tooling。

Source: `.dependency-cruiser.cjs`, `tests/contracts/dependency-cruiser-parse-coverage.contract.test.ts`,
`package.json`（`typescript7` alias）。

问题描述（根因）:

- 本仓同时安装 `typescript@6.0.3` 与别名 `typescript7`（`npm:typescript@7.0.2`）。Bun 把真实包名
  `typescript` 提升到 `.bun/node_modules` 并指向 7.0.2，超出 dependency-cruiser 声明的
  `>=2.0.0 <7.0.0`，使其内置 tsc 转译器 `isAvailable()` 返回 false
  （`src/extract/tsc/extract.mjs` 的 `shouldUse` 合取项）。于是 `.ts/.tsx/.d.ts` 全部不被解析，
  退化为 acorn-loose 解析原始 TS：目录仍被巡到但**依赖边被丢弃**，`no-circular` 等规则静默失效。
- 实测：修复前只巡到 133 模块 / 368 依赖边，619 个后端 `.ts` 中仅 5 个被巡到（且全在 m-ui）。

已实施修复:

- `.dependency-cruiser.cjs` 显式 `parser: 'swc'` + 新增 `@swc/core` devDependency（`>=1 <2`）。
- 已知代价（注释记录）：swc 不产出 `type-only` 依赖类型标记。
- 回退方案：移除 `typescript7` 别名、typecheck 改用 TS6。

Resolution evidence（2026-09-11 实测）:

- 修复后 774 模块 / 2727 依赖边，暴露的 18 条真实循环已由 DFW-040/041 全部清零。
- 新增 `tests/contracts/dependency-cruiser-parse-coverage.contract.test.ts` 锁定依赖边数下限，
  并含一个「种入循环必须被检出且退出码非零」的正断言，防止再次静默退化为假绿。

---

### DFW-046: Orphan Test Roots Not Typechecked

Status: deferred — registered 2026-09-11 by batch B acceptance review.

Owner: test infrastructure。

Source: `tests/apps`, `tests/services`, `tests/packages`（共约 380 个测试）。

问题描述:

- 这三个测试根目录运行时会通过（`bun test` 全绿），但**不在 `tsconfig.json` 的 include 内**，
  因此从不参与 `typecheck` 门禁。
- 把它们加入 typecheck 会立即暴露既存类型错误（非本次 B 批次引入）：
  `tests/apps/core/adapters-auth.test.ts`（泛型参数数量）、
  `tests/apps/core/service-lifecycle.test.ts`（`CoreStorage` mock 缺 `revokeNodeCredential`、
  `exactOptionalPropertyTypes`）、`tests/apps/m-ui/bff.test.ts`（`fetch` mock 缺 `preconnect`）、
  `tests/packages/auth/auth.test.ts` 与 `tests/packages/telemetry/telemetry.test.ts`
  （overload / `noUncheckedIndexedAccess`）等。
- 2026-09-11 的 B 验收已把它们纳入**运行时** test gate（`test` 与 `test:v02-gates` 现包含
  `tests/apps` / `tests/services` / `tests/packages` / `tests/guards`），堵住「测试不被运行」
  的假绿；但仍未纳入类型门禁。

Reason deferred:

- 修复这批既存类型错误属独立工作，且需要逐个 test 决定是收紧 mock 类型还是放宽被测类型；
  不应与结构重构批次混在一起。

Reopen trigger:

- 一次专门测试类型债清理排期到达时：逐个修正类型错误并把三个根目录加入 `tsconfig.json`。

---

### DFW-047: node-agent Deep-Imports M-Net Data-Plane Constants

Status: deferred — registered 2026-09-11 by the A/B/C final acceptance review. Debt, not a defect.

Owner: M-Net / node-agent。

Source: `services/node-agent/src/node-agent-map-enforcement.ts`（5 个 `@m-net/data-plane/*` 导入）、
`services/node-agent/src/node-agent-local-apply.ts`（1 个）。

问题描述:

- node-agent 为共享数据面协议常量（`key-lifecycle`、`network-map-renderer/-signing/-types`、
  `partition-state`）深层导入 m-net 内部模块，因此在 depcruise 规则
  `no-cross-service-mnet-internals` 中被显式豁免（`from.pathNot: '^services/node-agent/src/'`）。
- 这是 ADR-N04 下的真实共享协议面，但以「整服务豁免」实现，使该服务其余部分也失去边界约束；
  且 m-net 内部模块的移动会连带打破 node-agent 的导入。

Required before implementation:

- 把共享的数据面协议常量/类型上提到 `packages/`（如 `packages/contracts` 或专用
  data-plane-protocol 包），两侧都依赖该包，然后删除 node-agent 豁免。

Reopen trigger:

- 一次专门的数据面协议包抽取排期到达时；或 m-net 内部再需要移动/重组时。

---

### DFW-048: Local IAM Production Persistence / Wiring Gate

Status: deferred — registered 2026-09-11 by the A/B/C final acceptance review.

Owner: Core / M-UI BFF（DFW-027 生产身份轨道的验收条件）。

Source: `packages/auth/src/local-iam.ts`, `packages/db/src/schema/identity.ts`,
`services/m-ui-bff/src/index.ts`, `docs/data/STATE-MODEL.md`（§8 / §229）,
`docs/security/SECURITY-MODEL.md`。

问题描述:

- `createLocalIamService` 目前**只有测试调用点**，principal/session 全部是进程内 Map；
  `packages/db` 中没有 principal 表。
- `services/m-ui-bff/src/index.ts` 构造 app 时**不传 `auth`**，故 `authMode` 回落到
  `local-dev`；但 `STATE-MODEL.md` 与 `SECURITY-MODEL.md` 声明「PostgreSQL（本地 IAM）」是
  身份权威源。
- 本批修复的并发首登竞态（DFW-032 之外的 M-1）因此只在测试路径可达。单进程去重的天花板
  （多实例/重启会分叉）已在 `local-iam.ts` 用 `ponytail:` 注释标注。

Reason deferred:

- 落库 + 生产接线属 DFW-027 生产身份轨道的范围，需先重开该 ADR/service 文档；不是一个
  机械修补。

Required before implementation:

- 新增 principal/session 表，改用 `(oidc_issuer, oidc_subject)` UNIQUE + `INSERT ... ON CONFLICT`。
- 把「本地 IAM 持有 principal 记录」写入 DFW-027 的**验收条件**，而非仅设计意图。
- 在启用 `authMode: 'oidc'` 之前完成生产接线。

Reopen trigger:

- 启用生产 OIDC 登录（`authMode: 'oidc'`）之前必须满足。
