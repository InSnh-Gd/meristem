# Phase 16 - Optional Deployment Pack

> Goal: make optional deployment components runnable and documented without turning APISIX, Redis, OpenSearch, or full-stack compose into default dependencies or a production deployment platform.

---

## 1. Scope

Phase 16 standardizes a small optional deployment pack:

```text
default dependency compose remains PostgreSQL + NATS
OpenSearch optional profile is documented and kept read-model-only
Redis optional profile is added as a future cache backend candidate
APISIX optional profile is added as an edge gateway example
APISIX route config uses explicit external-route allowlist only
full-stack example compose documents local topology without replacing Bun dev flow
runbook documents startup commands, exposed ports, and failure behavior
```

Phase 16 is not a production deployment platform. It does not add heavy orchestrator targets, service mesh, production TLS, production secret orchestration, multi-Core HA, autoscaling, or image publishing.

---

## 2. Accepted Decisions

- Phase 16 is an optional deployment pack, not a production deployment platform.
- APISIX is an optional edge gateway example only.
- APISIX must not become an auth root, policy root, service mesh, or default entrypoint.
- APISIX routes must use explicit allowlists. Catch-all forwarding such as `/api/v0/*` is prohibited.
- Redis is the only optional Redis-protocol compose profile shipped in Phase 16.
- KeyDB remains a compatible candidate in documentation but does not get a separate Phase 16 profile.
- Redis / KeyDB do not get a runtime adapter in Phase 16.
- OpenSearch remains optional and read-model-only.
- Full-stack compose is an example topology, not the default local development or CI path.

---

## 3. Out Of Scope

Phase 16 excludes:

- production-ready deployment claims.
- heavy orchestrator manifests or charts.
- service mesh.
- multi-Core HA.
- image publishing or registry workflow.
- production TLS and certificate lifecycle.
- production secret orchestration.
- APISIX authentication plugins as Meristem authorization roots.
- Redis runtime adapter integration.
- Redis cluster, Redis ACL, Redis TLS, or persistence tuning.
- OpenSearch cluster deployment or security plugin hardening.
- exposing internal loopback APIs through APISIX.

---

## 4. Target Files

Phase 16 touches:

```text
docker-compose.yml
ops/apisix/config.yaml
ops/apisix/apisix.yaml
ops/compose/full-stack.example.yml
docs/operations/OPTIONAL-DEPLOYMENT-PACK.md
docs/operations/RUNBOOK.md
docs/data/STATE-MODEL.md
docs/testing/TESTING.md
docs/roadmap/DEFERRED-WORK.md
```

---

## 5. Compose Profiles

Default dependency compose remains:

```bash
docker compose up -d postgres nats
```

Optional profiles:

```bash
docker compose --profile opensearch up -d opensearch
docker compose --profile redis up -d redis
docker compose --profile apisix up -d apisix
```

Rules:

- default compose must not start APISIX, Redis, or OpenSearch.
- profile services must have health checks.
- profile services must document port exposure.
- profile services must not become required for `bun run dev:all`, `bun run test`, or MVP smoke commands.

---

## 6. APISIX Rules

APISIX is an optional edge gateway example for local topology validation.

Allowed APISIX behavior:

- route declared external REST paths to the owning service.
- route `/join/v0/*` to M-Net join ingress.
- provide request id / correlation-friendly edge headers.
- show rate-limit examples on selected external routes.

APISIX must not:

- route `/internal/v0/*`.
- expose loopback internal service APIs.
- expose PostgreSQL, NATS, OpenSearch, or Redis.
- own authentication decisions.
- own policy decisions.
- write Audit facts.
- act as service discovery.
- use broad catch-all routes for Meristem APIs.

Every APISIX route must be backed by a declared external REST contract or an accepted phase document.

---

## 7. Redis Rules

Redis profile purpose:

- provide a runnable Redis-protocol dependency candidate for future cache adapter work.
- document where Redis / KeyDB would be allowed only when NATS KV is insufficient.

Phase 16 Redis profile does not imply:

- Redis is default cache.
- runtime services use Redis.
- sessions, locks, rate limits, queues, or task coordination moved to Redis.
- KeyDB is shipped as a separate profile.

Future Redis / KeyDB adapter work must update state, config, service, security, and failure-mode tests before implementation.

---

## 8. OpenSearch Rules

OpenSearch remains the Phase 10 optional read-model dependency.

Rules:

- PostgreSQL and M-Log facts remain authoritative.
- OpenSearch profile is not started by default.
- OpenSearch unavailability must not block authoritative writes.
- OpenSearch query and projection degradation must remain visible.
- OpenSearch projection shape must never become a source of truth.

---

## 9. Full-Stack Example Compose

`ops/compose/full-stack.example.yml` documents a local topology example.

Rules:

- it is not the default dev flow.
- it is not a CI hard gate.
- it must preserve the current loopback-oriented service assumptions or clearly document where the current implementation is not yet container-split ready.
- it must not claim production readiness.

Default local service execution remains:

```bash
docker compose up -d postgres nats
bun run dev:all
```

---

## 10. Required Verification

Phase 16 implementation verification:

```bash
docker compose config
docker compose --profile opensearch config
docker compose --profile redis config
docker compose --profile apisix config
rg -n "/internal/v0|/api/v0/\*" ops/apisix/apisix.yaml
```

Expected APISIX check result:

- `/internal/v0` appears only in comments explaining prohibited routes.
- `/api/v0/*` must not appear as an active route.

Optional runtime smoke when Docker is available:

```bash
docker compose --profile redis up -d redis
docker compose --profile apisix up -d apisix
```

Do not require APISIX, Redis, or OpenSearch for standard repository tests.

---

## 11. Completion Criteria

Phase 16 is complete when:

- default compose still starts only PostgreSQL and NATS unless profiles are requested.
- OpenSearch profile remains optional.
- Redis profile exists and is documented as optional.
- APISIX profile exists and uses explicit allowlist routes.
- APISIX config does not expose internal APIs or raw data services.
- full-stack example compose exists and is clearly non-default.
- runbook documents startup commands, ports, and failure behavior.
- deferred production deployment items are tracked in `docs/roadmap/DEFERRED-WORK.md`.
