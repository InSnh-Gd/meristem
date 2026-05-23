# REST API MVP Contract

> REST API v0 is the external MVP API. It is implemented by Core through Elysia and must be represented in OpenAPI.

---

## 1. Common Rules

- Base path: `/api/v0`.
- Request and response bodies are JSON.
- Every mutating request accepts or creates a `correlationId`.
- Error responses use the same envelope shape.
- Protected endpoints require M-Policy.

```ts
type ApiError = {
  error: {
    code: string;
    message: string;
    correlationId?: string;
  };
};
```

---

## 2. Health and Status

### `GET /api/v0/health`

Returns process liveness.

```ts
type HealthResponse = {
  ok: true;
  service: "meristem-core";
  version: string;
  uptimeMs: number;
};
```

### `GET /api/v0/ready`

Returns dependency readiness.

```ts
type ReadyResponse = {
  ready: boolean;
  dependencies: {
    postgres: "ready" | "unavailable";
    nats: "ready" | "unavailable";
    "m-policy": "ready" | "unavailable";
    "m-log": "ready" | "unavailable";
    "m-eventbus": "ready" | "unavailable";
    "m-net": "ready" | "unavailable";
  };
};
```

### `GET /api/v0/status`

Protected by `core:read`.

```ts
type StatusResponse = {
  core: {
    id: string;
    version: string;
    mode: "normal" | "degraded" | "safe";
  };
  dependencies: ReadyResponse["dependencies"];
  counts: {
    services: number;
    nodes: number;
    tasks: number;
  };
};
```

---

## 3. Service Definitions

### `POST /api/v0/services`

Protected by `service:register`.

Registers a service definition that conforms to `docs/services/SERVICE-DEFINITION-TEMPLATE.md`.

### `GET /api/v0/services`

Protected by `core:read`.

Returns service summaries. Built-in services include live runtime data; registered service definitions may appear without runtime details.

Service reload is defined in `docs/contracts/SERVICE-LIFECYCLE-PROTOTYPE.md`.

---

## 4. Nodes

### `POST /api/v0/node-tickets`

Protected by `node:register`.

```ts
type CreateNodeTicketRequest = {
  kind: "stem" | "leaf";
  name: string;
  capabilities?: string[];
  expiresInSeconds?: number;
};

type CreateNodeTicketResponse = {
  ticketId: string;
  ticket: string;
  expiresAt: string;
  joinUrl: string;
  policyDecisionId: string;
  correlationId: string;
};
```

Rules:

- Join Ticket is the public agent join entrypoint for MVP.
- `joinUrl` points to `wss://<host>:8443/join/v0/session`.
- ticket plaintext is returned once and must not be logged.
- successful ticket creation publishes `node.registration.requested.v0` and `node.join-ticket.created.v0`.

### `POST /api/v0/nodes`

Protected by `node:register`.

```ts
type RegisterNodeRequest = {
  kind: "stem" | "leaf";
  name: string;
  mode?: "simulated";
  capabilities?: string[];
};

type RegisterNodeResponse = {
  node: {
    id: string;
    kind: "stem" | "leaf";
    name: string;
    mode: "agent" | "simulated";
    status: "joining" | "healthy" | "degraded" | "offline" | "revoked";
    reachability: "unknown" | "reachable" | "unreachable";
    lastSeenAt?: string;
    agentVersion?: string;
    capabilities: string[];
    createdAt: string;
  };
  policyDecisionId: string;
  correlationId: string;
};
```

Rules:

- Leaf nodes default to low permission, restricted API, and restricted interconnect metadata.
- default mode is `simulated`.
- `agent` mode is rejected with `409 node.agent_join_ticket_required`; use `POST /api/v0/node-tickets` instead.
- `simulated` mode preserves the legacy synchronous MVP path.
- Core node registration is not exposed through this MVP endpoint.
- successful registration publishes `node.registration.requested.v0` and `node.registration.accepted.v0`.

### `POST /api/v0/nodes/:id/credentials`

Protected by `node:issue-token`.

```ts
type IssueNodeCredentialResponse = {
  nodeId: string;
  token: string;
  issuedAt: string;
  policyDecisionId: string;
  correlationId: string;
};
```

Rules:

- token plaintext is returned once.
- Core stores only the token hash.
- re-issuing revokes the previous active token for the same node.
- this route remains an internal compatibility path for tests or operators; it is no longer the primary public agent join flow.

### `GET /api/v0/nodes`

Protected by `core:read`.

Returns all MVP node records.

### `GET /api/v0/nodes/:id`

Protected by `core:read`.

Returns one node or `404`.

---

## 5. Networks

### `POST /api/v0/networks`

Protected by `network:create`.

```ts
type CreateNetworkRequest = {
  name: string;
  profileVersion?: string;
};

type CreateNetworkResponse = {
  network: {
    id: string;
    name: string;
    profileVersion: string;
    status: "active";
    createdAt: string;
  };
  policyDecisionId: string;
  correlationId: string;
};
```

Rules:

- `profileVersion` defaults to `m-net-default@0.1.0`.
- network name must be unique.
- successful creation publishes `mnet.network.created.v0`.

### `GET /api/v0/networks`

Protected by `network:read`.

Returns logical networks with `memberCount`.

### `POST /api/v0/networks/:id/members`

Protected by `network:join`.

```ts
type JoinNetworkRequest = {
  nodeId: string;
};

type JoinNetworkResponse = {
  member: {
    networkId: string;
    nodeId: string;
    nodeKind: "stem" | "leaf";
    membershipMode: "full" | "restricted";
    status: "joined";
    joinedAt: string;
  };
  policyDecisionId: string;
  correlationId: string;
};
```

Rules:

- target network must exist.
- target node must exist and be `healthy`.
- `stem` joins as `full`.
- `leaf` joins as `restricted`.
- `leaf` requires at least one existing `stem` member in the network.
- repeated join for the same `networkId` + `nodeId` is idempotent.
- successful join publishes `mnet.membership.joined.v0`.

### `GET /api/v0/networks/:id/members`

Protected by `network:read`.

Returns logical network members or `404` if the network does not exist.

---

## 6. Tasks

### `POST /api/v0/tasks`

Protected by `task:assign`.

```ts
type AssignTaskRequest = {
  leafNodeId: string;
  type: "noop";
};

type AssignTaskResponse = {
  task: {
    id: string;
    leafNodeId: string;
    type: "noop";
    status: "completed";
    createdAt: string;
    completedAt: string;
  };
  policyDecisionId: string;
  correlationId: string;
};
```

Rules:

- MVP supports only `noop`.
- Target must be an existing Leaf node.
- `simulated` nodes complete synchronously in Core.
- `agent` nodes require `reachable` state, `healthy` or `degraded` status, and one active node credential.
- `agent` completion goes Core -> M-Net internal HTTP -> active join session `task.execute`.
- Successful assignment publishes requested and completed events.

### `GET /api/v0/tasks/:id`

Protected by `core:read`.

Returns one task or `404`.

---

## 7. Logs

### `GET /api/v0/logs/timeline`

Protected by `timeline:read`.

Returns recent Timeline entries, newest first.

### `GET /api/v0/logs/full`

Protected by `log:read-full`.

Returns recent Full Log entries, newest first.

### `GET /api/v0/audit`

Protected by `audit:read`.

Returns recent Audit Log entries, newest first.

---

## 8. Policy

### `GET /api/v0/policy/decisions/:id`

Protected by `core:read`.

Returns one policy decision record.

---

## 9. Phase 9 UI Session Context Extension

Phase 9 adds a read-only session context endpoint for the M-UI BFF:

### `GET /api/v0/session`

Requires a valid Bearer token.

```ts
type SessionContextResponse = {
  actor: "viewer" | "operator" | "admin" | "security-admin";
  permissions: string[];
  correlationId: string;
};
```

Rules:

- This endpoint is for display and command eligibility only.
- `permissions` returns the actor's full MVP permission string list.
- The response must not expose role inheritance, policy internals, RBAC table structure, or policy evaluation traces.
- BFF may use it to show disabled command explanations.
- It must not replace M-Policy checks on mutating routes.
- It must not issue, refresh, or store tokens.
- If permission context cannot be computed, the response fails closed and the UI command stays disabled.

### `GET /api/v0/policy/decisions/:id/summary` (BFF)

The M-UI BFF proxies Core `GET /api/v0/policy/decisions/:id` and returns a trimmed summary for UI display.

**Response (200)**:

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

**Rules**:

- Requires a valid Bearer token with `core:read`.
- The BFF strips `reasons` and all policy internals from the Core response.
- Returns 401 without token, 404 if decision not found, passes through Core error envelopes on failure.
- This endpoint is display-only and must not expose policy evaluation internals.


---

## Phase 10: OpenSearch Search Endpoints

Core exposes three REST search endpoints that delegate to M-Log internal search APIs. Core does not implement OpenSearch query logic directly.

### 9.1 GET /api/v0/logs/timeline/search

Query timeline logs by text, subject, correlation ID, and time range.

**Permission**: `timeline:read`

**Query Parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `q` | string | no | text search query |
| `from` | ISO 8601 | no | start of time range |
| `to` | ISO 8601 | no | end of time range |
| `limit` | number | no | max results (hard cap 100) |
| `subject` | string | no | log subject filter |
| `correlationId` | string | no | correlation ID filter |

**Success Response** (200):

```ts
type TimelineSearchResponse = {
  entries: TimelineLog[];
  total: number;
};
```

**Error Responses**: 401, 403, 503 (`search_unavailable`).

### 9.2 GET /api/v0/logs/full/search

Query full logs by text, level, source, correlation ID, trace ID, and time range.

**Permission**: `log:read-full`

**Query Parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `q` | string | no | text search query |
| `from` | ISO 8601 | no | start of time range |
| `to` | ISO 8601 | no | end of time range |
| `limit` | number | no | max results (hard cap 100) |
| `level` | `debug` \| `info` \| `warn` \| `error` | no | log level |
| `source` | string | no | source service filter |
| `correlationId` | string | no | correlation ID filter |
| `traceId` | string | no | trace ID filter |

**Success Response** (200):

```ts
type FullLogSearchResponse = {
  entries: FullLog[];
  total: number;
};
```

**Error Responses**: 401, 403, 503 (`search_unavailable`).

### 9.3 GET /api/v0/audit/search

Query audit logs by actor, action, resource, decision ID, correlation ID, and time range.

**Permission**: `audit:read`

**Query Parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `q` | string | no | text search query |
| `from` | ISO 8601 | no | start of time range |
| `to` | ISO 8601 | no | end of time range |
| `limit` | number | no | max results (hard cap 100) |
| `actor` | string | no | actor filter |
| `action` | string | no | action filter |
| `resource` | string | no | resource filter |
| `decisionId` | string | no | policy decision ID filter |
| `correlationId` | string | no | correlation ID filter |

**Success Response** (200):

```ts
type AuditSearchResponse = {
  entries: AuditLog[];
  total: number;
};
```

**Error Responses**: 401, 403, 503 (`search_unavailable`).

**Failure Semantics**:

- OpenSearch unavailability returns 503 with `search_unavailable` code.
- PostgreSQL-backed list endpoints (`GET /api/v0/logs/timeline`, `/api/v0/logs/full`, `/api/v0/audit`) remain usable.
- Authoritative log writes are never blocked by search degradation.

## 10. Projection Platform Endpoints

Core exposes Projection Platform REST endpoints as thin adapters over the M-Log projection engine. Core owns public authentication, M-Policy authorization, Audit fail-closed behavior, and Timeline / Full Log observability; M-Log owns projection jobs, cursors, DLQ records, backfill execution, and OpenSearch writes.

### 10.1 GET /api/v0/projection/health

Returns projection health by index.

**Permission**: `projection:read`

**Success Response** (200):

```ts
type ProjectionHealthResponse = {
  indices: Array<{
    index: string;
    lagSeconds: number;
    lastProjectedAt: string | null;
    pendingCount: number;
    dlqCount: number;
    status: "healthy" | "degraded" | "unavailable";
  }>;
};
```

**Logging Semantics**:

- This read action does not write Audit Log.
- Projection unavailable or degraded failures return 503 and write Full Log.

### 10.2 POST /api/v0/projection/backfill

Runs a projection backfill job for one index.

**Permission**: `projection:backfill`

**Request Body**:

```ts
type ProjectionCursor = {
  factId: string;
  timestamp: string;
};

type ProjectionBackfillRequest = {
  index: string;
  from?: ProjectionCursor;
  to?: ProjectionCursor;
  batchSize: number;
  targetVersion?: string;
};
```

**Success Response** (200):

```ts
type ProjectionBackfillResponse = {
  jobId: string;
  processedCount: number;
  errors: number;
  lastCursor: ProjectionCursor | null;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
};
```

**Logging Semantics**:

- Core writes Audit Log before executing the backfill with action `projection:backfill`, resource `projection:<index>`, and payload fields `batchSize`, `from`, `to`, and `targetVersion` when present.
- If Audit Log is unavailable, the request fails closed with 503 and Core does not call M-Log projection execution.
- Successful execution writes Timeline Log.
- Projection unavailable or degraded failures return 503 and write Full Log.

### 10.3 GET /api/v0/projection/dlq

Lists projection DLQ records, optionally filtered by index.

**Permission**: `projection:read`

**Query Parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `index` | string | no | projection index filter |

**Success Response** (200):

```ts
type ProjectionDLQListResponse = {
  records: Array<{
    id: string;
    jobId: string;
    factId: string;
    index: string;
    error: string;
    attemptedAt: string[];
    retries: number;
    createdAt: string;
  }>;
};
```

**Logging Semantics**:

- This read action does not write Audit Log.
- Projection unavailable or degraded failures return 503 and write Full Log.

### 10.4 POST /api/v0/projection/dlq/:id/replay

Replays one projection DLQ record.

**Permission**: `projection:dlq-manage`

**Success Response** (200):

```ts
type ProjectionDLQReplayResponse = {
  replayed: boolean;
};
```

**Logging Semantics**:

- Core writes Audit Log before execution with action `projection:dlq-manage`, resource `projection-dlq:<id>`, and payload `{ operation: "replay" }`.
- If Audit Log is unavailable, the request fails closed with 503 and Core does not call M-Log projection execution.
- Successful replay writes Timeline Log.
- Projection unavailable or degraded failures return 503 and write Full Log.

### 10.5 POST /api/v0/projection/dlq/:id/skip

Skips one projection DLQ record.

**Permission**: `projection:dlq-manage`

**Success Response** (200):

```ts
type ProjectionDLQSkipResponse = {
  skipped: boolean;
};
```

**Logging Semantics**:

- Core writes Audit Log before execution with action `projection:dlq-manage`, resource `projection-dlq:<id>`, and payload `{ operation: "skip" }`.
- If Audit Log is unavailable, the request fails closed with 503 and Core does not call M-Log projection execution.
- Successful skip writes Timeline Log.
- Projection unavailable or degraded failures return 503 and write Full Log.

**Failure Semantics**:

- Missing or denied credentials return 401 or 403 through the common protected endpoint envelope.
- M-Log projection engine unavailability returns 503 with the projection error code.
- Audit Log unavailability on control actions returns 503 before any projection mutation is attempted.


---

## 11. OpenAPI Requirements

OpenAPI must include:

- every route above
- request and response schemas
- protected endpoint permission metadata
- error response schema
- API version `v0`
