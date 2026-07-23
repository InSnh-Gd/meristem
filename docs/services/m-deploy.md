# M-Deploy Service Definition

## 1. Identity

| Field | Value |
|-------|-------|
| name | `m-deploy` |
| version | `0.1.0` |
| domain | `m-deploy` |
| kind | `internal` |
| owner | Meristem deployment maintainers |

---

## 2. Responsibility

M-Deploy owns GitOps pull-reconcile deployment control for the production track. Git is the desired-state source of truth; M-Deploy validates signed desired-state envelopes, reconciles approved state onto VM runtimes through enrolled agents, and emits audit/evidence facts for every deployment operation.

What this service owns:

- desired-state metadata imported from Git commit/digest pointers, including signed envelope verification result, source repository, branch, path, commit hash, content hash, and sync timestamp
- reconcile operation state, including proposal linkage, approval linkage, selected runtime driver, target topology, apply status, and last successful digest
- drift reports comparing signed desired-state, IaC/runtime state, and agent-reported host/container state
- evidence metadata for apply, rollback, drift, signature verification, runtime driver output, and agent acknowledgements
- agent enrollment records for deployment agents, heartbeat timestamps, supported driver capabilities, and last-known runtime state
- deployment rollback pointers to previously verified digest/image/runtime artifact combinations
- controller-side scheduling of approved apply and rollback operations
- publication of M-Deploy subjects listed in `docs/events/EVENT-CATALOG.md`

What this service must not own:

- identity, actor lifecycle, OIDC/JWT verification, token issuance, or role assignment; Core and the identity boundary remain authoritative
- policy decisions, approval quorum, or final authorization; M-Policy owns decisions and approval lifecycle
- network authority, node membership, topology ACL intent, relay selection, or packet movement; M-Net and node-agent sidecars own those boundaries
- source authoring truth; M-Deploy must not edit or push desired-state files to Git
- general SSH remote control, shell command dispatch, or ad hoc host administration
- controller SSH push deployment; the normal path forbids controller-initiated SSH push and uses agent pull-reconcile only
- live state writes initiated directly by M-UI or M-UI BFF; UI requests flow through M-UI → M-UI BFF → Core public facade → M-Deploy
- raw secret values; deployment secrets cross the boundary only as `SecretRef` / SecretProvider references
- Audit Log authority or immutable raw evidence storage authority; M-Log owns audit/evidence fact storage and object archive integration
- OpenTofu/Terraform state as business authority; IaC state is a deployment read model/snapshot, not the desired-state source

Current production-track scope:

- production runtime is fixed VM topology using Podman Quadlet units managed by systemd
- Docker Compose is compatibility-only for local validation and migration checks; it does not satisfy production readiness
- OpenTofu/Terraform support is a provider-neutral IaC fixture for topology provisioning and state comparison
- Kubernetes, Helm, service mesh, controller SSH push, and broad remote execution are excluded
- `createProductionMDeployComposition(...)` and `serveProductionMDeployApp(...)` construct the PostgreSQL store, configured SecretManager/trusted verifier, shared auth verifier, and loopback M-Policy, M-Log, and M-EventBus adapters. `createInMemoryMDeployDeps()` is test-only.
- deployment packaging must still supply host-local Git fetch, agent enrollment identity verification, controller availability, and either a direct local runtime adapter or `infrastructureDriverEffects` through `MDeployHostAdapters`; production composition turns the latter into the Podman driver at startup, so it is a real wiring seam rather than an uncalled helper. These explicit host adapters are the remaining external deployment prerequisite and cannot be replaced by generic SSH or remote shell execution

---

## 3. Contracts

| Contract | Path / Subject | Version | Notes |
|----------|----------------|---------|-------|
| REST | `/api/v0/deploy/desired-state`, `/api/v0/deploy/proposals*`, `/api/v0/deploy/apply`, `/api/v0/deploy/rollback`, `/api/v0/deploy/drift`, `/api/v0/deploy/evidence*`, `/api/v0/deploy/agents*` | `v0` | Core public facade exposes operator-facing routes; high-risk mutations require M-Policy and Audit |
| REST / internal HTTP | `/internal/v0/deploy/agents/enroll`, `/internal/v0/deploy/agents/:id/heartbeat`, `/internal/v0/deploy/agents/:id/reconcile`, `/internal/v0/deploy/drift` | `v0` | mounted loopback-only agent API; every route requires `x-meristem-internal-token` |
| REST / internal authority | M-Policy `/internal/v0/policy/mdeploy/approvals/:proposalId/{votes,quorum}`; M-Log `/internal/v0/deployment-evidence`; M-EventBus `/internal/v0/publish` | `v0` | production composition consumes these authenticated loopback boundaries; M-Policy owns eligibility/quorum and M-Log owns immutable evidence records |
| Eden | `services/m-deploy/src/index.ts#MDeployApp` | `0.1.0` | exported Elysia type surface for Core → M-Deploy and agent-control clients; public composition remains Core-owned |
| Effect Schema | `packages/contracts/src/schemas/mdeploy-common.ts`, `mdeploy-operations.ts`, `mdeploy-agent.ts` | `0.1.0` | desired-state, signed envelope, proposal/approval, Podman-production and Docker-compatibility runtime selection, immutable image provenance, promotion/rollback metadata, runtime health, agent, drift, reconcile, evidence, and event payload schemas |
| Events | `mdeploy.proposal.created.v0`, `mdeploy.approval.recorded.v0`, `mdeploy.apply.started.v0`, `mdeploy.apply.succeeded.v0`, `mdeploy.apply.failed.v0`, `mdeploy.rollback.*.v0`, `mdeploy.drift.detected.v0`, `mdeploy.agent.heartbeat.v0`, `mdeploy.evidence.emitted.v0` | `v0` | implemented publishers are active in `docs/events/EVENT-CATALOG.md`; failure and resolution subjects remain deferred until their workflows exist |

Mounted public API surface:

| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| `GET` | `/api/v0/deploy/desired-state` | `deploy:desired-state-read` | read latest Git sync status, verified digest, stale status, and last successful digest |
| `POST` | `/api/v0/deploy/proposals` | `deploy:desired-state-propose` | propose a desired-state change by Git ref/digest without editing Git |
| `GET` | `/api/v0/deploy/proposals/:id` | `deploy:desired-state-read` | read proposal, policy, audit, apply, and evidence linkage |
| `POST` | `/api/v0/deploy/proposals/:id/approve` | `deploy:desired-state-approve` | request/record approval through Core/M-Policy; M-Deploy does not decide quorum |
| `POST` | `/api/v0/deploy/apply` | `deploy:desired-state-apply` | apply an approved signed desired-state digest through pull-reconcile |
| `POST` | `/api/v0/deploy/rollback` | `deploy:desired-state-rollback` | restore previous verified digest/runtime artifact combination |
| `GET` | `/api/v0/deploy/drift` | `deploy:drift-read` | read current and historical drift reports |
| `POST` | `/api/v0/deploy/drift/check` | `deploy:drift-read` | request an explicit drift scan; mutation of live state is forbidden |
| `GET` | `/api/v0/deploy/evidence` | `deploy:evidence-read` | list evidence metadata by operation, digest, node, or correlation ID |
| `GET` | `/api/v0/deploy/agents` | `deploy:desired-state-read` | list enrolled deployment agents and heartbeat status |

Mounted internal and agent API surface:

- `POST /internal/v0/deploy/agents/enroll` verifies agent identity and persists enrollment capabilities plus controller trust issuer, audience, public-key fingerprint, and expiry.
- `POST /internal/v0/deploy/agents/:id/heartbeat` records deployment health and publishes the heartbeat fact; route/body agent ID mismatch is rejected.
- `POST /internal/v0/deploy/agents/:id/reconcile` retries pending event intents, pulls one queued apply/rollback, re-verifies the envelope against that agent's enrolled controller trust, resolves SecretRefs, and invokes only the local runtime adapter.
- `POST /internal/v0/deploy/drift` records an agent drift observation, Audit/evidence, and the detected event.
- All four routes require `x-meristem-internal-token`; external bearer actors never call `/internal/v0/*` directly. Missing/invalid internal authentication returns the common `401` error envelope.
- Deployment agents pull signed desired-state envelopes and verify signature bytes, signer identity, issuer, audience, key fingerprint, and trust expiry locally before SecretProvider or runtime action.
- Agent heartbeat carries only deployment health, supported driver capabilities, last-known digest, runtime status, and correlation IDs; it must not carry plaintext secrets or host-local command output.
- The implementation keeps persistent/transport envelope input as `unknown` until the agent revalidates it locally with `validateMDeploySignedEnvelopeForApply` and the injected trusted verifier; payload `verification.verified` is metadata and cannot authorize execution.
- `serveMDeployApp(deps)` binds an already-built dependency set. Production packaging uses `serveProductionMDeployApp(options)`, which creates the documented durable/authority composition and closes its PostgreSQL pool when stopped. Neither entrypoint provides controller SSH push or a generic remote shell.
- Public `apply` and internal `reconcile` results include `publicationStatus: "published" | "pending"`. `pending` means the operation/evidence/event intent is durably committed and runtime truth is final, but one or more EventBus dispatches remain retryable.

---

## 4. Permissions

| Permission | Required For | Risk |
|------------|--------------|------|
| `deploy:desired-state-read` | read desired-state sync status, proposals, apply status, rollback pointers, and agent summaries | medium |
| `deploy:desired-state-propose` | create a proposed desired-state change by Git ref/digest | high |
| `deploy:desired-state-approve` | approve or request approval for a desired-state proposal through Core/M-Policy | high |
| `deploy:desired-state-apply` | apply an approved signed desired-state digest to VM runtime state | critical |
| `deploy:desired-state-rollback` | restore a previous verified digest/runtime artifact combination | critical |
| `deploy:drift-read` | read or trigger drift detection without mutating live state | medium |
| `deploy:evidence-read` | read deployment evidence metadata and immutable evidence references | medium |

High-risk markings:

- propose, approve, apply, and rollback are protected operations and must be routed through Core + M-Policy.
- apply and rollback are critical because they mutate production VM runtime state.
- drift read/check and evidence read are non-mutating, but must still redact secrets, host-local paths, and raw command output.

---

## 5. Dependencies

| Dependency | Type | Failure Behavior |
|------------|------|------------------|
| Core | service | public deploy facade and identity introspection fail closed; no direct UI → M-Deploy bypass |
| M-Policy | service | propose/approve/apply/rollback fail closed; production apply requires an M-Policy proof containing exactly two distinct eligible non-proposer approvers; M-Deploy stores the proof ID and does not count approvals |
| M-Log | service | Audit/evidence writes required for high-risk operations block state mutation when unavailable |
| M-EventBus / NATS | event | operation/evidence/event intent persists before dispatch; dispatch failure remains `publicationStatus: pending`, writes Full Log, and retries on later reconcile without turning successful runtime execution into false failure |
| PostgreSQL | datastore | deployment metadata, proposals, reconcile state, agent state, and evidence metadata fail closed on write unavailability |
| Git | desired-state source | sync degraded; use last successful snapshot only within configured TTL; reject reconcile after TTL |
| Vault / SecretProvider | secret backend | sealed/unavailable provider blocks new apply/rollback requiring secret material; no local plaintext fallback |
| Podman runtime | production runtime driver | production requires Podman Quadlet units managed by systemd; missing or mismatched runtime support blocks apply with typed validation |
| Docker Compose | compatibility runtime | compatibility validation may run with Docker Compose, but it must not be reported as production readiness or used for production promotion |
| OpenTofu / Terraform | IaC driver | topology plan/apply/drift steps fail typed; does not replace Git desired-state authority |
| OCI registry | artifact source | digest verification or pull failure blocks apply; mutable tags are not accepted as authority |
| Deployment agent | node service | disconnected agent pauses apply/drift for that target; last-known state stays visible and degraded |

---

## 6. Configuration

| Key | Type | Required | Hot Reload | Notes |
|-----|------|----------|------------|-------|
| `MERISTEM_MDEPLOY_PORT` | number | yes | no | loopback internal service bind |
| `MERISTEM_MDEPLOY_AGENT_BIND` | string | yes | no | agent pull-reconcile ingress; must not expose generic SSH control |
| `MERISTEM_INTERNAL_TOKEN` | string | yes | no | Core/internal service authentication |
| `MERISTEM_MDEPLOY_RUNTIME_DRIVER` | `podman` \| `docker` | yes | yes | `podman` is required for production with `quadlet-systemd`; `docker` is compatibility-only with `docker-compose` |
| `MERISTEM_MDEPLOY_IAC_DRIVER` | `opentofu` \| `terraform` \| `disabled` | yes | yes | provider-neutral IaC driver selection |
| `MERISTEM_MDEPLOY_GIT_URL` | string | yes | yes | desired-state Git repository URL |
| `MERISTEM_MDEPLOY_GIT_BRANCH` | string | yes | yes | watched branch or ref; commits are pinned by digest before apply |
| `MERISTEM_MDEPLOY_GIT_PATH` | string | yes | yes | desired-state root path inside repository |
| `MERISTEM_MDEPLOY_GIT_SYNC_INTERVAL_MS` | number | yes | yes | periodic sync cadence |
| `MERISTEM_MDEPLOY_SNAPSHOT_TTL_MS` | number | yes | yes | maximum age for last successful snapshot used during Git outage |
| `MERISTEM_MDEPLOY_REGISTRY_URL` | string | yes | yes | OCI registry base for deployment artifacts |
| `MERISTEM_MDEPLOY_REGISTRY_SECRET_REF` | SecretRef | no | yes | registry credential reference; plaintext credentials forbidden |
| `MERISTEM_MDEPLOY_SIGNING_KEY_REF` | SecretRef | yes | no | signing/verification key reference; private material stays in SecretProvider |
| `MERISTEM_MDEPLOY_SIGNATURE_POLICY` | `required` | yes | no | unsigned desired-state is rejected |
| `MERISTEM_MDEPLOY_AGENT_HEARTBEAT_TIMEOUT_MS` | number | yes | yes | disconnected-agent threshold |
| `MERISTEM_MDEPLOY_EVIDENCE_BUCKET` | string | yes | yes | immutable evidence archive location reference, not a local test path |

Production composition inputs:

- `MERISTEM_V02_DEPLOYMENT_CONFIG` supplies M-Policy, M-Log, and M-EventBus URLs, the selected auth provider, and the named SecretProvider configuration.
- `DATABASE_URL` selects the PostgreSQL authoritative store.
- `ControllerTrustConfig` supplies a SecretRef for the controller public key plus the configured issuer, audience, and expected SPKI SHA-256 fingerprint. Key bytes are resolved only through SecretManager/SecretProvider.
- `MDeployHostAdapters` supplies Git fetch, enrollment identity verification, controller availability, and either host-local runtime apply/rollback implementations or a local `MDeployDriverEffects` file/command boundary. Production composition selects exactly one runtime source; these are deployment-package inputs, not in-memory defaults.

Configuration lifecycle rules:

- runtime driver, IaC driver, Git source, registry config, and heartbeat timeout are bounded hot-reload fields.
- signing policy and signing key reference are not hot-reloadable without service restart and Audit evidence.
- config reload must not trigger apply; reconcile starts only from explicit approved operation or scheduled drift check.

---

## 7. Health

| Check | Meaning | Failure Behavior |
|-------|---------|------------------|
| liveness | controller process, scheduler loop, and agent ingress are alive | restart or report unavailable; existing deployed services continue outside controller |
| readiness | PostgreSQL, M-Policy, required M-Log write path, Git sync status, signing verifier, runtime driver, and agent registry are usable | remove from serving pool; new propose/apply/rollback fail closed or queue according to operation type |
| agent heartbeat | enrolled deployment agents report within timeout and include supported driver capabilities | target marked degraded/disconnected; apply and drift pause for that target |
| controller health | reconcile scheduler, operation lock, and event publisher are functioning | new operations are not admitted; in-flight operations move to typed degraded state |
| Git sync status | latest configured ref fetched and signed envelope verified within TTL | read path shows stale; reconcile rejected after TTL |
| runtime health | selected runtime class, driver, unit manager, availability, and immutable-image verification agree with the versioned runtime-health contract | production apply/promotion is blocked when Podman, Quadlet/systemd, or digest verification is unavailable |

Readiness is stricter than liveness. A live M-Deploy that cannot write Audit/evidence or validate signatures is not ready for protected operations.

---

## 8. Lifecycle

| Capability | Supported | Notes |
|------------|-----------|-------|
| reloadable | limited | bounded reload for runtime driver selection, Git source config, registry config, sync interval, snapshot TTL, and heartbeat timeout |
| rollbackable | yes | rollback restores a previously verified digest/image/runtime artifact combination and writes Audit + evidence before/after execution |
| degradable | yes | read/status surfaces degrade while high-risk control paths fail closed when authority, policy, secret, audit, or signature checks are unavailable |

Lifecycle details:

- apply operations are idempotent by operation ID + desired-state digest + target scope.
- rollback operations are separate high-risk operations, not implicit failure handlers hidden inside apply.
- promotion records preserve source and target environments, immutable image digest, SBOM, provenance and signature references, signer identity, approval actor, and the previous promotion/digest rollback pointer.
- in-flight operations persist checkpoint metadata so a restarted controller can resume only after revalidating policy, signature, Git digest, and Audit/evidence availability.
- apply/rollback admission and completion atomically persist authoritative operation state, evidence metadata, and event intent before dispatch; pending intents are visible and retried by later reconcile calls.
- agent pull-reconcile means agents poll/pull desired-state work; the controller does not SSH into nodes or push shell commands.

---

## 9. Logs

| Log | When Written | Required Fields |
|-----|--------------|-----------------|
| Timeline | proposal created, approval recorded, apply started/succeeded/failed, rollback started/succeeded/failed, drift detected/resolved, agent disconnected/recovered, evidence emitted | `summary`, `subject`, `operationId`, `desiredStateDigest`, `targetScope`, `correlationId`, `policyDecisionId?`, `auditId?` |
| Full | Git sync failures, signature verification diagnostics, driver stderr summaries after redaction, agent heartbeat degradation, registry pull errors, OpenTofu/Terraform plan/apply summaries, evidence archive failures | `source`, `level`, `message`, `traceId`, `correlationId`, `operationId?`, `nodeId?`, `errorCode?` |
| Audit | propose/approve/apply/rollback, signature verification result, rollback pointer selection, evidence archive write, denied/failed high-risk attempts, break-glass deployment actions if later introduced | `actor`, `action`, `resource`, `decision`, `operationId`, `desiredStateDigest`, `policyDecisionId`, `correlationId`, `result` |

Evidence behavior:

- evidence metadata is written before surfacing success for apply/rollback.
- M-Log persists immutable digest-bound evidence facts in `deployment_evidence` and returns `m-log://evidence/<id>` redacted storage references. M-Deploy stores only those references and correlation metadata. External object-archive replication remains a deployment prerequisite and is not claimed by the mounted route.
- evidence payloads must redact plaintext secrets, bearer tokens, host-local secret paths, raw private keys, and unrestricted command output.

### 9.1 OpenTelemetry Behavior

- `correlationId` propagates from Core request → M-Policy decision → M-Deploy operation → event → M-Log → OTel spans.
- M-Deploy creates a parent `mdeploy.reconcile` span per operation with attributes for `operationId`, `desiredStateDigest`, `targetScope`, `runtimeDriver`, and `policyDecisionId`.
- Apply paths create child spans: `mdeploy.git.sync`, `mdeploy.signature.verify`, `mdeploy.driver.plan`, `mdeploy.agent.pull`, `mdeploy.apply`, and `mdeploy.evidence.emit`.
- Drift paths create `mdeploy.drift.scan` and `mdeploy.drift.compare` spans; OpenSearch/search projection spans are auxiliary and must not affect control decisions.
- Rollback paths create `mdeploy.rollback.prepare`, `mdeploy.rollback.apply`, and `mdeploy.rollback.evidence` spans.
- Span attributes must contain digests, IDs, typed status, and redacted references only; no secret values, tokens, private keys, or raw host command output.

---

## 10. Policy Requirements

- all desired-state propose, approve, apply, and rollback requests are protected operations requiring Core identity verification, M-Policy authorization, and Audit before mutation.
- production rollout apply requires an M-Policy quorum proof with exactly two distinct eligible security-admin approvers; the original proposer cannot approve their own proposal, one approval is insufficient, and M-Deploy does not reconstruct the proof locally.
- M-Deploy must fail closed if M-Policy is unavailable, returns deny/manual review, or cannot persist the required approval/decision state.
- M-Deploy must fail closed if required Audit or evidence writes cannot complete for high-risk operations.
- signed desired-state envelope verification is mandatory before any reconcile or agent apply; verification failure writes Audit and blocks reconcile.
- production image admission requires a digest-only OCI reference whose digest matches metadata, plus SBOM, provenance, signature, and signer references; mutable/tag-only or incomplete artifacts fail typed validation.
- agents must verify signed desired-state envelopes locally before runtime actions; controller-side verification alone is insufficient.
- rollback requires its own policy decision and Audit chain; previous approval for apply does not authorize rollback.
- drift read/check is non-mutating but must enforce read permissions and redaction.
- M-Deploy must not implement local policy/quorum logic beyond consuming and persisting the M-Policy quorum proof ID.
- normal deployment path remains pull-reconcile; controller SSH push, arbitrary remote command execution, and Git push from M-Deploy are forbidden.

---

## 11. Done Criteria

- Service definition is versioned.
- Contracts for REST, Eden, events, agent heartbeat, proposal, approval, apply, rollback, drift, and evidence are declared.
- Runtime/provenance contracts distinguish Podman Quadlet/systemd production from Docker Compose compatibility, reject mutable image references and missing provenance, preserve promotion/rollback metadata, and report runtime health.
- Permissions are declared with risk level and high-risk control requirements.
- Owned state and must-not-own boundaries match the authority matrix.
- Dependencies and failure behavior are declared for Git, Vault/SecretProvider, Podman/Docker, OpenTofu/Terraform, PostgreSQL, NATS, M-Policy, M-Log, registry, Core, and agents.
- Config schema covers runtime driver selection, Git source config, registry config, signing config, heartbeat timeout, and evidence archive config.
- Health checks cover controller liveness, readiness, agent heartbeat, and Git sync status.
- Reload, rollback, and degradation behavior are declared.
- Timeline, Full, Audit, evidence, and OpenTelemetry behavior are declared.
- M-Policy requirements include high-risk gating and two-person approval for production rollout.
- The service definition states that normal path forbids controller SSH push and uses pull-reconcile only.
- Event subjects are registered in `docs/events/EVENT-CATALOG.md` before implementation.
- Permission vocabulary is registered in `docs/security/SECURITY-MODEL.md` before implementation.
