# Production Readiness Evidence Summary

## Status

**Scope completion: 29/29 production-track tasks completed.** This summary
consolidates the implemented contracts, test sources, operator workflows, and
final repository-gate record for the post-v0.1 production track. It is an
engineering evidence index, not a production-change approval or a substitute
for executing environment-dependent gates in the target environment.

### Final Repository Gate Record

| Gate | Result |
| --- | --- |
| Main TypeScript typecheck | Clean |
| M-UI typecheck | 0 errors, 0 warnings |
| Lint | 0 warnings after the repository cleanup |
| Agent-submit drift guard | 8/8 passing |
| Dependency cruiser | 0 errors; 5 pre-existing circular-dependency warnings |
| Type-safety and path hygiene review | No unsafe assertion anti-patterns or internal-orchestration-path leakage found |

The production track keeps PostgreSQL and local IAM authoritative, Git as the
desired-state source, M-Policy and M-Log as required high-risk controls, and
OpenSearch/Dashboards as degradable projections only.

## T1-T13 Contract Foundation

| Task | Delivered |
| --- | --- |
| T1 | The roadmap authorizes a post-v0.1 production track without expanding the v0.1 acceptance scope. |
| T2 | ADR-N04 fixes the NetBird boundary to client-sidecar-only, excludes its management plane, and defines a typed fallback. |
| T3 | The authority matrix defines authoritative writers, read models, cache boundaries, degradation, and audit duties for identity, deployment, network, audit, search, observability, secrets, desired state, and evidence. |
| T4 | M-Deploy has a versioned service definition with API, event, permission, lifecycle, readiness, policy, audit, and must-not-own boundaries. |
| T5 | Bootstrap and disaster-recovery order, trust custody, subsystem RPO/RTO ownership, and minimum operating modes are documented. |
| T6 | Evidence packs use repository-safe naming and map production scenarios to Bun gates. |
| T7 | Local-IAM/OIDC/session schemas model issuer-and-subject binding, pending approval, disablement, PKCE, server-side sessions, rotation, revocation, and typed failures. |
| T8 | M-Deploy desired-state, signed-envelope, proposal, agent, drift, rollback, and evidence contracts reject unsigned, stale, malformed, wrong-runtime, and secret-bearing inputs. |
| T9 | Runtime and provenance contracts require immutable image digests and separate Podman production semantics from Docker compatibility semantics. |
| T10 | Vault HA extends SecretProvider without exposing plaintext, with least-privilege resolution, rotation, and sealed/denied failure behavior. |
| T11 | OpenSearch/Dashboards and the observability stack have versioned deployment, read-model, alert, and degradation contracts. |
| T12 | M-Net contracts cover approved join, credential lifecycle, topology/key status, tunnel/sidecar health, forced relay, migration, and time-bounded break-glass. |
| T13 | M-Deploy implements the signed, agent pull-reconcile workflow with durable operation/evidence state and fail-closed dependency behavior. |

**Foundation boundaries:** PostgreSQL remains the authoritative schema and
write model; M-EventBus/NATS carries versioned event intent rather than facts;
M-Policy remains the final authorization and approval authority; M-Log Audit
is non-bypassable for high-risk work; M-Task retains canonical task lifecycle
ownership; and M-UI BFF holds browser sessions while adapting only Core public
facts. These boundaries are consumed, not overridden, by the M-Deploy workflow.

**Key gates:** contract decode/encode, migration, failure-mode, integration, and
authority-boundary coverage are required by `docs/testing/TESTING.md`.

**Evidence files:** `docs/data/STATE-MODEL.md`,
`docs/security/SECURITY-MODEL.md`, `docs/services/m-deploy.md`,
`docs/adr/ADR-N04-netbird-runtime-integration.md`,
`tests/contracts/oidc-iam-bff.contract.test.ts`,
`tests/contracts/mdeploy-contracts.contract.test.ts`,
`tests/contracts/mdeploy-runtime-provenance.contract.test.ts`,
`tests/contracts/mnet-closed-loop.contract.test.ts`, and
`tests/failure-modes/mdeploy-desired-state.failure-mode.test.ts`.

**Known limitations:** the NetBird sidecar viability check remains a real
environment gate, not a CI simulation; its documented fallback is
`wireguard-rendered`. OpenSearch remains intentionally non-authoritative.

## T14-T17 Production Implementation

| Task | Delivered |
| --- | --- |
| T14 | Local IAM, Keycloak OIDC federation, JIT pending principals, approval/rejection, disablement, PKCE, HttpOnly session handling, rotation, revocation, logout, and audit mapping. |
| T15 | M-Net service closed loop for join and credentials, topology and health, forced relay, profile migration, policy/audit protection, and break-glass expiry. |
| T16 | Provider-neutral OpenTofu/Terraform adapter boundary, libvirt topology fixture, Podman Quadlet/user-systemd primary driver, and Docker Compose compatibility driver. |
| T17 | OCI build and promotion pipeline with digest pins, SBOM/provenance/signature metadata, secret-free build contexts, and staging-to-production rollback pointers. |

**Key gates:** `test:contracts`, `test:failure-modes`, and relevant integration
coverage verify fail-closed OIDC, signed desired-state, runtime-driver, secret,
and rollback paths. OCI preflight validates targets and metadata without
pretending to publish or sign release artifacts.

**Evidence files:** `docs/services/m-ui-bff.md`, `docs/services/m-deploy.md`,
`tests/contracts/oidc-iam-session.contract.test.ts`,
`tests/failure-modes/oidc-iam-bff.failure-mode.test.ts`,
`tests/failure-modes/mnet-closed-loop.failure-mode.test.ts`,
`tests/failure-modes/mdeploy-infrastructure-drivers.failure-mode.test.ts`,
`tests/contracts/mdeploy-runtime-provenance.contract.test.ts`, and
`tests/failure-modes/oci-pipeline.failure-mode.test.ts`.

**Known limitations:** production runtime proof is Podman plus Quadlet/user
systemd. Docker Compose proves renderer portability only and is not HA,
supervision, rollback, or production-equivalence evidence.

## T18 Observability

**Delivered:** a secured three-node OpenSearch deployment contract, protected
Dashboards ingress, snapshot/restore and projection rebuild rules, plus
Prometheus, Grafana, Alertmanager, OpenTelemetry, and Pino integration. Minimum
alerts cover control-plane availability, PostgreSQL, Vault, NATS, OpenSearch,
failed Audit writes, pending approvals, and M-Deploy drift/reconcile failure.

**Key gates:** OpenSearch failure-mode, contract, and integration gates prove
that projection loss is visible and rebuildable without blocking PostgreSQL,
M-Policy, M-Log Audit, or control operations.

**Evidence files:** `docs/operations/RUNBOOK.md`,
`tests/contracts/opensearch-search.test.ts`,
`tests/failure-modes/opensearch.test.ts`, and
`tests/integration/opensearch-projection.test.ts`.

**Known limitations:** Dashboards is private, authenticated, audit-visible,
and read-only. It cannot perform authority actions; OpenSearch recovery follows
the authority restore order rather than reconstructing authority from indexes.

## T19-T21 M-UI

| Task | Delivered |
| --- | --- |
| T19 | Chinese-first login, pending approval isolation, profile/session/logout, and local-IAM administration surfaces. |
| T20 | M-Net topology, join, credentials, key/map status, health, forced relay, migration, break-glass, degradation, and policy/audit evidence surfaces. |
| T21 | M-Deploy workbench views for desired state, topology, drivers, proposals, approvals, apply progress, drift, heartbeats, rollback, evidence, and degraded status. |

**Key gates:** M-UI calls only the BFF; the BFF uses Core public facades and
does not own final facts, authorization, policy, or Audit. CommandWell makes
high-risk actions explicit and auditable; degraded state exposes source and
correlation context rather than relying on color.

**Evidence files:** `docs/services/m-ui-bff.md`, `docs/ui/SDUI-SCHEMA.md`,
`tests/contracts/m-ui-bff.command-well.test.ts`,
`tests/contracts/m-ui-bff-mnet-dataplane.contract.test.ts`,
`tests/ui-contract/m-ui-bff-boundary.test.ts`,
`apps/m-ui/tests/runtime/oidc-login-stub.runtime.vitest.ts`,
`apps/m-ui/tests/runtime/network-management-loop.vitest.ts`, and
`apps/m-ui/tests/runtime/fail-closed-command.behavior.vitest.ts`.

**Known limitations:** browser tokens are prohibited. The BFF retains sessions
server-side and forwards correlation/error information without creating Audit
facts or exposing upstream OIDC tokens.

## T22-T28 Evidence and Operator Documentation

| Task | Delivered | Evidence files |
| --- | --- | --- |
| T22 | Full-HA libvirt fixture and Podman rollout, health, failure, rollback, and evidence proof. | `tests/integration/mdeploy-full-ha-proof.test.ts`; `tests/helpers/mdeploy-full-ha-fixture.ts` |
| T23 | Docker Compose rendering and optional local smoke as an explicitly compatibility-only gate. | `tests/integration/docker-compose-compat-proof.test.ts`; `tests/helpers/docker-compose-compat-fixture.ts` |
| T24 | Multi-node M-Net lifecycle proof for join, credentials, migration, relay, break-glass, and sidecar degradation. | `tests/integration/mnet-lifecycle-proof.test.ts`; `tests/failure-modes/mnet-lifecycle.failure-mode.test.ts` |
| T25 | Production operator journeys covering login, approval isolation, M-Net/M-Deploy command paths, degradation, and evidence traceability. | `tests/playwright/m-ui-operator-journeys.playwright.ts`; `tests/playwright/browser-smoke.playwright.ts` |
| T26 | Agent-executable backup/restore drills with subsystem RPO/RTO and authority-first restore ordering. | `tests/integration/backup-restore-proof.test.ts`; `docs/operations/RUNBOOK.md` |
| T27 | Cross-domain failure modes for Audit, policy, identity, secrets, signatures, break-glass, Dashboards, OpenSearch, Vault, and M-Net. | `tests/failure-modes/production-security-failure-modes.test.ts`; `tests/failure-modes/mdeploy-security-repair.failure-mode.test.ts` |
| T28 | Command-focused bootstrap, promotion, rollback, M-Net, identity, Vault, observability, restore, and incident-response instructions. | `docs/operations/RUNBOOK.md`; `docs/security/SECURITY-MODEL.md`; `docs/testing/TESTING.md` |

**Key gates:** full-HA and live-sidecar proofs require their documented target
environment prerequisites; security paths fail closed; restore preserves
PostgreSQL/Audit authority before projection rebuild; Playwright asserts
observable UI state in addition to API effects.

**Known limitations:** evidence artifacts are intentionally generated under the
repository evidence directory or temporary storage and are not committed. Live
proofs must be rerun for the deployment candidate and target topology.

## T29 Repository Gates

**Delivered:** repository-wide lint and drift cleanup without weakening type,
contract, runner, timeout, or dependency-boundary rules.

**Key gate results:** main typecheck is clean; M-UI typecheck has 0 errors and
0 warnings; lint has 0 warnings; the agent-submit drift guard passes 8/8; and
dependency-cruiser reports 0 errors.

**Evidence files:** `package.json`, `docs/testing/TESTING.md`,
`tests/contracts/schema-coverage.drift.contract.test.ts`, and
`tests/contracts/m-task-draft.test.ts`.

**Known limitations:** dependency-cruiser retains five pre-existing circular
dependency warnings. They are documented as warnings, not production-track
errors, and should be addressed independently rather than hidden or suppressed.

## Final Readiness Assessment

- **Completed scope:** all 29 production-track tasks are complete and their
  delivery, tests, contracts, and operator procedures are represented above.
- **Repository health:** the final record is green for typecheck, lint,
  agent-submit, and dependency-cruiser errors; no unsafe type-suppression or
  internal-orchestration-path leakage was found.
- **Production controls:** high-risk identity, network, deployment, and secret
  operations require the Core/M-Policy/M-Log path and fail closed when required
  authority, policy, Audit, signature, or secret dependencies are unavailable.
- **Environment prerequisites:** rerun the Podman Full-HA proof, NetBird
  sidecar proof, protected Vault ceremony, and authorized OCI publication/signing
  workflow for each target environment. A Docker result cannot replace any of
  these proofs.
- **Explicit non-goals:** cross-region active-active, multi-IdP orchestration,
  a custom SIEM, a custom registry, Kubernetes/Helm/service mesh deployment,
  NetBird Management/Dashboard, runtime SDUI rendering, and plugin-delivered UI
  remain out of scope.

### Documentation Navigation Caveat

The production-track entries in `docs/README.md` retain planning-oriented
wording. The active contracts and operational sources listed in this summary
are the authoritative engineering references until that index language is
synchronized in a separate documentation-only change.
