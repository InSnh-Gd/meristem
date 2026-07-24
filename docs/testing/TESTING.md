# Testing Strategy

> Meristem uses tests as contract enforcement, not just regression detection.

---

## 1. Required Test Types

| Test Type | Purpose | Applies To |
|-----------|---------|------------|
| typecheck | TypeScript strictness and contract type coverage | all packages |
| unit | pure logic, Effect Schema decode/encode, and schema narrowing | contracts, policy, config, codec |
| contract | API, Eden, event, service definition compatibility | contracts and services |
| integration | Core with service, NATS, PostgreSQL boundaries | Core and capability domain services |
| failure-mode | degraded behavior and fail-closed behavior | policy, audit, event, storage |
| e2e | full-stack end-to-end: Core REST, BFF, CLI, auth, RBAC | all new capabilities |
| migration | old and new contract versions | versioned contracts |
| UI contract | SDUI schema and forbidden component rules | M-UI |
| performance | micro-benchmark throughput, p95 latency, flame graph profiles | contracts, policy, state machines |

---

## 2. TDD Rule

For core logic:

1. Write failing test.
2. Run it and confirm failure.
3. Implement minimum code.
4. Run test and confirm pass.
5. Add failure-path test.
6. Update docs if contract changed.

---

## 3. Minimum CI Gates

Agent pre-submit focused gate:

```bash
bun run test:agent-submit
```

This gate runs the contract drift checks most likely to fail after documentation, event catalog, or M-Task cutover edits. It complements, but does not replace, the boundary-specific gates below.

Final gate command matrix:

```bash
bun run format:check
bun run lint
bun run typecheck
bun run typecheck:e2e
bun run typecheck:m-ui
bun run test
cd apps/m-ui && bun run test
bun run test:agent-submit
bun run test:contracts
bun run test:failure-modes
bun run test:integration
bun run test:cli
bun run test:ui-contract
bun run test:perf
bun run test:e2e
```

Runner ownership matters here:

- root `bun run test` owns only Bun-compatible `*.test.ts` suites
- `cd apps/m-ui && bun run test` owns the M-UI Vitest / `happy-dom` runtime and component suites (`*.vitest.ts`)
- `bun run test:playwright` owns Playwright-only browser smoke coverage (`*.playwright.ts`)

Do not collapse those layers back into a single filename pattern. The split prevents bare root `bun test` from trying to execute Vitest `vi.mock` suites or Playwright `test()` files under Bun's runner.

**`*.vitest.ts` runner boundary (hard gate):** Component DOM tests inside
`apps/m-ui` must use the `*.vitest.ts` naming convention so they are picked up
by the Vitest runner (`cd apps/m-ui && bun run test`) and safely ignored by the
root Bun runner (`bun run test`). Root Bun suites must use the `*.test.ts`
naming convention. Do not mix runner-specific filename patterns — placing a
`vi.mock` or `@testing-library/svelte` import in a `*.test.ts` file will cause
the root Bun runner to fail. Conversely, a `*.vitest.ts` file that imports a
contract test helper expecting Bun's runner will fail under Vitest. The existing
`confirm-action-dialog.vitest.ts` and workspace seam tests
(`*-workspace.vitest.ts`) follow this convention.

OpenSearch-specific supplementary gates (not part of the standard matrix):

```bash
bun run test:opensearch-failure-modes
bun run test:opensearch-contracts
bun run test:opensearch-integration
```

These gates cover the `OpenSearchProductionContractV01Schema` and `ObservabilityContractV01Schema` executable contracts, including negative decode coverage for incomplete three-node roles, non-strict mappings, incomplete Dashboards action boundaries, missing alert rules, and lost dashboard degradation context. They also cover OpenSearch outage behavior, Dashboards unauthorized access semantics, projection rebuild from PostgreSQL, and minimum Alertmanager rules. They must not require a running OpenSearch cluster unless the test is explicitly under `test:opensearch-integration` and can still use in-memory projection seams.

Optional deployment pack static checks:

```bash
docker compose config
docker compose --profile opensearch config
docker compose --profile redis config
docker compose --profile apisix config
rg -n "/internal/v0|/api/v0/\*" ops/apisix/apisix.yaml
```

### M-Deploy Docker Compose Compatibility Gate

```bash
# Always proves versioned desired-state rendering and compatibility-only labels.
# When the Docker Compose CLI is installed, it also runs `docker compose config --quiet`.
bun test tests/integration/docker-compose-compat-proof.test.ts

# Optional local runtime smoke. It requires Docker daemon access and a locally cached,
# digest-pinned docker.io/library/alpine:3.20 image.
MERISTEM_MDEPLOY_DOCKER_COMPOSE_PROOF=1 \
  bun test tests/integration/docker-compose-compat-proof.test.ts
```

The static config invocation deliberately does not probe or contact the Docker daemon; it is a pure Compose manifest validation. If the Compose CLI is absent, that CLI-specific assertion skips explicitly while renderer and compatibility-boundary assertions still run. The live smoke also skips explicitly unless its opt-in environment variable, Docker daemon, and local pinned image are all available.

This is a compatibility gate only. It must not replace, weaken, or block the Podman/user-systemd production proof:

```bash
MERISTEM_MDEPLOY_FULL_HA_PROOF=1 \
  bun test tests/integration/mdeploy-full-ha-proof.test.ts
```

Compose does not prove systemd supervision, Quadlet lifecycle management, M-Deploy rollback/recovery, runtime-health integration, production restart semantics, or full-HA replacement behavior. A Compose failure or skip therefore does not make the Podman production gate fail; a Compose pass is never production-equivalence evidence.

OCI static build and promotion checks:

```bash
bun run oci:preflight
bun test tests/contracts/oci-pipeline.contract.test.ts \
  tests/failure-modes/oci-pipeline.failure-mode.test.ts
```

These checks validate every OCI target, immutable base-image requirements, promotion provenance and rollback metadata, and secret-free build contexts. They are dry-run-only: registry push and Cosign signing require an authorized release environment and must never be faked by CI.

APISIX, Redis, and OpenSearch profiles must not become prerequisites for the standard test suite.

No core capability is complete until these pass or an explicit documented exception exists.
Any new capability must also add or extend e2e coverage in `tests/e2e/`.

Additional hard gates:

- repository code must remain Bun-runtime-only: scripts, tests, services, and tooling run through Bun rather than the Node.js executable
- Node-compatible standard-library imports may use the `node:` protocol when required by Biome or TypeScript tooling, provided they are executed by Bun and do not introduce a Node.js runtime prerequisite
- workspace hygiene must reject generated output, dependency installs, local agent mirrors, local Codex runtime output, local Antigravity CLI output, and ignored `doc-driven-ai/` checkouts on review surfaces
- project skill hygiene must pass without Python or Node.js tooling
- source comments must satisfy `MERISTEM-DEV.md §8.2`
- complex internal workflows must have Effect success and failure-path tests at the workflow interface, not only route-level tests

Real-environment full-stack gate for local verification:

```bash
bun run test:real-env
```

This command reuses the local stack runtime to:
- start Docker-backed PostgreSQL and NATS
- generate join ingress certs
- migrate and seed the database
- run `typecheck`, `test:agent-submit`, and `test:integration` first
- run `test:e2e` last under the e2e harness's own full-stack orchestration

Important orchestration rules:

- `test:integration` runs before `test:e2e` because some integration suites start their own mock/internal services and must not compete with a pre-started dev stack on the same ports.
- `test:e2e` self-manages `dev:all` and `dev:m-ui-bff` via `tests/e2e/_shared.ts`; wrapper scripts must not start a second copy of those services for the same run.
- `test:real-env` executes Bun subcommands through `nix develop -c` so nested test subprocesses inherit required toolchain binaries such as `openssl`.

Optional `--opensearch`, `--redis`, and `--apisix` flags are treated as best-effort extras for this script: failure to start those profiles prints a warning and does not block the core real-environment gate, because those profiles are not standard test prerequisites.

Use `bun run test:real-env --dry-run` to inspect the exact orchestration steps without starting services.

Standalone browser smoke verification:

```bash
nix develop -c bun run test:playwright
```

This command validates the Playwright-to-Nix browser wiring only via `tests/playwright/*.playwright.ts`. It is intentionally separate from `test:e2e`, and must remain a standalone browser/runtime smoke layer unless a capability explicitly requires browser interaction as part of its contract.

Timeout rule:

- keep the default `bun test` per-test timeout at `5000ms`
- only real TLS / WebSocket / subprocess integration tests may opt into a longer per-test timeout
- prefer the test-level timeout parameter over widening the whole suite or script timeout

---

## 3.1 E2E Test Requirements

The e2e suite in `tests/e2e/core-rest.test.ts, tests/e2e/bff.test.ts, tests/e2e/cli.test.ts` validates the full request path through real Core, BFF, and CLI processes. It is the final gate before claiming a capability complete.

Every new capability must extend e2e coverage with at least:
- One happy-path test exercising the capability through REST or CLI.
- One auth failure-mode test proving insufficient permissions are rejected (`401` or `403`).
- One boundary test if the capability has a documented state or input restriction (e.g., `409` for invalid mode, `404` for missing resource).

Do not add UI-only browser tests to the e2e suite unless the capability is explicitly UI-facing and the browser interaction is part of the contract. The existing e2e suite covers API, BFF, and CLI layers only.

When a refactor extracts a new helper/support/workflow/client-factory seam from existing code, add at least one **direct** test for the extracted seam. Do not rely only on historical indirect coverage from the original file.

When removing or replacing old e2e tests, update this section to describe the new canonical suite.

E2E tests that require three-host capability (Core + Stem + Leaf) skip gracefully when the full topology is not available in the test environment. The skip is explicit via `bun:test` `test.skipIf` or a top-level guard, not a silent pass.

---

## 4. Contract Tests

Must cover:

- `MEventEnvelope` required fields
- event payload schema validation
- service definition required fields
- REST/OpenAPI route versioning
- Eden contract sample compatibility
- internal loopback HTTP + Eden compatibility for `M-Policy`, `M-Log`, `M-EventBus`, and `M-Net`
- config schema versioning
- M-Policy decision result shape
- Audit Log required fields
- Effect Schema decode/encode for internal executable contracts that back policy, event, log, projection, config, service definition, webhook, or BFF command-state shapes
- drift checks between shared Effect Schema contracts and Elysia TypeBox/OpenAPI adapter schemas when both exist

MVP-specific contract tests:

- REST route schemas match `docs/contracts/REST-API-MVP.md`.
- CLI command outputs match `docs/contracts/CLI-COMMANDS.md`.
- Eden status client returns the same shape as REST status.
- internal service Eden clients return the same shapes as their HTTP routes.
- PostgreSQL logical schema matches `docs/data/POSTGRES-SCHEMA-MVP.md`.
- logical network create/join/member routes enforce documented `stem` / `leaf` rules.
- lifecycle prototype routes and CLI match `docs/contracts/SERVICE-LIFECYCLE-PROTOTYPE.md`.
- node registration default mode and node credential issuance match the node registration contract.
- heartbeat transition and timeout helpers match the documented `joining -> healthy/degraded -> offline` rules.
- join ingress runtime tests prove ticket redemption is single-use and resumed sessions supersede stale sockets.
- M-UI transitional workbench contract tests prove the current M-UI BFF route registry, disabled command explanations, BFF OpenAPI output, Core error envelope mapping, and no direct M-UI -> Core dependency.
- M-Extension contract tests prove manifest schema decode / encode, manifest versioning, supported declaration kinds, event subjects, REST route schemas, and CLI command outputs match the docs.
- Identity v0.2 contract tests prove token issue / revoke / introspection schemas, `jti` revocation, and capability domain service auth verification contracts match the docs.
- SecretRef contract tests prove secretRef metadata, versioning, rotation, and redaction contracts match the docs.
- SecretRef schema contract tests prove `SecretRefV01`, `SecretRefVersionV01`, `SecretRefTransitionV01`, REST route schemas, and CLI command outputs match implemented names and documented redaction behavior.
- Config Lifecycle contract tests prove config schema validation, deterministic hash, version, publish, apply-ack, rollback, and event subjects match the docs.
- M-Net profile contract tests prove profile Effect Schema decode / encode, external REST route schemas and OpenAPI output, CLI network profile command contract, and profile event subject and payload schemas match the docs.

---

## 5. Failure-Mode Tests

Must cover:

- M-Policy unavailable means protected operation fails closed.
- Audit Log unavailable blocks high-risk operation.
- OpenSearch unavailable does not block authoritative writes.
- OpenSearch outage keeps authoritative writes available while search/projection reports degraded.
- Dashboards unauthorized access returns `401` or `403` and remains audit-visible through the Meristem boundary.
- Read-model rebuild after restore catches OpenSearch projections up from PostgreSQL / M-Log authoritative rows.
- Alert rule contracts include failed Audit writes as a critical M-Log alert.
- Secured OpenSearch deployment assertions prove the three role-separated TLS nodes, private Dashboards ingress, strict mappings, snapshot-before-delete lifecycle, Prometheus/Grafana/Alertmanager/OTel/Pino wiring, and failed-audit-write, cluster-health, and disk-watermark alerts.
- M-Log readiness remains `ready` when authoritative dependencies are healthy and OpenSearch is unavailable; yellow OpenSearch health is visible as `degraded` without treating the read model as authority.
- Snapshot/restore fixture tests prove Timeline, Full Log, and Audit projections restore in order and each is rebuilt through M-Log from PostgreSQL.
- OpenSearch search tests: `test:opensearch-failure-modes` must pass first (no OpenSearch required). `test:opensearch-contracts` validates query, OpenSearch production, and observability contracts. `test:opensearch-integration` validates projection rebuild behavior and skips or uses seams when OpenSearch is not running.
- NATS unavailable degrades event-dependent capabilities.
- Leaf Node abnormal state shrinks or revokes permissions.
- LLM unavailable does not block normal operation and cannot authorize high-risk operation.

MVP failure-mode tests:

- PostgreSQL unavailable makes readiness fail.
- NATS unavailable makes event-dependent operations fail or explicitly degrade.
- Audit Log write failure blocks node registration and task submitment.
- Audit Log write failure blocks network creation and network join.
- viewer cannot register node.
- viewer cannot issue node tokens.
- viewer cannot create logical networks.
- operator cannot read Audit Log.
- security-admin can read Audit Log.
- missing or invalid JWT returns `401`.
- valid JWT with insufficient permission returns `403`.
- missing or invalid internal token makes the target service unavailable.
- M-Policy HTTP timeout fails protected operations closed.
- M-Log Audit write timeout fails protected mutating operations closed.
- M-Net unavailable fails network routes closed with `503`.
- viewer cannot reload a service.
- non-reloadable service returns `409`.
- reload failure writes Full Log; `service.lifecycle.reload.failed.v0` remains deferred until a real publisher is wired.
- agent task submitment without an active token returns `409`.
- M-Extension registration rejects unknown requested permissions.
- M-Extension registration rejects high and critical risk manifests.
- M-Extension register / enable / disable fail closed when M-Policy is unavailable or denies the actor.
- M-Extension register / enable / disable fail closed when required Audit cannot be written.
- M-Extension does not execute Wasm, webhook, HTTP callback, script, or cloud-function behavior in the M-Extension control plane.
- revoked actor token is denied and cannot authorize protected routes.
- Core token introspection unavailable fails protected external capability domain routes closed.
- token plaintext never appears in Timeline, Full, Audit, OpenSearch projection payloads, or CLI stderr/stdout except the one-time issue response.
- secret plaintext never appears in Timeline, Full, Audit, OpenSearch projection payloads, events, or error envelopes.
- SecretRef failure-mode tests prove redaction across Timeline, Full, Audit, OpenSearch projection payloads, events, error envelopes, and CLI stdout/stderr, and prove M-Policy / Audit fail-closed behavior for create, rotate, disable, metadata read, and reference paths.
- config publish / rollback fail closed when M-Policy or Audit is unavailable for protected domains.
- config payloads containing plaintext secret fields are rejected.
- Effect workflow tests cover typed failure mapping for task submitment, projection backfill/DLQ, service lifecycle reload, M-Policy authorization, and M-Log write/projection paths when those workflows are introduced.
- Audit unavailable blocks profile disable and enable request.
- M-Policy unavailable fails profile operations closed.
- approval creation failure leaves network profile unchanged.
- resume stale current profile fails without applying CN.
- duplicate resume is rejected by idempotency.
- event publish failure writes Full Log and does not create false state.
- operator can read profiles but cannot enable / disable.
- disable in default state returns `409 profile.not_enabled`.

### 5.1 M-Net Data-Plane Exact Gates

Task-level data-plane security work is not complete until all of the following failure-mode gates exist and pass together:

- `tests/failure-modes/mnet-dataplane-security-hardening.test.ts` covers typed outcomes for public-key duplicates, clock skew rejection, expired/revoked ticket rejection, credential rotation race, stale map fail-closed behavior, partition handling, event-bus unavailable mapping, relay unavailable fallback/fail-closed behavior, address exhaustion, offline leaf migration pending state, and ACME directory failure behavior.
- `tests/failure-modes/mnet-dataplane-redaction-scan.test.ts` scans every new event/log/UI fixture for forbidden private material, including `privateKey`, `wireguardPrivateKey`, PEM markers, runtime tokens, ACME secret fields, and sidecar secret fields.
- `tests/failure-modes/m-net-runtime-redaction.test.ts` remains the runtime redaction gate for existing M-Net payload surfaces.
- `tests/failure-modes/node-agent-sidecar.test.ts` remains the sidecar crash / degraded-state gate.
- `tests/failure-modes/mnet-dataplane-orchestration.test.ts` remains the audit-unavailable, policy-denial, and break-glass precedence gate.
- `tests/failure-modes/m-net-disable-approval.test.ts` remains the profile disable fail-closed and audit-chain gate.
- `tests/failure-modes/m-net-operation-locks.test.ts` remains the concurrency / operation-lock gate for overlapping profile mutations.

Required command gate:

```bash
bun run test:failure-modes
```

### 5.1.1 M-Net Closed-Loop Gates

Closed-loop M-Net work is incomplete unless these focused suites pass together:

```bash
bun test tests/contracts/mnet-closed-loop.contract.test.ts \
  tests/contracts/mnet-closed-loop-routes.contract.test.ts \
  tests/contracts/mnet-node-runtime-tunnel-health.contract.test.ts \
  tests/services/m-net/closed-loop-workflow.test.ts \
  tests/failure-modes/mnet-closed-loop.failure-mode.test.ts
```

The suites must prove explicit authorized join rejection, policy/Audit fail-closed behavior with no authoritative mutation, credential issue/rotate/revoke failure handling, PostgreSQL decode/storage failure mapping, durable pending EventBus publication and retry, typed sidecar degradation, node-runtime-only tunnel health reporting, forced relay denial with `sideEffect: "none"`, profile migration compensation, and two-person break-glass expiry at exactly 30 minutes. Route suites must include malformed TypeBox input and reject the removed public tunnel-health writer.

When claiming that M-Net virtual networking is **really usable** (not only control-plane healthy), pair the automated gates above with the operator runbook proof in `docs/operations/M-NET-THREE-NODE-VALIDATION.md`, including at least one successful in-tunnel flow over the published `100.96.x.x` addresses on the live harness.

Required evidence capture for data-plane security hardening:

```bash
bun test tests/failure-modes/mnet-dataplane-redaction-scan.test.ts
bun test tests/failure-modes/mnet-dataplane-security-hardening.test.ts --test-name-pattern "expired and revoked join tickets"
```

The commands above are mandatory because the private-material scanner and expired-ticket rejection path require durable proof.

### 5.2 M-Net v0.2 Runtime Failure Matrix

The runtime failure matrix documents 11 failure classes for the v0.2 NetBird data-plane track. Each class maps to an automated test or documented gap. The matrix is generated and verified by a dedicated test:

```bash
bun test tests/failure-modes/runtime-failure-matrix.test.ts
```

This test:
- Defines all 11 classes with runtime codes, test coverage, and recovery paths.
- Generates `tests/evidence/runtime-failure-matrix.json` with the full matrix.
- Verifies every class has a covering test or an explicit documented gap reason.
- Provides inline unit tests for the typed failure paths of NetBird binary missing, start failure, and probe failure (classes 5-7) where real OS-level process management is not available in CI.

| Class | Runtime Code | Test File | Status |
|-------|-------------|-----------|--------|
| 1. OIDC unavailable | `invalid_discovery` | `auth-shared-verifier.failure-mode.test.ts` | Covered |
| 2. Invalid token | `bad_issuer` / `bad_audience` / `expired_token` / `invalid_token` | `auth-shared-verifier.failure-mode.test.ts`, `auth-shared-verifier.contract.test.ts` | Covered |
| 3. SecretProvider missing | `secret_missing` / `core.secret_startup_failed` | `secret-provider.failure-mode.test.ts`, `node-agent-sidecar-lifecycle.failure-mode.test.ts` | Covered |
| 4. SecretProvider denied | `permission_denied` | `secret-provider.failure-mode.test.ts` | Covered |
| 5. NetBird client missing | `netbird.binary.invalid` | `runtime-failure-matrix.test.ts` (inline), `mnet-v02:sidecar-proof` (live gate) | Gap: binary not in CI |
| 6. NetBird start failure | `netbird.start_failed` | `runtime-failure-matrix.test.ts` (inline) | Gap: real spawn not in CI |
| 7. NetBird probe failure | `netbird.process.not_running` / `netbird.<reason>` | `node-agent-sidecar.test.ts`, `runtime-failure-matrix.test.ts` (inline) | Covered |
| 8. Packet reachability failure | `relay.unavailable` | `mnet-dataplane-security-hardening.test.ts` | Covered |
| 9. Expired map | `network_map.stale` / `network_map.expired` | `mnet-dataplane-security-hardening.test.ts` | Covered |
| 10. Sidecar proof gate failure | `wireguard-rendered` (typed fallback transport) | `bun run mnet:v02:sidecar-proof` (live gate), ADR-N04 §5-§6 | Gap: live-only gate |
| 11. M-UI disabled repair | `disabled` / `command.invalid_body` / `feature.unavailable` | `m-ui-bff-mnet-commands.test.ts` | Covered |

**Sidecar proof gate note:** `bun run mnet:v02:sidecar-proof` is a live-environment viability gate (ADR-N04 §5). It must not be mocked to pass in CI. CI coverage is limited to typed failure paths. If the proof gate exits nonzero, the typed fallback transport is `wireguard-rendered` (ADR-N04 §6). See `docs/runbooks/MNET-V02-RUNBOOK.md §2.10` for the full proof-gate failure recovery path.

See `docs/runbooks/MNET-V02-RUNBOOK.md` for full recovery paths and diagnostic commands for each class.

---

## 6. UI Contract Tests

Must cover:

- high-risk action appears only in CommandWell
- critical state is not color-only
- Audit / Policy / Log / Node state components display traceable source

UI contract tests are not backend-only MVP blockers, but they are required to keep the current transitional workbench boundary and SDUI contracts coherent.

M-UI transitional workbench BFF contract additions:
- M-UI BFF must expose minimal OpenAPI for UI-facing endpoints.
- M-UI must call M-UI BFF only, not Core REST directly.
- BFF must not cache Core data or permission context across requests.

M-UI ownership gates:

- M-UI owns route surfaces, Svelte components, layout decisions, interaction structure, and the `layout / modules / ui` split.
- Capability domain services expose facts, capabilities, events, policy state, audit state, and domain state; they must not supply M-UI pages, Svelte components, layouts, or runtime frontend modules.
- M-UI BFF remains a UI-facing adaptation layer. It may aggregate, trim, order, annotate `stateSource`, and derive display-oriented command eligibility, but it must not own UI structure, final business facts, final authorization, or final policy decisions.
- SDUI remains a route/component contract registry. UI contract tests must not treat it as a runtime page renderer or composition engine unless a future ADR and contract migration explicitly introduce that architecture.
- M-Extension and plugin UI contribution remain deferred architecture; tests for current scope must not require plugin-provided routes, components, or layouts.
- M-UI must continue to call M-UI BFF only; BFF must use Core public facades for Core and capability domain facts/capabilities.
- Frontend modularity should happen inside M-UI-owned code, with domain modules consuming BFF-shaped data rather than service/plugin-supplied runtime UI.

### 6.0 M-UI Frontend Verification

M-UI frontend changes must use the current implementation and explicit task requirements as the source of visual truth. Historical design exploration documents under `docs/ui/` are reference material only.

Required commands for UI-facing frontend changes:

| Command | What It Verifies |
|---------|-----------------|
| `bun run typecheck:m-ui` | TypeScript strictness for the `apps/m-ui` workspace. |
| `cd apps/m-ui && bun run test` | M-UI Vitest / `happy-dom` runtime and component suites. Component DOM tests must use the `*.vitest.ts` naming convention. |
| `bun run test:ui-contract` | SDUI and UI boundary contract coverage. |

Additional UI runtime tests should live under `apps/m-ui/tests/runtime/` when they need the M-UI Vitest runner. Runner boundaries from §3 (`*.vitest.ts` vs `*.test.ts`) apply.

---

## 6.1 Identity v0.2 Test Expectations

Identity v0.2 must keep four test layers aligned:

- contract tests for schema shape, route shape, and documented outputs
- failure-mode tests for revocation, introspection failure, Audit fail-closed behavior, and token redaction
- CLI tests for actor/token command behavior
- integration/e2e coverage for internal introspection and end-to-end token lifecycle

The exact test file set may evolve; the required behaviors above are the stable contract.

---

## 6.2 SecretRef v0.1 Test Expectations

SecretRef v0.1 must keep four test layers aligned:

- contract tests for schema shape, route shape, and redacted command outputs
- failure-mode tests for M-Policy fail-closed behavior, Audit fail-closed behavior, and secret redaction across every surface
- CLI tests for metadata-only list/show/create/rotate/disable flows
- e2e coverage for full lifecycle and permission-denied paths

The exact test file set may evolve; the required behaviors above are the stable contract.

---

## 7. MVP Acceptance Test Sequence

Run after implementation scripts exist:

```bash
bun run lint
bun run typecheck
bun run test
bun run test:contracts
bun run test:cli
bun run test:failure-modes
bun run test:integration
# OpenSearch tests
bun run test:opensearch-failure-modes
bun run test:opensearch-contracts
bun run test:opensearch-integration
bun ops/opensearch/scripts/snapshot-restore-drill.ts --fixture
bun run test:e2e
docker compose up -d postgres nats
bun run db:migrate
bun run db:seed
export MERISTEM_INTERNAL_TOKEN=change-me-internal-shared-token
bun run scripts/certs-dev.ts
bun run dev:all
MERISTEM_TOKEN=<operator-token> bun run meristem status
MERISTEM_TOKEN=<operator-token> bun run meristem node register --kind stem --name local-stem
MERISTEM_TOKEN=<operator-token> bun run meristem node register --kind leaf --name local-leaf
MERISTEM_TOKEN=<operator-token> bun run meristem node ticket create --kind leaf --name remote-leaf
MERISTEM_TOKEN=<operator-token> bun run meristem node list
MERISTEM_TOKEN=<operator-token> bun run meristem network create --name lab-mesh
MERISTEM_TOKEN=<operator-token> bun run meristem network join --network <network-id> --node <stem-node-id>
MERISTEM_TOKEN=<operator-token> bun run meristem network members --network <network-id>
MERISTEM_TOKEN=<operator-token> bun run meristem service list
MERISTEM_TOKEN=<operator-token> bun run meristem service reload --service m-log --reason smoke-test
MERISTEM_TOKEN=<operator-token> bun run meristem task submit --node <leaf-node-id> --type noop
MERISTEM_TOKEN=<operator-token> bun run meristem log timeline
MERISTEM_TOKEN=<security-admin-token> bun run meristem audit list
```

---

## 8. Performance Tests

Performance tests live under `tests/perf/` and measure micro-benchmark throughput, latency distributions, and CPU hot-path profiles. They are independent of any running infrastructure (no PostgreSQL, NATS, or HTTP server required).

### 8.1 Test Categories

| Category | File | Measures |
|----------|------|----------|
| CPU micro-benchmarks | `baseline-cpu.perf.test.ts` | json-stringify-parse, uint8array-copy, text-encode-decode, file-io throughput |
| HTTP handler logic | `core-http.perf.test.ts` | schema validation, JSON serialization, route parameter parsing, literal validation throughput |
| M-Net profile operations | `mnet-profile.perf.test.ts` | profile state machine, guard predicates, store operations, suspended operations throughput |
| M-Net network map rendering | `mnet-network-map.perf.test.ts` | single-map and per-node render latency, O(N²) guard |
| Database operations | `db-operations.perf.test.ts` | schema loading, seed data generation, SQL template construction throughput |
| P95 latency | `latency-p95.perf.test.ts` | single-operation p50/p95/p99 latency for state machine, events, policy, config hash, and secret redaction |
| CPU flame graph | `flamegraph-cpu.perf.test.ts` | sampling-based hot-path profiles with flamegraph-compatible folded output |

### 8.2 Shared Utilities

`tests/perf/helpers/perf-utils.ts` provides:

- `runBenchmark()` — warmup + measured round runner
- `aggregateRounds()` — median, trimmed mean, coefficient of variation aggregation
- `computeLatencyStats()` — p50/p95/p99 latency distribution
- `evaluateBenchmarkGate()` — CV threshold and median regression gate

### 8.3 Commands

```bash
bun run test:perf
bun run test:perf:stable          # 5 runs, aggregated mean and cross-run CV
bun run test:perf:stable 10       # custom run count
```

### 8.4 Benchmark Gate Policy

Each benchmark round evaluates a stability gate:

- Coefficient of variation (CV) must be ≤ 0.35 within a single run.
- Median regression must not exceed 20% from baseline when a prior profile exists.

### 8.5 Stability Requirements

Performance tests must remain stable across runs. The `test:perf:stable` command runs the full suite multiple times and reports cross-run CV for each metric:

- ✓ CV < 5% — stable
- ~ CV < 15% — acceptable
- ✗ CV ≥ 15% — unstable, requires investigation

Results are not required for CI gates but must be verified before performance-sensitive changes to contract schemas, policy decisions, or state machine transitions.

---

## 9. 生产轨道证据包（Production Evidence Packs）

> 本节定义 post-v0.1 生产轨道的测试证据包标准。每个证据包将生产域场景映射到现有 Bun 测试门禁，并强制标准化的证据产物路径和命名规则。
>
> 生产轨道范围由 `MERISTEM-ROADMAP.md §7` 正式授权，通过 `DEFERRED-WORK.md`（DFW-027、DFW-028）重新打开。

### 9.1 证据产物标准（Evidence Artifact Standards）

#### 9.1.1 命名规则

- **产物目录**：`tests/evidence/` — 生产测试证据产物的唯一存放位置。该目录已加入 `.gitignore`，产物不进入版本控制。
- **文件命名**：`<feature>-<scenario>.<ext>` — 描述特性和场景，禁止使用任务编号前缀。示例：
  ```
  tests/evidence/iam-disabled-oidc-denial.txt
  tests/evidence/mnet-join-approval-lifecycle.json
  tests/evidence/m-deploy-rollout-drift.json
  tests/evidence/observability-alert-rules.json
  tests/evidence/vault-sealed-recovery.json
  tests/evidence/opensearch-outage-auth-safe.txt
  tests/evidence/podman-runtime-proof.txt
  ```
- **禁止**：
  - 任务编号前缀证据名（如 `t1-*`、`T1-*`、`task-1-*`、`Task-1-*`）。
  - 内部编排路径引用（参见 `AGENTS.md` 内部编排目录隔离约束）。
  - 硬编码绝对路径。
  - 计划内部标识符（plan-internal identifiers）。

#### 9.1.2 测试代码规则

- 测试代码必须从 `import.meta.dir` 相对拼接或 `mkdtemp` 派生证据路径，不得硬编码绝对路径或内部编排路径。
- 示例（正确）：
  ```typescript
  import { join } from "node:path";
  const evidenceDir = join(import.meta.dir, "..", "evidence");
  const outputPath = join(evidenceDir, "iam-oidc-login-success.json");
  ```
- 示例（正确，临时目录）：
  ```typescript
  import { mkdtempSync } from "node:fs";
  import { tmpdir } from "node:os";
  const tmpDir = mkdtempSync(join(tmpdir(), "meristem-evidence-"));
  ```

#### 9.1.3 文档引用规则

- 文档只引用命令，不引用证据输出路径。
- 示例（正确）：写 `bun run mnet:harness:preflight`
- 示例（错误）：写 `bun run mnet:harness:preflight > <内部编排路径>/evidence/proof.json`
- 契约测试断言不得断言文档中包含特定证据文件路径。

### 9.2 证据包定义（Evidence Pack Definitions）

#### 9.2.1 IAM / 登录证据包

| 场景 | 描述 | 产物示例 | 测试门禁 |
|------|------|----------|----------|
| OIDC 登录成功 | 合法 issuer+subject，token 验证通过，session 签发 | `iam-oidc-login-success.json` | `test:e2e`、`test:contracts` |
| OIDC 登录失败 | 错误 issuer、错误 audience、过期 token、无效签名 | `iam-oidc-login-failure.txt` | `test:failure-modes`、`test:contracts` |
| JIT pending principal | 首次 OIDC 登录自动创建 pending 状态 principal，不可执行操作 | `iam-jit-pending-principal.json` | `test:failure-modes`、`test:e2e` |
| BFF session 管理 | HttpOnly、Secure、SameSite=Strict session cookie，前端不接触 token | `iam-bff-session-management.json` | `test:e2e`、`test:contracts` |
| Break-glass 紧急访问 | 双人 30 分钟 TTL break-glass，M-Policy multi-approval | `iam-break-glass-access.json` | `test:failure-modes`、`test:e2e` |

专用命令门禁：

```bash
bun run test:failure-modes
bun run test:e2e
bun run test:contracts
```

#### 9.2.2 M-Net 生命周期证据包

| 场景 | 描述 | 产物示例 | 测试门禁 |
|------|------|----------|----------|
| Profile join approval | 加入审批通过/拒绝、审批链完整 | `mnet-join-approval-lifecycle.json` | `test:failure-modes`、`test:e2e` |
| Credential rotate/revoke | 凭证轮换和撤销，旧凭证立即失效 | `mnet-credential-rotate-revoke.json` | `test:failure-modes`、`test:contracts` |
| Forced relay | 强制中继路径，relay 不可用时的降级行为 | `mnet-forced-relay-degraded.txt` | `test:failure-modes` |
| Sidecar degraded | NetBird sidecar 异常、crash、restart 行为 | `mnet-sidecar-degraded-state.json` | `test:failure-modes` |
| Break-glass network | 网络 break-glass 路径，双人审批 | `mnet-break-glass-network.json` | `test:failure-modes`、`test:e2e` |

专用命令门禁：

```bash
bun run test:failure-modes
bun run test:e2e
bun run test:contracts
bun run mnet:harness:preflight
```

#### 9.2.3 M-Deploy 发布 / 回滚证据包

| 场景 | 描述 | 产物示例 | 测试门禁 |
|------|------|----------|----------|
| Signed desired-state | 签名 desired-state 拉取、校验、reconcile | `m-deploy-reconcile-success.json` | `test:e2e`、`test:contracts` |
| Drift detection | desired-state 与实际状态漂移检测 | `m-deploy-drift-detection.json` | `test:failure-modes` |
| Rollback | 发布失败后的自动或手动回滚 | `m-deploy-rollback-on-failure.json` | `test:failure-modes`、`test:e2e` |
| Agent disconnected | 部署 agent 断开连接时的行为 | `m-deploy-agent-disconnected.txt` | `test:failure-modes` |
| Durable outbox restart | runtime 成功后 EventBus 失败，重建 production composition 后仅重试发布、不重复 apply | `m-deploy-outbox-restart.json` | `test:integration` |
| Forged enrolled trust | controller/agent 对 canonical bytes、签名、issuer、audience、fingerprint、expiry 进行双重验证 | `m-deploy-forged-envelope.json` | `test:failure-modes`、`test:integration` |
| Policy quorum authority | 一票无 proof，两名不同 eligible approver 才由 M-Policy 返回 proof ID | `m-deploy-policy-quorum.json` | `test:contracts`、`test:failure-modes` |
| Blocked rejection restart | agent pre-runtime reject 写 blocked + Audit，重建 composition 后仍可检索 | `m-deploy-blocked-restart.json` | `test:integration` |

专用命令门禁：

```bash
bun run test:failure-modes
bun run test:e2e
bun run test:contracts
bun run test:integration
```

#### 9.2.4 可观测性 / 故障转移证据包

| 场景 | 描述 | 产物示例 | 测试门禁 |
|------|------|----------|----------|
| Alert rules | Prometheus alert rules 验证，阈值触发 | `observability-alert-rules.json` | `test:contracts` |
| Failover behavior | 控制平面节点故障转移，Raft 共识恢复 | `observability-failover-behavior.json` | `test:failure-modes`、`test:integration` |
| Degraded states | 降级状态可见性：OpenTelemetry traces + Grafana dashboards | `observability-degraded-states.json` | `test:failure-modes` |

专用命令门禁：

```bash
bun run test:failure-modes
bun run test:integration
bun run test:contracts
```

#### 9.2.5 Vault 恢复证据包

| 场景 | 描述 | 产物示例 | 测试门禁 |
|------|------|----------|----------|
| Sealed state | Vault sealed 状态，SecretProvider v0.2 fail-closed | `vault-sealed-recovery.json` | `test:failure-modes` |
| Key rotation | Vault 密钥轮换，SecretRef rotation 联动 | `vault-key-rotation.json` | `test:integration` |
| Restore | Vault 备份恢复，Raft snapshot restore | `vault-restore-from-backup.json` | `test:failure-modes` |

专用命令门禁：

```bash
bun run test:failure-modes
bun run test:integration
```

#### 9.2.6 OpenSearch 降级证据包

| 场景 | 描述 | 产物示例 | 测试门禁 |
|------|------|----------|----------|
| Outage authority-safe | OpenSearch 不可达时权威写操作不受影响 | `opensearch-outage-auth-safe.txt` | `test:opensearch-failure-modes` |
| Snapshot rebuild | OpenSearch 快照重建，索引恢复 | `opensearch-snapshot-rebuild.json` | `test:opensearch-contracts` |
| Degradation visibility | 搜索降级可见性，operator 可感知降级状态 | `opensearch-degradation-visibility.txt` | `test:opensearch-failure-modes` |

专用命令门禁：

```bash
bun run test:opensearch-failure-modes
bun run test:opensearch-contracts
bun run test:opensearch-integration
```

#### 9.2.7 运行时兼容性证据包

| 场景 | 描述 | 产物示例 | 测试门禁 |
|------|------|----------|----------|
| Podman proof | Podman 容器运行时兼容性证明 | `podman-runtime-proof.txt` | `test:real-env` |
| Docker compatibility | Docker Compose 兼容性验证 | `docker-compose-compatibility.txt` | `test:integration` |
| Rootless execution | Podman rootless 运行验证 | `rootless-execution-proof.txt` | `test:real-env` |

专用命令门禁：

```bash
bun run test:real-env
bun run test:integration
docker compose config
docker compose --profile opensearch config
```

### 9.3 证据包守卫规则（Evidence Pack Guard Rules）

以下守卫规则通过 `tests/guards/evidence-paths.test.ts` 强制执行：

| 规则 | 检查范围 | 要求 |
|------|----------|------|
| 无内部编排路径引用 | `docs/`、`tests/`、`services/`、`packages/`、`apps/`（排除内部编排目录和 `.gitignore`） | 任何文件中不得出现内部编排路径字符串。内部编排目录路径格式参见 `AGENTS.md` 约束条款 |
| 无任务编号前缀证据名 | `docs/`、`tests/` | 证据文件引用不得使用 `evidence/<tN->`、`evidence/<task-N->` 等任务编号前缀 |
| 测试代码路径派生 | 测试代码 | 证据路径必须从 `import.meta.dir` 或 `mkdtemp` 派生，不得硬编码绝对路径 |

守卫命令：

```bash
bun test tests/guards/evidence-paths.test.ts
```

此守卫是独立门禁，不并入 `test:agent-submit`。生产轨道实现任务（T7-T30）必须在提交前确保此守卫通过。
