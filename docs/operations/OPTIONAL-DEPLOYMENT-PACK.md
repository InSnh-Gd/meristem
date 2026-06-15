# Optional Deployment Pack

> Optional deployment pack provides optional local deployment components. These profiles are not default dependencies and do not make the repository production-ready.

---

## 1. Default Dependency Compose

Default local dependencies remain PostgreSQL and NATS:

```bash
docker compose up -d postgres nats
```

Default service execution remains Bun-first:

```bash
bun run dev:all
```

APISIX, Redis, and OpenSearch must be started explicitly through compose profiles.

---

## 2. Optional Profiles

| Profile | Service | Command | Default Dependency |
|---------|---------|---------|--------------------|
| `opensearch` | OpenSearch | `docker compose --profile opensearch up -d opensearch` | no |
| `redis` | Redis | `docker compose --profile redis up -d redis` | no |
| `apisix` | APISIX | `docker compose --profile apisix up -d apisix` | no |

Profiles can be combined when needed:

```bash
docker compose --profile opensearch --profile redis --profile apisix up -d
```

---

## 3. Ports and Exposure

Port assignments remain canonical in `RUNBOOK.md`.

Optional deployment-pack interpretation rules:

- APISIX must not expose PostgreSQL, NATS, OpenSearch, Redis, or internal `/internal/v0/*` service APIs.
- optional profiles do not change which Meristem surfaces are public versus loopback-only.
- any port change must update `RUNBOOK.md` first, then this file only if the optional-profile meaning changes.

---

## 4. APISIX Profile

APISIX is configured from:

```text
ops/apisix/config.yaml
ops/apisix/apisix.yaml
```

The route file is an explicit allowlist. It intentionally does not contain an active catch-all `/api/v0/*` route.

Allowed route groups:

- Core external routes such as health, ready, status, nodes, node tickets, and networks.
- M-Task external task routes.
- M-Policy external approval routes when approval flow is implemented.
- M-Net external network profile routes when M-Net profile lifecycle is implemented.
- M-Extension external extension routes when M-Extension control plane is implemented.
- M-Net public join ingress `/join/v0/*`.

Rules:

- target Meristem services still verify JWTs and call M-Policy.
- APISIX does not write Audit facts.
- APISIX does not authorize business actions.
- new external routes must update REST contract docs before being added to APISIX.

---

## 5. Redis Profile

Redis is provided as a future Redis-protocol cache candidate:

```bash
docker compose --profile redis up -d redis
```

Optional deployment pack does not connect runtime code to Redis.

Permitted future triggers for Redis / KeyDB adapter work remain:

- complex cache semantics.
- high-frequency rate limiting.
- complex distributed locks.
- sorted sets.
- special session or ephemeral state.
- external component requiring Redis protocol.

KeyDB remains a compatible candidate but does not ship as a separate optional deployment pack profile.

---

## 6. OpenSearch Profile

OpenSearch remains optional and read-model-only:

```bash
docker compose --profile opensearch up -d opensearch
```

Rules:

- PostgreSQL and M-Log remain authoritative.
- OpenSearch unavailability must not block authoritative writes.
- integration tests may skip when OpenSearch is not running.
- production OpenSearch security and cluster tuning are out of optional deployment pack scope.

---

## 7. Full-Stack Example Compose

`ops/compose/full-stack.example.yml` is a topology reference, not the default workflow.

Use it to inspect intended process grouping and environment wiring. Do not treat it as production deployment or a CI gate.

The current implementation still has loopback-oriented internal service assumptions. Any future split-container runtime must update internal service URL configuration before claiming full containerized deployment support.

---

## 8. Failure Behavior

| Component | Failure Behavior |
|-----------|------------------|
| APISIX unavailable | direct Bun dev routes remain available; optional gateway path is unavailable |
| Redis unavailable | no current runtime impact; future adapter work must define fallback or fail-closed behavior |
| OpenSearch unavailable | authoritative writes continue; search and projection routes degrade |
| PostgreSQL unavailable | authoritative state operations fail |
| NATS unavailable | event-dependent capabilities fail or explicitly degrade |

---

## 9. Verification

Run static compose checks:

```bash
docker compose config
docker compose --profile opensearch config
docker compose --profile redis config
docker compose --profile apisix config
```

Check APISIX route safety:

```bash
rg -n "/internal/v0|/api/v0/\*" ops/apisix/apisix.yaml
```

`/internal/v0` must appear only in prohibited-route comments. `/api/v0/*` must not appear as an active route.
