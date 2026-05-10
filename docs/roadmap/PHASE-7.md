# Phase 7 - Service Lifecycle and Reload Prototype

> Goal: add a minimal, auditable service lifecycle control plane without implementing the full config publish/apply/ack workflow.

---

## 1. Scope

Phase 7 includes:

- service runtime summaries aggregated by Core.
- one public service list endpoint.
- one public service reload endpoint.
- CLI service list and reload commands.
- loopback HTTP + Eden lifecycle control for reloadable services.
- `m-log` as the only reloadable example service.
- Timeline, Full Log, Audit, and event behavior for reload attempts.

Phase 7 excludes:

- config version publish/apply/ack orchestration.
- persistent runtime state tables.
- rollback implementation.
- multi-step rollout or staged reload across services.
- making `m-policy`, `m-eventbus`, or `m-net` reloadable.

---

## 2. Required API

- `GET /api/v0/services`
- `POST /api/v0/services/:id/reload`
- `POST /internal/v0/lifecycle/reload` on reloadable internal services

---

## 3. Required CLI

```bash
meristem service list
meristem service reload --service <service-id> [--reason <text>]
```

---

## 4. Required Events

- `service.lifecycle.registered.v0`
- `service.lifecycle.reload.requested.v0`
- `service.lifecycle.reload.failed.v0`

---

## 5. Rules

- `GET /api/v0/services` returns built-in service summaries plus registered service definitions.
- built-in service runtime is probed live through Core readiness and internal service `/health` + `/ready`.
- `m-log` is the only reloadable service in this prototype.
- reload triggers a direct synchronous internal HTTP + Eden call from Core to the target service.
- reload does not create a config version and does not replace the config lifecycle state machine.
- non-reloadable services return `409 service.not_reloadable`.
- unknown services return `404 service.not_found`.

---

## 6. Completion Criteria

- operators can list built-in services and see runtime state.
- operators can reload `m-log`.
- viewers cannot reload services.
- reload attempts write Audit and Timeline entries.
- reload failures write Full Log and publish `service.lifecycle.reload.failed.v0`.
- Core remains the only public lifecycle entrypoint.

---

## 7. Verification Checklist

```bash
MERISTEM_TOKEN=<operator-token> bun run meristem service list
MERISTEM_TOKEN=<operator-token> bun run meristem service reload --service m-log --reason smoke-test
MERISTEM_TOKEN=<viewer-token> bun run meristem service reload --service m-log
MERISTEM_TOKEN=<operator-token> bun run meristem log timeline
MERISTEM_TOKEN=<security-admin-token> bun run meristem audit list
```

Manual checks:

- verify `m-log` appears as `reloadable: true`
- verify non-reloadable built-ins return `409`
- observe `service.lifecycle.reload.requested.v0`
- observe `service.lifecycle.reload.failed.v0` on forced failure
