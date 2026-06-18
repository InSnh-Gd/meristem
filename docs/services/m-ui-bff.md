# M-UI BFF Service Definition

## 1. Identity

| Field | Value |
|-------|-------|
| name | m-ui-bff |
| version | 0.2.0 |
| domain | m-ui |
| kind | bff |
| owner | meristem-core |

## 2. Responsibility

What this service owns:

- Aggregating Core REST v0 operational data into a single control-room overview response
- Deriving disabled/enabled command state for the M-UI CommandWell from Core-visible permission and node state
- Forwarding confirmed noop task execution to M-Task `POST /api/v0/tasks`
- **Forwarding approval/profile mutation execute commands to Core public facades** (`POST /api/v0/policy/approvals/:id/approve|reject`, `POST /api/v0/networks/:id/profile`)
- **Serving network list via `GET /api/v0/networks` as proxy to Core public facade**
- **Forwarding global M-Net profile default, migration, disable-policy, and break-glass controls to Core public facades**
- Returning a trimmed Minimal Policy Decision Summary from Core policy decision records
- Publishing the current SDUI v0.2 route registry for the transitional M-UI workbench surface
- Returning display-shaped node, timeline, audit, policy decision, and service lists with state-source annotations
- Exposing generic CommandWell endpoints for BFF-known command IDs only
- Exposing its own minimal OpenAPI document for the M-UI frontend

The BFF is a UI-facing adaptation layer. It may aggregate, trim, order, annotate `stateSource`, and derive display-oriented command eligibility, but M-UI owns route surfaces, Svelte components, and interaction structure. M-* services own facts and capabilities; services, M-Extension, and plugins do not supply M-UI pages or components through the BFF.

What this service must not own:

- Authorization decisions — only derives display state from Core data
- Audit facts — never calls M-Log Audit endpoints
- Policy facts — never calls M-Policy directly and never expands beyond Core-provided decision data
- UI route surfaces, Svelte components, layout decisions, or runtime page composition
- Service- or plugin-provided frontend modules
- Direct calls to M-Policy, M-Log, or M-Net internal HTTP
- Calls to `/internal/v0/*` routes on M-Policy, M-Net, or any other internal service
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
| GET | `/api/v0/routes` | Bearer | Returns the SDUI v0.2 route registry |
| GET | `/api/v0/routes/:id` | Bearer | Returns one registered SDUI route or 404 |
| GET | `/api/v0/nodes` | Bearer | Pass-through display list from Core node records |
| GET | `/api/v0/nodes/:id` | Bearer | Display-shaped node detail with state source annotation |
| GET | `/api/v0/timeline` | Bearer | Pass-through display list from Core Timeline Log |
| GET | `/api/v0/audit` | Bearer | Pass-through display list from Core Audit Log; Core enforces `audit:read` |
| GET | `/api/v0/policy/decisions` | Bearer | Display-shaped policy decision list via Core boundary |
| GET | `/api/v0/policy/decisions/:id` | Bearer | Full policy decision with state source annotation |
| GET | `/api/v0/services` | Bearer | Display-shaped service lifecycle summary list via Core boundary |
| POST | `/api/v0/commands/noop` | Bearer | Derives disabled/enabled state, does NOT execute |
| POST | `/api/v0/commands/noop/execute` | Bearer | Forwards confirmed noop to M-Task `POST /api/v0/tasks` |
| POST | `/api/v0/commands/:commandId/eligibility` | Bearer | Generic CommandWell eligibility for BFF-known commands |
| POST | `/api/v0/commands/:commandId/execute` | Bearer | Generic CommandWell execution for BFF-known commands |
| GET | `/api/v0/policy/decisions/:id/summary` | Bearer | Trims Core policy decision data for M-UI display |
| GET | `/api/v0/policy/approvals` | Bearer | Approval queue list via Core boundary; read-only, returns display-shaped approval records with state source annotation |
| GET | `/api/v0/policy/approvals/:id` | Bearer | Approval detail via Core boundary; read-only, returns full approval record with policy, audit, and log state sources |
| GET | `/api/v0/network-profiles` | Bearer | Network profile list via Core boundary; read-only, returns display-shaped profile records with authoritative, policy, and audit state sources |
| GET | `/api/v0/network-profiles/:id` | Bearer | Network profile detail via Core boundary; read-only, returns full profile record with authoritative, policy, audit, and log state sources |
| GET | `/api/v0/networks` | Bearer | Network list via Core boundary; read-only target list for explicit M-UI profile command selection |
| GET | `/api/v0/networks/profile-defaults` | Bearer | Global profile defaults via Core boundary; control-plane state only |
| GET | `/api/v0/networks/profile-switches/:operationId` | Bearer | Global profile migration status via Core boundary; control-plane state only |

**Display-only command handling**:

The existing `POST /api/v0/commands/:commandId/eligibility` and `POST /api/v0/commands/:commandId/execute` routes handle display-only commands as follows:

- `policy.approval.approve.preview`, `policy.approval.reject.preview`, `network.profile.enable.preview`, `network.profile.disable.preview` are display-only commands.
- Eligibility returns display state (enabled/disabled with Chinese reason) but never forwards to any backend approval or profile service.
- Execute returns `400 command.display_only` for any display-only command ID. BFF must not forward display-only execute requests to M-Policy, M-Net, or any other backend service.

**Execute body validation and response rules**:

- `POST /api/v0/commands/:commandId/execute` must validate request bodies per command ID before forwarding to Core.
- Wrong-shaped bodies fail closed with `400 command.invalid_body`; BFF must not forward partially parsed or `undefined` fields upstream.
- Approval execute commands pass through Core public facade responses unchanged, including non-2xx Core error envelopes and status codes.
- Profile execute commands pass through Core public facade responses unchanged; the UI must not assume a shared task-envelope success shape.
- Global profile default / switch / disable-policy / break-glass commands are forwarded only through Core public facades and remain control-plane-only.

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
| reloadable | no | transitional workbench BFF |
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
- The BFF must not call `/internal/v0/*` routes on M-Policy, M-Net, or any other internal service. All approval and profile data flows through Core boundary routes only.
- Disabled command reasons must be visible but must not create Audit facts.
- Core error envelopes must be preserved when forwarded to the UI.
- Minimal Policy Decision Summary must be trimmed from Core policy decision data and must not expose policy internals.
- Generic command routes must validate `commandId` against BFF-known contracts and must not expose arbitrary backend forwarding.
- Display list responses may annotate state sources, but must not cache or mutate the underlying facts.

## 11. Done Criteria

- Service definition is versioned.
- Current SDUI v0.2 route registry and supporting BFF endpoints are documented for the transitional M-UI workbench surface.
- OpenAPI document generated at `/openapi`.
- BFF does not call M-Log, M-Policy, or M-Net internal HTTP.
- BFF does not construct Audit facts.
- BFF does not expose full policy decision internals through its UI-facing summary endpoint.
- Core, M-Policy, and M-Log remain the sources of operational facts.
