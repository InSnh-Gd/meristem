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

- Current identity model only has `viewer`, `operator`, `admin`, and `security-admin`.
- Approval flow quorum is intentionally fixed: manual review requires one `security-admin`; multi approval requires two distinct `security-admin` actors.

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

- extracting approval records, votes, quorum, and queue APIs into a new M-* service.

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

- a concrete extension use case requires isolated code execution that cannot be modeled as an M-* service.
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

- production images for Core and M-* services.
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

Status: deferred from Identity v0.2.

Owner: Core / security.

Source: `docs/adr/ADR-F02-architecture-organization.md`.

Deferred work:

- OIDC / SSO / SAML integration.
- browser cookie sessions.
- MFA.
- password authentication.
- user management UI.
- group / team / department identity model.
- refresh token and token family model.

Reason deferred:

- Identity v0.2 hardens local identity only.
- production identity would expand Core's responsibility and may require revisiting `docs/adr/ADR-F02-architecture-organization.md`.

Reopen trigger:

- local actor tokens are insufficient for real operators or deployment environments.

Required before implementation:

- ADR update or new identity ADR.
- security model update.
- session and token migration plan.
- M-UI and CLI login contract.
- tests for provider outage, token revocation, claim mapping, and fail-closed behavior.

---

### DFW-028: Production Secret Backend

Status: deferred from SecretRef v0.1.

Owner: Core / security / operations.

Source: `docs/adr/ADR-F02-architecture-organization.md`.

Deferred work:

- Vault / KMS / cloud secret manager integration.
- envelope encryption service.
- secret leasing.
- automated rotation schedules.
- cross-node secret distribution.
- production backup / restore for secret material.

Reason deferred:

- SecretRef v0.1 implements only control-plane and local development storage.
- production secret backends require operational, security, and recovery design beyond v0.1 closure.

Reopen trigger:

- secretRef usage expands beyond local development or needs production-grade persistence and rotation.

Required before implementation:

- ADR for backend choice and failure behavior.
- redaction and Audit tests.
- recovery and rotation runbook.
- migration from local v0.1 storage.

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

### DFW-029: Event Catalog Parity For Deferred Subjects

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
