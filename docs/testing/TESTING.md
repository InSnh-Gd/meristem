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

Optional deployment pack static checks:

```bash
docker compose config
docker compose --profile opensearch config
docker compose --profile redis config
docker compose --profile apisix config
rg -n "/internal/v0|/api/v0/\*" ops/apisix/apisix.yaml
```

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
- OpenSearch search tests: `test:opensearch-failure-modes` must pass first (no OpenSearch required). `test:opensearch-contracts` validates query contracts. `test:opensearch-integration` skips gracefully when OpenSearch is not running.
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

When claiming that M-Net virtual networking is **really usable** (not only control-plane healthy), pair the automated gates above with the operator runbook proof in `docs/operations/M-NET-THREE-NODE-VALIDATION.md`, including at least one successful in-tunnel flow over the published `100.96.x.x` addresses on the live harness.

Required evidence capture for data-plane security hardening:

```bash
bun test tests/failure-modes/mnet-dataplane-redaction-scan.test.ts
bun test tests/failure-modes/mnet-dataplane-security-hardening.test.ts --test-name-pattern "expired and revoked join tickets"
```

The commands above are mandatory because the private-material scanner and expired-ticket rejection path require durable proof.

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
