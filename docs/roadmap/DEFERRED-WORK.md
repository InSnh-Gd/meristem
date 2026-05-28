# Deferred Work Register

> This register records work deliberately deferred during phase planning. Deferred means "not in the current phase scope"; it does not mean forgotten, rejected, or safe to implement opportunistically without reopening the owning phase or ADR.

---

## 1. Rules

- Do not implement a deferred item unless its trigger is met and the owning roadmap / ADR / service document is updated first.
- If a deferred item changes REST, Eden, event, policy, log, config, SDUI, profile, or service contracts, update the matching contract docs and tests in the same change.
- If a deferred item expands Core responsibility, re-check `MERISTEM.md` and `MERISTEM-DEV.md` first; Core must remain a microkernel.
- If a deferred item involves authorization, high-risk operations, network routing, secrets, approval, or LLM output, update `docs/security/SECURITY-MODEL.md` and Audit rules before implementation.

---

## 2. Deferred Items

### DFW-001: LLM-Assisted Approval Review

Status: deferred from Phase 12.

Owner: M-Policy with M-Log / M-UI / BFF integration.

Source: `MERISTEM-ROADMAP.md` Phase 12, `docs/roadmap/PHASE-12.md`.

Deferred work:

- LLM-assisted risk explanation.
- log / policy / task context retrieval for approval review.
- human-visible LLM approval summary.
- LLM unavailability behavior in approval review.

Reason deferred:

- Phase 12 must first prove approval, quorum, timeout, resume, and Audit behavior without introducing LLM ambiguity.
- LLM must not become an authorization root.
- Useful LLM summaries depend on stable approval records, log retrieval, and a formal operator UI.

Reopen trigger:

- Phase 12 approval flow is implemented and tested.
- Formal M-UI / BFF has an approval review surface.
- Read-model or log retrieval contracts can provide bounded, redacted context.

Required before implementation:

- LLM security section update.
- prompt / input redaction contract.
- Audit rule for LLM-assisted explanation as auxiliary fact.
- failure-mode tests proving LLM cannot authorize and LLM outage does not block non-LLM approval paths.

---

### DFW-002: Formal Approval Queue UI

Status: deferred from Phase 12.

Owner: M-UI / M-UI BFF.

Source: `docs/roadmap/PHASE-12.md`.

Deferred work:

- Approval queue screen.
- approval detail screen.
- approve / reject CommandWell flow.
- approval status display in the Control Room Ledger.

Reason deferred:

- Phase 12 uses CLI as the first acceptance surface.
- Formal M-UI is already a later phase and must not inherit demo shell shortcuts as final design.

Reopen trigger:

- Phase 12 approval REST and CLI contracts are stable.
- Phase 14 formal M-UI / SDUI / BFF work begins.

Required before implementation:

- SDUI / BFF display contract.
- CommandWell behavior for approve / reject.
- UI contract tests for disabled reasons, Audit visibility, and no direct frontend calls to fact-source services when BFF is required.

---

### DFW-003: Approval Origins Beyond M-Task And M-Net Profile Enable

Status: deferred from Phase 12 / Phase 13.

Owner: originating service plus M-Policy.

Source: `docs/roadmap/PHASE-12.md`, `docs/roadmap/PHASE-13.md`.

Deferred work:

- node registration approval.
- network profile operations beyond M-Net CN enable.
- projection backfill / DLQ approval.
- service reload approval.
- config publish approval.
- secret rotation approval.
- extension registration approval.

Reason deferred:

- Phase 12 supports only M-Task origin operations.
- Phase 13 adds only M-Net CN enable as the next origin pattern.
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

Status: deferred from Phase 12.

Owner: M-Policy.

Source: `docs/roadmap/PHASE-12.md`.

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
- Phase 12 quorum is intentionally fixed: manual review requires one `security-admin`; multi approval requires two distinct `security-admin` actors.

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

Status: deferred from Phase 12.

Owner: undecided; current owner remains M-Policy.

Source: `docs/roadmap/PHASE-12.md`.

Deferred work:

- extracting approval records, votes, quorum, and queue APIs into a new M-* service.

Reason deferred:

- Phase 12 approval behavior is part of M-Policy's decision flow.
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

Status: deferred and prohibited for Phase 12 / Phase 13.

Owner: originating service if ever reopened.

Source: `docs/roadmap/PHASE-12.md`, `docs/roadmap/PHASE-13.md`.

Deferred work:

- replaying original external HTTP requests after approval.

Reason deferred:

- Request replay risks duplicate policy decisions, duplicate Audit facts, stale auth context, and non-idempotent execution.
- Phase 12 and Phase 13 use source-service resume contracts instead.

Reopen trigger:

- a future ADR proves a replay-safe envelope, idempotency model, and Audit model are necessary and safer than explicit resume.

Required before implementation:

- ADR.
- replay envelope contract.
- idempotency and stale-state proof.
- Audit semantics proving approval and execution remain distinct facts.

---

### DFW-007: Real M-Task Retry Execution

Status: deferred from Phase 11 / Phase 12.

Owner: M-Task.

Source: `docs/roadmap/PHASE-11.md`, `docs/roadmap/PHASE-12.md`.

Deferred work:

- retry attempts.
- retry backoff.
- duplicate execution prevention.
- attempt history.
- retry execution after approval.

Reason deferred:

- Phase 11 and Phase 12 keep retry as policy-aware `not_implemented_for_phase`.
- Real retry requires task attempts, leases, idempotency, backoff, and worker coordination semantics.

Reopen trigger:

- M-Task supports more than noop or requires real recovery from failed task execution.

Required before implementation:

- `task_attempts` and possibly `task_leases` schema.
- retry event subjects.
- retry policy and Audit rules.
- failure-mode tests for duplicate execution and stale retry.

---

### DFW-008: Agent Interrupt And Running-Task Cancellation Hardening

Status: deferred from Phase 11.

Owner: M-Task / M-Net / node-agent.

Source: `docs/roadmap/PHASE-11.md`.

Deferred work:

- node-agent interrupt frames.
- running-task registries.
- force-interrupt of running tasks.
- idempotent cancellation races.
- execution race handling between completion and cancellation.

Reason deferred:

- Phase 11 cancel is best-effort and does not require node-agent force-interrupt.
- The current node-agent task frame is minimal and noop-focused.

Reopen trigger:

- tasks can run long enough or perform meaningful side effects where cancellation semantics matter.

Required before implementation:

- node-agent protocol version update.
- M-Net delivery / cancel contract update.
- M-Task state transition and race tests.
- Audit / Full Log rules for interrupt outcomes.

---

### DFW-009: M-Task Multi-Worker Coordination And Queue Infrastructure

Status: deferred from Phase 11.

Owner: M-Task.

Source: `docs/roadmap/PHASE-11.md`.

Deferred work:

- distributed locks.
- leader election.
- leases.
- multi-worker timeout coordination.
- Redis / KeyDB queues.
- general retry / backoff infrastructure.

Reason deferred:

- Phase 11 uses a lightweight timeout worker and single-service semantics.
- Redis / KeyDB are optional supplements, not default dependencies.

Reopen trigger:

- M-Task runs multiple workers or instances that can race on task timeout / retry / scheduling.

Required before implementation:

- concurrency model ADR.
- storage / cache dependency update.
- failure-mode tests for split-brain, duplicate timeout, and lease expiry.

---

### DFW-010: Production Historical Task Migration Compatibility

Status: deferred from Phase 11.

Owner: M-Task / Core.

Source: `docs/roadmap/PHASE-11.md`.

Deferred work:

- production-grade migration from Core-owned historical `tasks` rows to M-Task tables.
- compatibility window for old task routes or old task records.

Reason deferred:

- Phase 11 is a breaking v0.1 baseline migration.
- Local development reset or explicit migration is acceptable at this stage.

Reopen trigger:

- real user data exists in Core-owned task tables and must be preserved.

Required before implementation:

- migration script.
- rollback plan.
- old/new contract compatibility tests.
- documentation for affected CLI / REST versions.

---

### DFW-011: M-Net CN Data Plane

Status: deferred from Phase 13.

Owner: M-Net.

Source: `docs/roadmap/PHASE-13.md`, `docs/adr/ADR-024-m-net-cn-profile.md`.

Deferred work:

- real DERP relay.
- real TCP interconnect.
- real UDP path switching.
- Headscale control plane integration.
- active reachability probing beyond existing session heartbeat.
- latency measurement.
- automatic path optimization.

Reason deferred:

- Phase 13 accepts only control-plane Regional Profile lifecycle.
- Runtime transport changes require concrete regional connectivity testing and stronger operational safety rules.

Reopen trigger:

- control-plane profile lifecycle is implemented and audited.
- concrete regional connectivity requirements and test environments exist.

Required before implementation:

- ADR update or new ADR for data-plane behavior.
- M-Net service definition update.
- operations runbook for regional networking.
- event subjects for path and relay changes.
- failure-mode tests for fallback, degraded regional paths, and public DERP disablement.

---

### DFW-012: Generic Config Lifecycle Subsystem

Status: deferred from Phase 13.

Owner: Core / config subsystem, with M-Net as a consumer.

Source: `docs/config/CONFIG-LIFECYCLE.md`, `docs/roadmap/PHASE-13.md`.

Deferred work:

- draft / validate / commit / version / hash-sign / publish / apply / ack / rollback implementation.
- generic config records for multiple domains.
- node-level apply acknowledgements.

Reason deferred:

- Phase 13 needs M-Net profile lifecycle, not a broad config platform.
- M-Net profile terminology remains compatible with future Config Lifecycle absorption.

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

Status: deferred from Phase 13.

Owner: M-Net / Core secrets / M-Policy / M-Log.

Source: `docs/roadmap/PHASE-13.md`, `docs/adr/ADR-024-m-net-cn-profile.md`.

Deferred work:

- actual DERP endpoint URLs.
- TLS private material.
- STUN / TURN credentials.
- Headscale keys.
- regional IP ranges.
- routing tables.
- node-specific relay assignment.
- latency probes.

Reason deferred:

- Phase 13 profile definition must be `controlPlaneOnly` and must not mislead operators into thinking runtime transport has changed.
- Secret-bearing runtime configuration requires Core / M-Policy / M-Log secret lifecycle rules.

Reopen trigger:

- M-Net data-plane phase is accepted.
- secretRef and network runtime config contracts are ready.

Required before implementation:

- security model update.
- secretRef policy and Audit rules.
- config lifecycle or M-Net runtime config contract.
- redaction tests proving secrets do not enter logs, OpenSearch, UI errors, or LLM prompts.

---

### DFW-014: Global M-Net Profile Defaults Or Global Switch

Status: deferred from Phase 13.

Owner: M-Net / config subsystem.

Source: `docs/roadmap/PHASE-13.md`.

Deferred work:

- global enable / disable for M-Net CN.
- default profile selection for newly created networks.
- fleet-wide profile migration.

Reason deferred:

- Phase 13 uses per-network enable / disable to reduce blast radius and support clear rollback.

Reopen trigger:

- profile behavior is proven per network and operators need defaulting or fleet-wide rollout.

Required before implementation:

- config lifecycle or global setting owner.
- migration / rollback plan.
- Audit and approval rules for fleet-wide changes.

---

### DFW-015: Approval Requirement For M-Net CN Disable

Status: deferred from Phase 13 and not required by default.

Owner: M-Net / M-Policy.

Source: `docs/roadmap/PHASE-13.md`.

Deferred work:

- approval-gated disable for M-Net CN.

Reason deferred:

- Disable is the risk-reduction and rollback path, so Phase 13 executes it immediately with M-Policy allow + Audit.

Reopen trigger:

- a production deployment identifies disable as high-risk enough to require approval.

Required before implementation:

- policy rule explaining when disable requires approval.
- emergency break-glass path.
- Audit tests proving recovery cannot be blocked accidentally.

---

### DFW-016: M-Net Profile UI

Status: deferred from Phase 13.

Owner: M-UI / M-UI BFF.

Source: `docs/roadmap/PHASE-13.md`.

Deferred work:

- network profile list / detail screens.
- enable / disable CommandWell.
- controlPlaneOnly warning display.
- per-network profile state in the formal Control Room Ledger UI.

Reason deferred:

- Phase 13 uses REST and CLI as the acceptance surface.
- Formal M-UI is a later phase.

Reopen trigger:

- Phase 14 formal M-UI work begins or M-Net profile operations need an operator UI.

Required before implementation:

- BFF display contract.
- SDUI schema update if the view is server-driven.
- UI contract tests for high-risk command placement and non-misleading data-plane wording.

---

### DFW-017: Broad Event Mesh Or Projection Expansion For Deferred Flows

Status: deferred.

Owner: M-EventBus / M-Log / projection platform.

Source: Phase 12 and Phase 13 planning.

Deferred work:

- vote-level events.
- approval comment events.
- profile UI projection beyond basic lifecycle events.
- behavior-analysis projections for approvals and regional profile changes.

Reason deferred:

- Phase 12 and Phase 13 publish only lifecycle events needed for traceability.
- PostgreSQL and Audit Log remain the authoritative facts for votes, approvals, and profile state.

Reopen trigger:

- M-UI or analytics needs query-oriented approval / profile views not covered by existing log and event streams.

Required before implementation:

- event catalog update.
- projection schema and ownership.
- tests proving projections are not authoritative state.

---

### DFW-018: Real M-Extension Wasm Runtime

Status: deferred from Phase 15.

Owner: M-Extension.

Source: `docs/roadmap/PHASE-15.md`, `docs/services/m-extension.md`, `docs/references/wasm3-latest.md`.

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
- Phase 15 must first prove manifest, policy, Audit, lifecycle, and state ownership without introducing runtime supply-chain and sandbox risks.
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

Status: deferred from Phase 15.

Owner: M-Extension / M-Policy / M-Log.

Source: `docs/roadmap/PHASE-15.md`, `docs/security/SECURITY-MODEL.md`.

Deferred work:

- public webhook ingress routes.
- webhook source verification.
- replay protection.
- rate limiting.
- payload schema registry.
- webhook-triggered extension execution.
- rejected webhook Full / Audit behavior.

Reason deferred:

- Phase 15 supports only `webhook-declared` manifests and no runtime execution.
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

Status: deferred from Phase 15.

Owner: M-Extension.

Source: `docs/roadmap/PHASE-15.md`.

Deferred work:

- outbound HTTP callback execution.
- callback retry / timeout / idempotency behavior.
- script execution.
- cloud-function runtime behavior.
- callback secret binding.

Reason deferred:

- Phase 15 allows only `http-callback-placeholder` and does not execute callbacks.
- Callback and cloud-function behavior require secret lifecycle, retry semantics, rate limits, and blast-radius controls.

Reopen trigger:

- an accepted extension use case requires managed outbound callbacks or lightweight function execution.

Required before implementation:

- ADR or phase document for execution model.
- secretRef binding and redaction rules.
- retry / timeout / idempotency contract.
- Audit and Full Log behavior.
- failure-mode tests for callback outage, duplicate delivery, secret redaction, and denied execution.

---

### DFW-021: Non-System Extension Scopes

Status: deferred from Phase 15.

Owner: M-Extension plus the owning scoped domain.

Source: `docs/roadmap/PHASE-15.md`, `docs/services/m-extension.md`.

Deferred work:

- node-scoped extension instances.
- network-scoped extension instances.
- service-scoped extension instances.
- tenant or user scoped extension instances.

Reason deferred:

- Phase 15 stores the two-layer definition / instance model but only enables `system/default` to avoid cross-domain lifecycle coupling.

Reopen trigger:

- a specific domain needs scoped extension behavior and can define ownership, reads, writes, policy, and rollback semantics.

Required before implementation:

- scope ownership contract.
- authorization and Audit rules per scope.
- state migration from `system/default` assumptions.
- tests for scope isolation and denied cross-scope access.

---

### DFW-022: M-Extension UI And BFF Surfaces

Status: deferred from Phase 15.

Owner: M-UI / M-UI BFF.

Source: `docs/roadmap/PHASE-14.md`, `docs/roadmap/PHASE-15.md`.

Deferred work:

- extension list screen.
- extension detail screen.
- extension register CommandWell flow.
- extension enable / disable CommandWell flow.
- extension manifest validation display.

Reason deferred:

- Phase 15 uses REST and CLI as the acceptance surface.
- Phase 14 explicitly excludes M-Extension UI.

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

Status: deferred from Phase 15.

Owner: M-Extension / M-Policy.

Source: `docs/roadmap/PHASE-15.md`.

Deferred work:

- extension-defined permissions.
- permission namespace registration.
- marketplace install / upgrade / uninstall.
- extension package signing and distribution.
- compatibility windows for extension packages.

Reason deferred:

- Phase 15 uses four fixed permissions and prohibits extensions from creating permissions.
- Marketplace and dynamic permission behavior would push Meristem toward plugin-first architecture before the control plane is proven.

Reopen trigger:

- a real extension ecosystem need exists and Meristem intentionally accepts the operational and security burden.

Required before implementation:

- ADR revisiting ADR-007 boundaries.
- permission namespace contract.
- package signature and provenance rules.
- migration and compatibility policy.
- tests for permission namespace collision, downgrade, malicious package metadata, and denied install.

---

### DFW-024: Runtime Redis / KeyDB Adapter Integration

Status: deferred from Phase 16.

Owner: owning service plus data / cache boundary.

Source: `docs/roadmap/PHASE-16.md`, `docs/operations/OPTIONAL-DEPLOYMENT-PACK.md`, `docs/data/STATE-MODEL.md`.

Deferred work:

- Redis / KeyDB runtime adapter.
- moving any session, rate-limit, lock, queue, task coordination, or cache state to Redis / KeyDB.
- Redis client dependency.
- Redis fallback or fail-closed implementation.

Reason deferred:

- Phase 16 only ships a Redis optional profile and adapter contract boundary.
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

Status: deferred from Phase 16.

Owner: operations / security with affected service owners.

Source: `docs/roadmap/PHASE-16.md`, `docs/operations/OPTIONAL-DEPLOYMENT-PACK.md`, `docs/adr/ADR-017-apisix-optional.md`.

Deferred work:

- production APISIX TLS termination.
- APISIX auth preflight plugins.
- production rate-limit policy.
- canary / gray release traffic control.
- webhook ingress through APISIX.
- APISIX deployment hardening.

Reason deferred:

- Phase 16 uses APISIX only as an optional local edge gateway example.
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

Status: deferred from Phase 16.

Owner: operations / service owners.

Source: `docs/roadmap/PHASE-16.md`, `ops/compose/full-stack.example.yml`.

Deferred work:

- production images for Core and M-* services.
- split-container internal service URL configuration.
- container health checks for every service.
- image publishing and registry workflow.
- full-stack compose as an executable CI gate.

Reason deferred:

- current internal service URLs are loopback-oriented in code.
- Phase 16 full-stack compose is topology documentation, not a production deployment or default workflow.

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

Status: deferred from Phase 17.

Owner: Core / security.

Source: `docs/roadmap/PHASE-17.md`, `docs/adr/ADR-020-identity-in-core.md`.

Deferred work:

- OIDC / SSO / SAML integration.
- browser cookie sessions.
- MFA.
- password authentication.
- user management UI.
- group / team / department identity model.
- refresh token and token family model.

Reason deferred:

- Phase 17 hardens local Identity v0.2 only.
- production identity would expand Core's responsibility and may require revisiting ADR-020.

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

Status: deferred from Phase 18.

Owner: Core / security / operations.

Source: `docs/roadmap/PHASE-18.md`, `docs/adr/ADR-021-secrets-core-policy-log.md`.

Deferred work:

- Vault / KMS / cloud secret manager integration.
- envelope encryption service.
- secret leasing.
- automated rotation schedules.
- cross-node secret distribution.
- production backup / restore for secret material.

Reason deferred:

- Phase 18 implements only SecretRef v0.1 control-plane and local development storage.
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

Status: deferred from Phase 19.

Owner: Core / M-UI / affected domain services.

Source: `docs/roadmap/PHASE-19.md`, `docs/config/CONFIG-LIFECYCLE.md`.

Deferred work:

- collaborative config editing.
- M-UI config authoring workflows.
- rollout waves.
- broad node-level config distribution.
- feature flag platform.
- automatic drift remediation.
- cross-cluster config federation.

Reason deferred:

- Phase 19 implements the minimum authoritative lifecycle, not a broad configuration product.

Reopen trigger:

- multiple domains need operator-authored configuration with safe rollout and rollback beyond the v0.1 control plane.

Required before implementation:

- UI / BFF contracts.
- domain apply contracts.
- rollout / rollback semantics.
- collaborative draft state owner.
- tests for partial apply, failed ack, rollback, and permission-aware UI behavior.
