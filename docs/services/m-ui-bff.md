# M-UI BFF Service Definition

## 1. Identity

| Field | Value |
|-------|-------|
| name | m-ui-bff |
| version | 0.1.0 |
| domain | m-ui |
| kind | bff |
| owner | meristem-core |

## 2. Responsibility

What this service owns:

- Aggregating Core REST v0 operational data into a single control-room overview response
- Deriving disabled/enabled command state for the M-UI CommandWell from Core-visible permission and node state
- Forwarding confirmed noop task execution to M-Task `POST /api/v0/tasks`
- Returning a trimmed Minimal Policy Decision Summary from Core policy decision records
- Exposing its own minimal OpenAPI document for the M-UI frontend

What this service must not own:

- Authorization decisions — only derives display state from Core data
- Audit facts — never calls M-Log Audit endpoints
- Policy facts — never calls M-Policy directly and never expands beyond Core-provided decision data
- Direct calls to M-Policy, M-Log, or M-Net internal HTTP
- Token issuance, storage, or caching
- Cross-request caching of any Core data
- Final command authorization — Core and M-Policy remain the sources of truth

## 3. Contracts

| Contract | Path / Subject | Version | Notes |
|----------|----------------|---------|-------|
| REST | Port 3200, public | v0 | See routes below |
| Eden | N/A | — | BFF is a public HTTP service, not an internal Eden consumer |
| Events | N/A | — | No event publishing |

### Routes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | public | BFF liveness check |
| GET | `/ready` | public | Probes Core `/api/v0/health` |
| GET | `/api/v0/overview` | Bearer | Aggregates session, status, nodes, services, timeline |
| GET | `/api/v0/nodes/:id` | Bearer | Pass-through to Core node detail |
| POST | `/api/v0/commands/noop` | Bearer | Derives disabled/enabled state, does NOT execute |
| POST | `/api/v0/commands/noop/execute` | Bearer | Forwards confirmed noop to M-Task `POST /api/v0/tasks` |
| GET | `/api/v0/policy/decisions/:id/summary` | Bearer | Trims Core policy decision data for Phase 9 UI display |

`GET /api/v0/policy/decisions/:id/summary` calls Core `GET /api/v0/policy/decisions/:id` with the caller's Bearer token and returns only:

```ts
type PolicyDecisionSummaryResponse = {
  decision: {
    id: string;
    actor: string;
    action: string;
    resource: string;
    result: string;
    createdAt: string;
  };
};
```

It must not return `reasons`, `confidence`, `suspicion`, role inheritance, RBAC table structure, policy evaluation traces, or other policy internals.

## 4. Permissions

| Permission | Required For | Risk |
|------------|--------------|------|
| `task:submit` | noop execution | medium |
| `core:read` | policy decision summary pass-through | low |

The BFF does not enforce permissions. It derives disabled command state from the session endpoint's returned permissions list. All actual authorization happens in Core via M-Policy.

## 5. Dependencies

| Dependency | Type | Failure Behavior |
|------------|------|------------------|
| meristem-core | service | BFF returns 502 with Core error envelope; all overview data limited to what Core returns |

## 6. Configuration

| Key | Type | Required | Hot Reload | Notes |
|-----|------|----------|------------|-------|
| `MERISTEM_BFF_PORT` | number | no | no | Default 3200 |
| `MERISTEM_CORE_URL` | string | no | no | Default `http://localhost:3000` |

## 7. Health

| Check | Meaning | Failure Behavior |
|-------|---------|------------------|
| liveness | BFF process is running | `GET /health` returns 200 |
| readiness | Core is reachable | `GET /ready` returns `{ ready: false }` if Core unreachable |

## 8. Lifecycle

| Capability | Supported | Notes |
|------------|-----------|-------|
| reloadable | no | Phase 9 functional demo |
| rollbackable | no | |
| degradable | yes | Returns ready=false when Core is down |

## 9. Logs

| Log | When Written | Required Fields |
|-----|--------------|-----------------|
| Timeline | Not written by BFF | — |
| Full | Not written by BFF | — |
| Audit | Not written by BFF | BFF does not create audit facts |

The BFF relies on Core, M-Log, and M-Policy for all operational logging and auditing. It does not write logs directly.

## 10. Policy Requirements

- The BFF must not make authorization decisions.
- The BFF must forward the caller's Bearer token to Core without inspection or modification.
- The BFF must not expose Core REST paths directly to `apps/m-ui`.
- Disabled command reasons must be visible but must not create Audit facts.
- Core error envelopes must be preserved when forwarded to the UI.
- Minimal Policy Decision Summary must be trimmed from Core policy decision data and must not expose policy internals.

## 11. Done Criteria

- Service definition is versioned.
- All 7 routes implemented and documented.
- OpenAPI document generated at `/openapi`.
- BFF does not call M-Log, M-Policy, or M-Net internal HTTP.
- BFF does not construct Audit facts.
- BFF does not expose full policy decision internals through its UI-facing summary endpoint.
- Core, M-Policy, and M-Log remain the sources of operational facts.
