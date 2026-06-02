# Testing Strategy

> Meristem uses tests as contract enforcement, not just regression detection.

---

## 1. Required Test Types

| Test Type | Purpose | Applies To |
|-----------|---------|------------|
| typecheck | TypeScript strict and no `any` | all packages |
| unit | pure logic, Effect Schema decode/encode, and schema narrowing | contracts, policy, config, codec |
| contract | API, Eden, event, service definition compatibility | contracts and services |
| integration | Core with service, NATS, PostgreSQL boundaries | Core and M-* services |
| failure-mode | degraded behavior and fail-closed behavior | policy, audit, event, storage |
| e2e | full-stack end-to-end: Core REST, BFF, CLI, auth, RBAC | all new capabilities |
| migration | old and new contract versions | versioned contracts |
| UI contract | SDUI schema and forbidden component rules | M-UI |

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

Target commands once scripts exist:

```bash
bun run lint
bun run typecheck
bun run test
bun run test:contracts
bun run test:cli
bun run test:failure-modes
bun run test:integration
# Phase 10 OpenSearch tests
bun run test:opensearch-failure-modes
bun run test:opensearch-contracts
bun run test:opensearch-integration
bun run test:e2e
bun run workspace-hygiene
bun run skill-hygiene
bun run nodejs-ban
```

Phase 16 optional deployment pack static checks:

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

- repository code must remain Bun-only
- repository code must not import `node:*`
- workspace hygiene must reject generated output, dependency installs, local agent mirrors, local Codex runtime output, local Antigravity CLI output, and ignored `doc-driven-ai/` checkouts on review surfaces
- project skill hygiene must pass without Python or Node.js tooling
- source comments must satisfy `MERISTEM-DEV.md §8.2`
- complex internal workflows must have Effect success and failure-path tests at the workflow interface, not only route-level tests

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

When removing or replacing old e2e tests, update this section to describe the new canonical suite.

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
- node registration default mode and node credential issuance match the Phase 8 contract.
- heartbeat transition and timeout helpers match the documented `joining -> healthy/degraded -> offline` rules.
- join ingress runtime tests prove ticket redemption is single-use and resumed sessions supersede stale sockets.
- Phase 9 UI contract tests prove M-UI BFF route schema, disabled command explanations, BFF OpenAPI output, Core error envelope mapping, and no direct M-UI -> Core dependency.
- Phase 15 M-Extension contract tests prove manifest schema decode / encode, manifest versioning, supported declaration kinds, event subjects, REST route schemas, and CLI command outputs match the docs.
- Phase 17 Identity v0.2 contract tests prove token issue / revoke / introspection schemas, `jti` revocation, and M-* service auth verification contracts match the docs.
- Phase 18 SecretRef contract tests prove secretRef metadata, versioning, rotation, and redaction contracts match the docs.
- Phase 19 Config Lifecycle contract tests prove config schema validation, deterministic hash, version, publish, apply-ack, rollback, and event subjects match the docs.
- Phase 13 M-Net profile contract tests prove profile Effect Schema decode / encode, external REST route schemas and OpenAPI output, CLI network profile command contract, and profile event subject and payload schemas match the docs.

---

## 5. Failure-Mode Tests

Must cover:

- M-Policy unavailable means protected operation fails closed.
- Audit Log unavailable blocks high-risk operation.
- OpenSearch unavailable does not block authoritative writes.
- Phase 10 search tests: `test:opensearch-failure-modes` must pass first (no OpenSearch required). `test:opensearch-contracts` validates query contracts. `test:opensearch-integration` skips gracefully when OpenSearch is not running.
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
- reload failure writes Full Log and publishes `service.lifecycle.reload.failed.v0`.
- agent task submitment without an active token returns `409`.
- M-Extension registration rejects unknown requested permissions.
- M-Extension registration rejects high and critical risk manifests.
- M-Extension register / enable / disable fail closed when M-Policy is unavailable or denies the actor.
- M-Extension register / enable / disable fail closed when required Audit cannot be written.
- M-Extension does not execute Wasm, webhook, HTTP callback, script, or cloud-function behavior in Phase 15.
- revoked actor token is denied and cannot authorize protected routes.
- Core token introspection unavailable fails protected external M-* routes closed.
- token plaintext never appears in Timeline, Full, Audit, OpenSearch projection payloads, or CLI stderr/stdout except the one-time issue response.
- secret plaintext never appears in Timeline, Full, Audit, OpenSearch projection payloads, events, or error envelopes.
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

---

## 6. UI Contract Tests

Must cover:

- no raw color literals in M-UI component styles
- no forbidden component types from `MERISTEM-DESIGN.md §6.2`
- high-risk action appears only in CommandWell
- critical state is not color-only
- Audit / Policy / Log / Node state components display traceable source

UI contract tests are not MVP blockers because M-UI is out of scope for MVP, but the schema remains the future UI boundary.

Phase 9 BFF contract additions:
- M-UI BFF must expose minimal OpenAPI for UI-facing endpoints.
- M-UI must call M-UI BFF only, not Core REST directly.
- BFF must not cache Core data or permission context across requests.

---

## 6.1 Phase 17 Identity v0.2 Test Coverage

Identity v0.2 requires the following test coverage:

**Contract Tests** (`tests/contracts/identity-v02.test.ts`):

- IdentityActorV02 schema decode/encode.
- ActorTokenV02 schema decode/encode, including revocation fields.
- IssueTokenRequest, RevokeTokenRequest, and InternalIntrospectionRequest schema decode/encode.
- IntrospectTokenResponse `active: false` for revoked, expired, and unknown jti.
- Identity REST route schemas match `docs/contracts/REST-API-MVP.md`.
- Identity CLI command outputs match `docs/contracts/CLI-COMMANDS.md`.

**Failure-Mode Tests** (`tests/failure-modes/identity-revocation.test.ts`):

- revoked actor token is denied and returns 403.
- Core token introspection unavailable fails protected external M-* routes closed with 503.
- token issue fails closed when Audit Log is unavailable.
- token revoke fails closed when Audit Log is unavailable.
- expired tokens are treated as revoked for authorization.
- missing `jti` in JWT is rejected during verification.
- operator and admin cannot issue actor tokens (403).
- operator cannot inspect tokens (403).
- token plaintext never appears in Timeline, Full, Audit, OpenSearch payloads, or CLI stderr/stdout except the one-time issue response.

**CLI Tests** (`tests/cli/cli-identity.test.ts`):

- `meristem identity actor list` returns actors.
- `meristem identity actor show <id>` returns one actor or non-zero exit.
- `meristem identity token issue` returns plaintext token with metadata.
- `meristem identity token inspect <jti>` returns metadata without plaintext.
- `meristem identity token revoke <jti>` returns confirmed revocation.
- missing permission returns non-zero exit.

**Integration Tests** (`tests/integration/identity-introspection.test.ts`):

- M-* service calls Core introspection, receives correct `active` status.
- introspection endpoint returns 401 for missing `x-meristem-internal-token`.

**E2E Tests**:

- full identity lifecycle: list actors → issue token → inspect token → revoke token → inspect revoked token.
- auth failure-mode: viewer cannot call any identity route.
- revoked token denied on protected route.

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
# Phase 10 OpenSearch tests
bun run test:opensearch-failure-modes
bun run test:opensearch-contracts
bun run test:opensearch-integration
bun run test:e2e
bun run nodejs-ban
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
