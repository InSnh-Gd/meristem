# Phase 20 - v0.1 Acceptance Closure

> Goal: close v0.1 planning with one executable acceptance matrix that proves the MVP and follow-on control-plane phases agree on contracts, logs, policy, state ownership, deployment profiles, and deferred work.

---

## 1. Scope

Phase 20 is a closure and acceptance phase. It does not introduce a new product capability. It consolidates the v0.1 implementation target across Phase 0 through Phase 19.

Phase 20 delivers:

```text
v0.1 acceptance matrix
contract drift audit
service ownership audit
event catalog completeness audit
state model completeness audit
security and Audit rule audit
CLI / REST smoke plan
optional deployment pack verification
deferred work register audit
release-blocker list
```

---

## 2. Accepted Decisions

- v0.1 closure is an acceptance gate, not a feature expansion phase.
- LLM-assisted review remains deferred.
- production identity providers remain deferred.
- production deployment platform remains deferred.
- real Wasm / webhook / cloud-function runtime remains deferred.
- broad M-UI feature expansion remains deferred outside the formal Phase 14 foundation.
- every intentionally deferred item must be present in `docs/roadmap/DEFERRED-WORK.md`.

---

## 3. Target Documents

Phase 20 must audit:

```text
MERISTEM.md
MERISTEM-DEV.md
MERISTEM-ROADMAP.md
docs/README.md
docs/mvp/MVP-SPEC.md
docs/roadmap/PHASE-0.md through docs/roadmap/PHASE-19.md
docs/roadmap/DEFERRED-WORK.md
docs/contracts/REST-API-MVP.md
docs/contracts/CLI-COMMANDS.md
docs/contracts/EDEN-MVP.md
docs/events/EVENT-CATALOG.md
docs/data/STATE-MODEL.md
docs/security/SECURITY-MODEL.md
docs/testing/TESTING.md
docs/operations/RUNBOOK.md
```

---

## 4. Acceptance Matrix

The v0.1 acceptance matrix must cover:

| Area | Required Evidence |
|------|-------------------|
| Core | health, ready, status, service definition, identity, config, secretRef boundaries |
| M-Policy | RBAC, risk foundations, approval execution, decision records |
| M-Log | Timeline, Full, Audit, OpenSearch read-model degradation |
| M-EventBus | event envelope, cataloged subjects, idempotent delivery rules |
| M-Net | logical network, join ingress, M-Net CN control-plane profile |
| M-Task | canonical task lifecycle, cancel, retry placeholder, suspended operation origins |
| M-UI | formal route / SDUI / BFF foundation |
| M-Extension | control-plane manifest and lifecycle only |
| M-CLI | command coverage for v0.1 operator flows |
| Deployment | default compose plus optional profiles only |
| Security | identity, secretRef, policy, Audit, redaction, LLM boundaries |
| Testing | typecheck, contracts, CLI, failure modes, integration, e2e, nodejs-ban |

---

## 5. Required Commands

When implementation exists, Phase 20 requires:

```bash
bun run lint
bun run typecheck
bun run test
bun run test:contracts
bun run test:cli
bun run test:failure-modes
bun run test:integration
bun run test:e2e
bun run nodejs-ban
docker compose config
docker compose --profile opensearch config
docker compose --profile redis config
docker compose --profile apisix config
```

OpenSearch integration may skip gracefully when OpenSearch is unavailable, but OpenSearch failure-mode and contract tests must remain runnable without OpenSearch.

---

## 6. Smoke Scenario

The v0.1 smoke scenario must include:

```text
start postgres + nats
run migrations and seed data
start Core and M-* services
issue Identity v0.2 operator token
register stem node
create leaf join ticket
start node-agent or simulated leaf path
create logical network
join stem and leaf where allowed
submit noop task through M-Task
view task status
cancel queued task
exercise retry not_implemented_for_phase path
read timeline
read audit as security-admin
run approval flow for supported M-Task operation
enable M-Net CN control-plane profile through approval path
register controlPlaneOnly M-Extension manifest
exercise config draft / validate / publish / rollback minimal path
create and rotate secretRef without leaking plaintext
verify optional deployment profiles statically
```

---

## 7. Closure Criteria

v0.1 planning is complete when:

- Phase 0 through Phase 20 have executable docs or are clearly historical / superseded.
- every external REST and CLI behavior in phase docs is represented in contract docs or explicitly deferred.
- every event subject referenced by phase docs appears in the event catalog or is marked deferred.
- every authoritative state table referenced by phase docs has an owner in the state model.
- every high-risk operation has M-Policy and Audit behavior documented.
- every deferred item has owner, reason, reopen trigger, and required-before-implementation entries.
- root roadmap and docs index agree on the phase set.
- no phase claims production deployment, production identity, LLM authorization, or extension runtime as v0.1 scope.

---

## 8. Non-Goals

Phase 20 does not implement:

- new runtime features.
- production deployment.
- production identity provider integration.
- LLM-assisted approval review.
- real extension execution.
- data-plane M-Net CN transport.
- broad UI feature expansion.

