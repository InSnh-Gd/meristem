# Deferred Work Register

> This register records work deliberately deferred during v0.1 scope planning. Deferred means "not in the current scope"; it does not mean forgotten, rejected, or safe to implement opportunistically without reopening the owning service definition, ADR, or contract doc.

---

## 1. Rules

- Do not implement a deferred item unless its trigger is met and the owning root roadmap / ADR / service document is updated first.
- If a deferred item changes REST, Eden, event, policy, log, config, SDUI, profile, or service contracts, update the matching contract docs and tests in the same change.
- If a deferred item expands Core responsibility, re-check `MERISTEM.md` and `MERISTEM-DEV.md` first; Core must remain a microkernel.
- If a deferred item involves authorization, high-risk operations, network routing, secrets, approval, or LLM output, update `docs/security/SECURITY-MODEL.md` and Audit rules before implementation.

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

Status: deferred — `warn` severity, `depcruise` exit code 仍为 0。

Owner: Core。

Source: `apps/core/src/types.ts`, `apps/core/src/types/shared.ts`, `apps/core/src/types/mdeploy-facade.ts`, `apps/core/src/routes/facade-support.ts`, `apps/core/src/middleware/auth.ts`。

问题描述:

- `apps/core/src/types/mdeploy-facade.ts:14` 从 `../routes/facade-support.ts` 导入 `FacadeServiceResult`，形成 `types/ → routes/` 反向边，引发四条循环依赖。
- `FacadeServiceResult<T>`（声明于 `facade-support.ts:10`）结构上等价于 `Result<T, ServiceErrorLike>`（来自 `packages/common/src/result.ts`）。

精确修复方案:

1. 新建 `apps/core/src/types/facade-result.ts`，定义 `FacadeServiceResult<T>` 为 `Result<T, ServiceErrorLike>`，复用 `packages/common/src/result.ts`。
2. `apps/core/src/routes/facade-support.ts` 改为从 `../types/facade-result.ts` re-export `FacadeServiceResult`（保持兼容）。
3. `apps/core/src/types/mdeploy-facade.ts:14` 改为从 `./facade-result.ts` 导入。
4. 该单次移动即可断开全部四条循环。

Reason deferred:

- 循环涉及的全部文件均为 M-Deploy facade WIP 未提交文件；修复需 stage 另一 agent 的未完成 feature。

Reopen trigger:

- M-Deploy facade WIP 落地后。

---

### DFW-041: services/m-net 六条预存循环依赖

Status: deferred — `warn` severity, 不影响 gate。

Owner: M-Net。

Source: `services/m-net/src/deps.ts`, `services/m-net/src/clients.ts`, `services/m-net/src/migration-engine.ts`, `services/m-net/src/migration-engine-rollback.ts`, `services/m-net/src/profile-workflow-types.ts`, `services/m-net/src/mnet-dataplane-support.ts`, `services/m-net/src/data-plane-security-support.ts`。

问题描述:

- hub 循环经过 `deps.ts` ⇄ `clients.ts` ⇄ `migration-engine*.ts` ⇄ `profile-workflow-types.ts`。`deps.ts` 出现在 3 条循环中，`clients.ts` 出现在 2 条，其余文件各出现 1 次。
- 需要真正的依赖反转而非简单文件移动。

Reason deferred:

- 预存问题，超出结构清理通过的范围。

Reopen trigger:

- 一个专门的 m-net 依赖反转任务。

---

### DFW-033: 文档内容去重与目录移动

Status: deferred — WIP 文件阻塞。

Owner: docs / operations。

Source: `docs/operations/RUNBOOK.md`, `docs/operations/MNET-V02-RUNBOOK.md`, `docs/operations/M-NET-THREE-NODE-VALIDATION.md`, `docs/production-readiness/READINESS-SUMMARY.md`, `docs/releases/`, root `README.md`。

Deferred work:

- `docs/operations/RUNBOOK.md` §5.1 + §6.1 与 `docs/operations/MNET-V02-RUNBOOK.md`（M-Net 故障矩阵 / 诊断）内容重叠。
- `docs/operations/RUNBOOK.md` §6.1 与 `docs/operations/M-NET-THREE-NODE-VALIDATION.md`（同一 3-node harness 流程）内容重叠。
- `docs/production-readiness/READINESS-SUMMARY.md` 应考虑并入 `docs/operations/`，但移动会断开 root `README.md:249` 的链接。
- `docs/releases/` 只含 2 个文件，但其中 1 个被 `tests/contracts/v02-gate-split.contract.test.ts` 断言。
- Root `README.md` "Monorepo 结构" tree 需要与 `MERISTEM-DEV.md` §1.2 同步对齐。

Reason deferred:

- `RUNBOOK.md`、`EVENT-CATALOG.md`、`POSTGRES-SCHEMA-MVP.md`、`REST-API-MVP.md`、`SECURITY-MODEL.md`、`CLI-COMMANDS.md`、`docs/services/m-cli.md`、`docs/services/m-deploy.md` 和 root `README.md` 均已在 WIP 中被修改；去重会将本次重构与 WIP 内容纠缠。

Reopen trigger:

- M-Deploy facade WIP 落地后。

---

### DFW-034: apps/core/src/ 与 apps/core/src/routes/ 目录分层整合

Status: deferred — WIP 文件阻塞。

Owner: Core。

Source: `apps/core/src/`（20 flat files）, `apps/core/src/routes/`（33 flat files）。

Deferred work:

- `routes/` 33 个文件和 `src/` 20 个文件均超过 flat-directory 阈值。`services/m-net/src` 和 `services/m-ui-bff/src/routes` 已完成的分层模式应回应用到 Core。

Reason deferred:

- 8 个 `apps/core` 文件为 WIP-dirty，包括 `app.ts`、`adapters.ts`、`types.ts`、`middleware/route-support.ts`——正是分层重写导入时必须修改的文件。

Reopen trigger:

- M-Deploy facade WIP 落地后。

---

### DFW-035: 两个超尺寸文件无法拆分

Status: deferred — 已登记到 `tests/contracts/file-size-budget.contract.test.ts` allowlist，WIP-BLOCKED 原因。

Owner: scripts / M-Deploy。

Source: `scripts/v02-deploy-proof.ts`（1120 行）, `services/m-deploy/src/testing.ts`（602 行）。

Deferred work:

- 两个文件超出 500 行硬限制但因 WIP 修改无法拆分。
- 当前已在 `file-size-budget.contract.test.ts` allowlist 中注册并标注 WIP-BLOCKED 原因。

Reason deferred:

- 两个文件均为 M-Deploy facade WIP 修改对象。

Reopen trigger:

- M-Deploy facade WIP 落地后；拆分文件并移除 allowlist 条目。

---

### DFW-036: WIP 文件格式化漂移（发布阻塞项）

Status: deferred — **release blocker**，`test:v02-gates` 无法通过。

Owner: M-Deploy facade feature owner。

Source: `bun run format:check` output, `scripts/git-hooks/pre-push`。

问题描述:

- `bun run format:check` 是 `scripts/git-hooks/pre-push` 和 `test:v02-gates` 链的**第一个** gate。HEAD 时报 106 个违规文件。
- 其中 83 个已在清理通过中格式化（commits `5dc36d2` 和 `a70c0f5`，经 transpiler normalization 验证语义等价）。
- 剩余 **23 个违规文件全部为 WIP 文件**：`apps/core/src/adapters/http-mdeploy-facade.ts`、`apps/core/src/routes/deploy-facade.ts`、`apps/m-cli/src/cli.ts`、`apps/m-cli/src/commands/deploy-*.ts`、`packages/contracts/src/routes/deploy.ts`、`packages/contracts/src/schemas/mdeploy-*.ts`、`packages/contracts/src/types/cli-client.ts`、`packages/db/src/seed.ts`、`scripts/local-stack-runtime.ts`、`scripts/v02-deploy-proof.ts`、`services/m-deploy/src/serve-local.ts`、`services/m-deploy/src/testing.ts`，以及 8 个新 `tests/` 文件。

精确修复方案:

- 在 M-Deploy facade feature 落地时，执行 `bunx biome format --write` 覆盖全部 23 个 WIP 文件。

Reason deferred:

- 格式化 WIP 文件会修改另一 agent 的 working tree。

Reopen trigger:

- M-Deploy facade WIP 落地时，作为 landing 流程的一部分立即执行。**此项为发布阻塞项**——`test:v02-gates` 在此项解决前无法通过。

---

### DFW-037: 已知合约测试间歇性失败（flake）

Status: 持续观察——非阻塞，无代码修复需要。

Owner: test infrastructure。

Source: `bun run test:contracts`。

观察记录:

- 规划阶段发现一次间歇性失败：1156 pass / 1 fail → 连续三次 re-run 均 1157 / 0。
- 清理通过中再次出现：`packet forwarding architecture guard` 测试 1158 pass / 2 fail → re-run 即 1160 / 0。
- 无代码变更即恢复通过，确认为 flake 而非回归。
- 当前健康基线：**1174 pass / 0 fail**（结构清理通过收束后）。

处理建议:

- 未来 agent 遇到 `test:contracts` 单次不可复现失败时，**re-run 一次**再开始诊断。
- 如同一测试连续两次失败，则视为真实回归进行调查。

---

### DFW-038: services/m-net/src 115 个平铺文件的目录分层

Status: deferred — 有硬前置条件，未满足前不得启动。

Owner: M-Net。

Source: `services/m-net/src/`（115 个平铺 `.ts` 文件）。

问题描述:

- `services/m-net/src/` 目前是仓库内最大的单层目录：115 个平铺 `.ts` 文件，仅有一个既存子目录 `data-plane/`（1 个文件）。
- 命名已自然聚成领域簇：profile（15）、closed-loop（15）、migration（13）、agent（12）、node（8）、forced-relay（8）、data（5）、operational（4）、network（4）、global（4）。
- 后缀同时聚成层次簇：workflow（11）、types（9）、support（9）、routes（9）、store（4）、runtime（4）。

爆炸半径（已实测）:

- **70 个仓库外部文件**从 `services/m-net/src/` 导入：`tests/contracts` 30、`tests/integration` 14、`tests/failure-modes` 9、`scripts/` 5、`tests/perf` 4、`tests/services/m-net` 3、`apps/core/src/adapters` 2、`tests/helpers`/`tests/e2e`/`tests/contracts/_helpers` 各 1。
- **61 个 m-net 模块被外部引用**，全部为硬编码相对路径（形如 `from '../../services/m-net/src/profile-store.ts'`），仓库**没有配置任何 path alias**。
- 引用最密集：`profile-store.ts`（25）、`suspended-operations.ts`（17）、`app.ts`（13）、`data-plane-store-memory.ts`（12）。

目标形态（已定档，执行时不再重新决策）:

- 采用**按领域（feature-based）**切分：`profile/`、`closed-loop/`、`migration/`、`agent/`、`forced-relay/`、`data-plane/`（复用既存目录）。**不采用**按层次（`domain/`/`store/`/`workflow/`）切分——层次切分会让同一领域的状态机、存储与工作流散落三处，反而加重跨领域耦合。
- **不得**在 `src/` 根保留 61 个单文件 re-export barrel。用 61 个纯转发文件替换 115 个平铺文件是把问题换了个形状，不是解决问题。
- 外部导入的迁移方式：先引入 path alias（如 `@m-net/`），再据此更新 70 个外部导入点。

硬前置条件（全部满足前不得启动）:

1. **DFW-041 先行**：`deps.ts` ⇄ `clients.ts` ⇄ `migration-engine*.ts` 的 hub 循环必须先做真正的依赖反转。在 hub 循环仍存在时划定目录边界，会把错误的边界固化进目录结构；而依赖反转的结果本身就会决定这些文件应该落在哪个领域目录下。
2. **M-Deploy facade WIP 落地**：`services/m-net/src/store-codecs.ts` 当前处于 WIP 修改中，另有 78 个 WIP 文件在途。在此期间移动 m-net 文件必然与在途特性产生大范围冲突。
3. **path alias 独立落地**：monorepo 级 tsconfig `paths` 变更属于独立结构改动，必须自带验证通过（typecheck ×3、lint、depcruise、全测试链），不得与文件搬迁混在同一次提交内。

Reason deferred:

- 前置条件 1 与 2 均未满足；在 hub 循环与在途 WIP 存在的前提下执行 115 文件搬迁，收益不足以抵偿回归与冲突风险。本次结构清理通过的高价值项（gate 链解锁、超尺寸文件拆分、文档归档）已全部落地并提交。

Reopen trigger:

- DFW-041 完成 **且** M-Deploy facade WIP 落地 **且** `@m-net/` path alias 已独立落地并通过全 gate 链后，方可启动本项。

---

---

### DFW-039: Real NetBird Infrastructure Viability Proof And Cross-Host Dataplane Verification

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


### DFW-032: Same-Host Fleet Operator Tooling And Member Lifecycle Hygiene

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

Still deferred:

- Deleting/rotating memberships for nodes that died before leaving: stale
  member rows keep old bootstrap placeholder keys in every re-rendered map
  until an operator runs `network remove-member` per ghost; long-lived
  deployments need automated re-render/purge when a node's heartbeat expires.
- map render for members without a registered runtime key still bootstraps a
  deterministic placeholder key (control-plane test affordance); production
  should either reject or quarantine such members instead of emitting keys
  that `wg setconf` rejects.

Reason deferred:

- Both are operator-policy/lifecycle-hygiene work beyond the smoke scope; the
  smoke achieved its goal (control plane + data plane verified for five real
  agent containers), and the fixes above unblock real agent-mode fleets.

