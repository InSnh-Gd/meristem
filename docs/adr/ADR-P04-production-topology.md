# ADR-P04: Production VM Topology And Degraded Operation

## 状态

Accepted

## 上下文

`MERISTEM-ROADMAP.md §7` requires a post-v0.1 Full-HA topology that separates control/state, search, and Leaf workloads while preserving PostgreSQL/local IAM/Git authority and keeping OpenSearch/Dashboards auxiliary. A single-host or Docker Compose deployment cannot provide the required systemd supervision, failure isolation, evidence, recovery, or RPO/RTO posture. Conversely, adding Kubernetes, a service mesh, or NetBird Management would broaden the accepted product/runtime scope and duplicate existing authority boundaries.

`docs/operations/RUNBOOK.md` defines the production bootstrap, restore order, RPO/RTO ownership, minimum operating modes and Podman/Quadlet runtime contract. `docs/security/SECURITY-MODEL.md` defines authority/fail-closed hierarchy; ADR-N04 defines the separately gated NetBird data-plane direction. This ADR accepts the target topology and operational posture, not a claim that the target infrastructure or live HA proofs already exist.

## 决策

### Eight-VM Full-HA target

- Production uses exactly three control/state VMs, three OpenSearch VMs and two Leaf VMs. The control/state tier hosts the Meristem control/state dependencies required by the documented bootstrap and restore chain; it does not make any projection, Dashboard or Leaf runtime authoritative.
- The three control/state VMs provide the HA scope for Vault Integrated Storage/Raft and the durable control/state recovery order. PostgreSQL remains authoritative for identity, policy, deployment, audit/evidence metadata and SecretRef metadata; Git remains desired-state authority; NATS/JetStream carries replayable event transport rather than authoritative facts.
- The three OpenSearch VMs form the secured cluster with distinct cluster-manager, data and ingest roles in distinct zones. OpenSearch and Dashboards are read-model/observability infrastructure only; Dashboards is private or operator-VPN-only, OIDC/RBAC-protected and read-only for Meristem control actions.
- The two Leaf VMs are workload/node-runtime targets. They have no authority over identity, policy, Audit, desired state, secret metadata or OpenSearch. Their M-Deploy agents pull approved work and their M-Net/node-agent data plane remains bounded by ADR-N04; NetBird Management, Dashboard, ACL/policy engine, auth/SSO, audit/logging and account model remain excluded.

### Runtime supervision and network boundaries

- Production workloads run rootless through Podman Quadlet units supervised by user systemd and the `meristem.target` lifecycle. M-Deploy deploys only digest-pinned, provenance-verified OCI artifacts through this runtime contract.
- Docker Compose is compatibility-only: it may render and validate the desired-state subset for local migration/portability checks, but cannot establish HA, Podman/Quadlet/systemd parity, rollback, production runtime health or readiness.
- Control/state APIs, databases, NATS, OpenSearch REST, service `/internal/v0/*` routes and deployment-agent control paths are private or loopback-only. Public exposure is limited to explicitly documented ingress; M-Net join ingress is TLS/WebSocket on `8443`. No topology rule exposes raw NATS, authority stores or internal service routes.
- NetBird Signal/Relay/STUN remain infrastructure dependencies under NixOS/systemd only when ADR-N04's target-environment viability gate succeeds. The proof gate is not replaced by this topology decision; its typed `wireguard-rendered` fallback remains the documented alternative.

### Recovery and degraded behavior

- Overall target is RPO 15 minutes and RTO 1 hour. Subsystem recovery objectives and sources remain those in `docs/operations/RUNBOOK.md §8.3`; authority restores before projections, and OpenSearch is restored/rebuilt only after PostgreSQL/M-Log authority is available.
- Vault sealed, unavailable or quorum-lost blocks secret-bearing deploy/config/session/token operations; it never falls back to plaintext or `local-dev-env`. Audit or required policy/authority failure blocks high-risk operations before mutation.
- OpenSearch/Dashboards, Prometheus, Grafana, Alertmanager and OTel degradation is visible but does not block PostgreSQL, M-Policy, M-Log Audit or control writes. OpenSearch cannot reconstruct authority during recovery.
- IdP outage fails OIDC login closed; only the local-IAM, audited, two-person, 30-minute break-glass path may supply the documented limited recovery access. M-Deploy agent disconnection pauses new apply and drift for that target, and Git outage permits read-only last-successful status only within its configured TTL. M-Net must show degraded state and eventually fail closed when signed-map freshness expires.

## 结果

- The topology separates authoritative control/state, auxiliary search, and Leaf runtime risk while preserving the existing Core/M-Policy/M-Log/M-Deploy/M-Net boundaries.
- Rootless Podman Quadlet/user systemd becomes the production runtime of record; Docker Compose retains an explicitly non-production compatibility role, and Kubernetes, Helm and service mesh remain outside scope.
- Operators have one documented authority-first bootstrap and restore sequence, plus explicit degradation behavior instead of treating search, secret, identity, network or deployment outages as silent success.
- The target requires VM capacity, zone-aware OpenSearch operation, Podman/user-systemd readiness, Vault custody, PostgreSQL/NATS recovery, private networking, monitoring and repeated environment-specific HA/DR proofs.
- Acceptance of this ADR does not supply live proof for the Podman Full-HA rollout, Vault custody ceremony, NetBird sidecar, OCI publication/signing, backup/restore or RPO/RTO exercise. Those remain target-environment gates in `docs/operations/RUNBOOK.md` and `docs/testing/TESTING.md`.

## 重访条件

- Capacity, availability, incident evidence or recovery drills prove that three control/state, three OpenSearch and two Leaf VMs cannot meet the documented RPO/RTO or isolation goals.
- A change to the authority matrix requires different data placement, replica strategy or public ingress, supported by contract migration, security review and restore evidence.
- Podman Quadlet/user systemd can no longer provide the verified production runtime semantics and a replacement can preserve the stated authority, evidence and rollback boundaries without introducing excluded orchestration platforms.
- ADR-N04's target-environment viability gate or its `wireguard-rendered` fallback proves inadequate for the Leaf data-plane requirements.
