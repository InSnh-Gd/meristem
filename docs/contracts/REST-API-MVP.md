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

### Follow-on M-* Service REST Ownership

Some post-MVP external routes are owned directly by M-* services instead of Core. Those services must still use `/api/v0`, external bearer authentication, M-Policy, M-Log, OpenAPI, and the same error envelope shape unless their phase document states otherwise.

Examples:

- M-Net owns network profile routes from Phase 13.
- M-Policy owns approval routes from Phase 12.
- M-Extension owns extension control-plane routes from Phase 15.

---

## 3.1 M-Extension Control Plane Routes

Phase 15 M-Extension routes are owned by `m-extension`, not Core.

### `GET /api/v0/extensions`

Protected by `extension:read`.

Returns extension definitions and `system/default` instance summaries.

### `GET /api/v0/extensions/:id`

Protected by `extension:read`.

Returns one extension definition and its `system/default` instance state.

### `POST /api/v0/extensions/register`

Protected by `extension:register`.

```ts
type RegisterExtensionRequest = {
  manifest: MExtensionManifestV01;
  reason?: string;
};
```

Rules:

- manifest must be version `m-extension-manifest@0.1.0`.
- manifest must be `controlPlaneOnly: true`.
- only declaration kinds are accepted.
- unknown requested permissions are rejected.
- `high` and `critical` risk manifests are rejected in Phase 15.
- allowed registration writes Audit before persistence.
- registration does not install code or create an execution runtime.

### `POST /api/v0/extensions/:id/enable`

Protected by `extension:enable`.

```ts
type EnableExtensionRequest = {
  scopeType?: "system";
  scopeId?: "default";
  reason?: string;
};
```

Rules:

- Phase 15 only accepts `scopeType = "system"` and `scopeId = "default"`.
- M-Policy allow is required.
- allowed enable writes Audit before the state transition.
- enable does not execute Wasm, webhook, HTTP callback, script, or cloud-function behavior.

### `POST /api/v0/extensions/:id/disable`

Protected by `extension:disable`.

```ts
type DisableExtensionRequest = {
  scopeType?: "system";
  scopeId?: "default";
  reason?: string;
};
```

Rules:

- Phase 15 only accepts `scopeType = "system"` and `scopeId = "default"`.
- M-Policy allow is required.
- allowed disable writes Audit before the state transition.
- disable does not create an approval record.

---

## 3.2 Identity v0.2 Local Mode Routes

Phase 17 identity routes are owned by Core. They do not introduce M-Identity.

```text
GET  /api/v0/identity/actors
GET  /api/v0/identity/actors/:id
POST /api/v0/identity/tokens
GET  /api/v0/identity/tokens/:jti
POST /api/v0/identity/tokens/:jti/revoke
POST /internal/v0/identity/tokens/introspect
```

Rules:

- runtime token issue and revoke require `security-admin`.
- token issue writes Audit before returning plaintext token.
- token plaintext is returned only once and must never be stored or logged.
- introspection is internal-only and returns revocation status without token plaintext.
- M-* services must use introspection instead of reading Core token tables.

---

## 3.3 SecretRef v0.1 Routes

Phase 18 secretRef routes are owned by Core. They do not introduce M-Secret.

```text
GET  /api/v0/secrets
GET  /api/v0/secrets/:id
POST /api/v0/secrets
POST /api/v0/secrets/:id/rotate
POST /api/v0/secrets/:id/disable
POST /internal/v0/secrets/:id/reference
```

Rules:

- external read routes return metadata only.
- create / rotate / disable require M-Policy and Audit.
- plaintext secret values must never be echoed in responses after create / rotate.
- secret values must never appear in error envelopes, logs, events, OpenSearch projections, UI errors, or LLM prompts.

---

## 3.4 Config Lifecycle v0.1 Routes

Phase 19 config lifecycle routes are owned by Core.

```text
GET  /api/v0/configs
GET  /api/v0/configs/:id
POST /api/v0/configs/drafts
POST /api/v0/configs/:id/validate
POST /api/v0/configs/:id/publish
POST /api/v0/configs/:id/rollback
POST /internal/v0/configs/:id/apply-ack
```

Rules:

- config payloads must be schema validated, versioned, hash-addressed, published, applied, and acknowledged.
- high-risk publish / rollback requires M-Policy and Audit.
- plaintext secrets are prohibited; use `secretRef`.
- domain services apply config through declared internal contracts and must not mutate Core config tables directly.

---

## 3.5 Phase 13 Network Profile Routes (M-Net External)

Phase 13 network profile routes are owned by M-Net, not Core. These routes use Bearer authentication and are mounted on the M-Net service.

### `GET /api/v0/network-profiles`

Protected by `network:profile-read`.

Returns available Regional Network Profile definitions.

```ts
type NetworkProfileDefinition = {
  profileVersion: string;
  region: string;
  displayName: string;
  schemaVersion: string;
  status: "available";
  rules: Record<string, unknown>;
  capabilities: {
    realDerpRelay: boolean;
    realTcpInterconnect: boolean;
    realUdpPathSwitching: boolean;
    controlPlaneOnly: boolean;
  };
  createdAt: string;
  updatedAt: string;
};

type NetworkProfileListResponse = {
  profiles: NetworkProfileDefinition[];
};
```

### `GET /api/v0/network-profiles/:profileVersion`

Protected by `network:profile-read`.

Returns one profile definition or `404`.

```ts
type NetworkProfileDetailResponse = NetworkProfileDefinition;
```

### `POST /api/v0/networks/:id/profile`

Set the Regional Network Profile for one logical network.

```ts
type SetNetworkProfileRequest = {
  profileVersion: "m-net-default@0.1.0" | "m-net-cn@0.1.0";
  reason: string;
};
```

Permissions:

- Setting `m-net-cn@0.1.0` requires `network:profile-enable`.
- Setting `m-net-default@0.1.0` (disabling CN) requires `network:profile-disable`.

Rules:

- M-Net verifies external JWT bearer auth at its own boundary.
- M-Net calls M-Policy for profile enable / disable authorization.
- M-Net calls M-Log for Timeline / Full / Audit facts.
- M-Net calls M-EventBus for profile lifecycle events.
- enabling M-Net CN requires Phase 12 approval: M-Policy returns `require_manual_review`, M-Net creates a suspended operation, and the request returns `202` with `approvalId` and `operationId`.
- disabling M-Net CN is immediate with M-Policy allow + Audit, no approval required.
- disable is allowed as a recovery path from `failed` state.
- M-Net exposes OpenAPI for these external routes.
- Core may aggregate readiness but must not own or facade profile routes.

```ts
type SetNetworkProfileResponse = {
  networkId: string;
  fromProfileVersion: string;
  toProfileVersion: string;
  status: "enabled" | "disabled" | "pending_approval";
  approvalId?: string;
  operationId?: string;
  policyDecisionId: string;
  correlationId: string;
};
```

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

Phase 11 changes the owner of the canonical task API from Core to M-Task. The resource path remains `/api/v0/tasks`, but the service exposing it is M-Task, not Core.

### `POST /api/v0/tasks`

Protected by `task:submit`.

```ts
type SubmitTaskRequest = {
  nodeId: string;
  type: "noop";
};

type SubmitTaskResponse = {
  task: {
    id: string;
    nodeId: string;
    leafNodeId: string;
    type: "noop";
    status: "accepted" | "queued" | "dispatched" | "running" | "completed" | "failed" | "cancel_requested" | "canceled" | "timed_out";
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
  };
  policyDecisionId: string;
  correlationId: string;
  risk: {
    operationDangerLevel: "medium";
    suspicionScore: number;
    riskFactors: string[];
  };
};
```

Rules:

- Phase 11 supports only `noop` execution.
- Target must be an existing Leaf node known through M-Net / node state.
- M-Task checks `task:submit`, asks M-Policy for risk output, writes required M-Log facts, and publishes task lifecycle events.
- Delivery to node-agent goes M-Task -> M-Net -> active join session `task.execute`.
- Core does not expose canonical task routes after the cutover.

### `GET /api/v0/tasks/:id`

Protected by `task:read`.

Returns one task or `404`.

### `POST /api/v0/tasks/:id/cancel`

Protected by `task:cancel`.

Cancels queued tasks directly and requests best-effort cancel for dispatched or running tasks.

### `POST /api/v0/tasks/:id/retry`

Protected by `task:retry`.

Phase 11 returns `not_implemented_for_phase` after auth, RBAC, and risk checks allow the retry request.

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

## 12. Phase 12 Approval Routes (M-Policy External)

Phase 12 M-Policy owns the external approval REST surface. These routes use Bearer authentication and are mounted on the M-Policy service.

### `GET /api/v0/policy/approvals`

Permission: `policy:approval-read` (admin + security-admin).

Returns pending approval records. List and detail reads do not write Audit Log.

```ts
type ApprovalListResponse = {
  approvals: PolicyApproval[];
};
```

### `GET /api/v0/policy/approvals/:id`

Permission: `policy:approval-read` (admin + security-admin).

Returns one approval record with its votes.

```ts
type ApprovalDetailResponse = PolicyApproval & {
  votes: PolicyApprovalVote[];
};
```

### `POST /api/v0/policy/approvals/:id/approve`

Permission: `policy:approval-approve` (security-admin only).

```ts
type ApprovalActionRequest = {
  reason?: string;
};
```

Rules:

- approval must be in `pending` status.
- approval must not be expired.
- original actor cannot approve their own operation.
- duplicate vote from same actor is rejected.
- manual review approves with one valid security-admin vote.
- multi approval approves with two distinct security-admin votes.
- approval state transitions write Audit Log.

### `POST /api/v0/policy/approvals/:id/reject`

Permission: `policy:approval-reject` (security-admin only).

Rules:

- one reject vote rejects both manual and multi approval.
- same self-approval and duplicate restrictions as approve.

---

## 13. Phase 12 M-Task Resume (Internal)

### `POST /internal/v0/task-operations/:id/resume`

Internal endpoint called by M-Policy when approval is granted.

Rules:

- only processes `suspended` operations.
- expired operations cannot be resumed.
- performs stale-state checks (target task must exist).
- performs safety checks (terminal tasks cannot be canceled).
- records `resumed` or `resume_failed` in suspended operation.
- emits `task.operation.resumed.v0` or `task.operation.resume.failure.v0` events.
- writes Audit Log for resume attempts.
