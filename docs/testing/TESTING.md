# Testing Strategy

> Meristem uses tests as contract enforcement, not just regression detection.

---

## 1. Required Test Types

| Test Type | Purpose | Applies To |
|-----------|---------|------------|
| typecheck | TypeScript strict and no `any` | all packages |
| unit | pure logic and schema narrowing | contracts, policy, config, codec |
| contract | API, Eden, event, service definition compatibility | contracts and services |
| integration | Core with service, NATS, PostgreSQL boundaries | Core and M-* services |
| failure-mode | degraded behavior and fail-closed behavior | policy, audit, event, storage |
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
bun run test:e2e
```

No core capability is complete until these pass or an explicit documented exception exists.

Additional hard gates:

- repository code must remain Bun-only
- repository code must not import `node:*`
- source comments must satisfy `MERISTEM-DEV.md §8.2` and `meristem_v_next_developer_document_v_0_1.md §26.2`

---

## 4. Contract Tests

Must cover:

- `MEventEnvelope` required fields
- event payload schema validation
- service definition required fields
- REST/OpenAPI route versioning
- Eden contract sample compatibility
- internal loopback HTTP + Eden compatibility for `M-Policy`, `M-Log`, and `M-EventBus`
- config schema versioning
- M-Policy decision result shape
- Audit Log required fields

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

---

## 5. Failure-Mode Tests

Must cover:

- M-Policy unavailable means protected operation fails closed.
- Audit Log unavailable blocks high-risk operation.
- OpenSearch unavailable does not block authoritative writes.
- NATS unavailable degrades event-dependent capabilities.
- Leaf Node abnormal state shrinks or revokes permissions.
- LLM unavailable does not block normal operation and cannot authorize high-risk operation.

MVP failure-mode tests:

- PostgreSQL unavailable makes readiness fail.
- NATS unavailable makes event-dependent operations fail or explicitly degrade.
- Audit Log write failure blocks node registration and task assignment.
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
- agent task assignment without an active token returns `409`.

---

## 6. UI Contract Tests

Must cover:

- no raw color literals in M-UI component styles
- no forbidden component types from `MERISTEM-DESIGN.md §6.2`
- high-risk action appears only in CommandWell
- critical state is not color-only
- Audit / Policy / Log / Node state components display traceable source

UI contract tests are not MVP blockers because M-UI is out of scope for MVP, but the schema remains the future UI boundary.

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
MERISTEM_TOKEN=<operator-token> bun run meristem task assign --leaf <leaf-node-id> --type noop
MERISTEM_TOKEN=<operator-token> bun run meristem log timeline
MERISTEM_TOKEN=<security-admin-token> bun run meristem audit list
```
