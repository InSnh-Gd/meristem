# REST API MVP Contract

> REST API v0 is the external HTTP / OpenAPI contract for the current Meristem baseline.
>
> 本文档是 canonical contract：外部 route、permission、request / response shape、error envelope 与 exposed internal path 都以这里为准。CLI、Eden 与 lifecycle supplemental 文档只能引用或补充运行时语义，不能覆盖本文件。

---

## 1. Scope and Authority

- 覆盖外部 `/api/v0` route，以及被内部服务显式消费的 `/internal/v0` route。
- 公开 HTTP shape、permission 与 error envelope 以本文件为准。
- CLI 命令映射见 `CLI-COMMANDS.md`；typed client 映射见 `EDEN-MVP.md`；service reload runtime supplement 见 `SERVICE-LIFECYCLE-PROTOTYPE.md`。
- Event subject 名称可以在规则中被引用，但 subject catalog authority 仍在 `docs/events/EVENT-CATALOG.md`。

---

## 2. Common Rules

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

## 3. Health and Status

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

## 4. Service Registration and Follow-on Service Ownership

### `POST /api/v0/services`

Protected by `service:register`.

Registers a service definition that conforms to `docs/services/SERVICE-DEFINITION-TEMPLATE.md`.

### `GET /api/v0/services`

Protected by `core:read`.

Returns service summaries. Built-in services include live runtime data; registered service definitions may appear without runtime details.

The canonical route remains here; additional runtime reload semantics are documented in `SERVICE-LIFECYCLE-PROTOTYPE.md`.

### Follow-on Capability Domain Service REST Ownership

Some post-MVP external routes are owned directly by capability domain services instead of Core. Those services must still use `/api/v0`, external bearer authentication, M-Policy, M-Log, OpenAPI, and the same error envelope shape unless their feature document states otherwise.

Examples:

- M-Net owns network profile routes from the M-Net profile lifecycle.
- M-Policy owns approval routes from the M-Policy approval flow.
- M-Extension owns extension control-plane routes from the M-Extension control plane.

---

## 4.1 M-Extension Control Plane Routes

M-Extension control plane routes are owned by `m-extension`, not Core.

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
- `high` and `critical` risk manifests are rejected in the M-Extension control plane.
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

- M-Extension control plane only accepts `scopeType = "system"` and `scopeId = "default"`.
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

- M-Extension control plane only accepts `scopeType = "system"` and `scopeId = "default"`.
- M-Policy allow is required.
- allowed disable writes Audit before the state transition.
- disable does not create an approval record.

---

## 4.2 Identity Local-Mode Routes

Identity local-mode routes are owned by Core. They do not introduce M-Identity. The actor-token contract revision currently tracks `identity-token@0.2.0`, while the external HTTP surface remains `/api/v0`.

External routes require Bearer authentication and M-Policy authorization. The internal introspection route requires `x-meristem-internal-token` and returns revocation status without token plaintext.

### `GET /api/v0/identity/actors`

Protected by `identity:read`.

Returns all local-mode identity actors.

```ts
type IdentityActorRecord = {
  id: "viewer" | "operator" | "admin" | "security-admin";
  displayName: string;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
};

type IdentityActorListResponse = {
  actors: IdentityActorRecord[];
};
```

**Error Responses**: 401, 403, 503.

### `GET /api/v0/identity/actors/:id`

Protected by `identity:read`.

Returns one local-mode identity actor or `404`.

```ts
type IdentityActorResponse = {
  actor: IdentityActorRecord;
};
```

**Error Responses**: 401, 403, 404, 503.

### `POST /api/v0/identity/tokens`

Protected by `identity:token-issue` (security-admin only).

Issues an actor token. Writes Audit before returning the plaintext token. Token plaintext is returned only once and must never be stored or logged.

```ts
type IssueTokenRequest = {
  actor: "viewer" | "operator" | "admin" | "security-admin";
  ttl: string;        // duration string, e.g. "1h", "7d"
  purpose: string;    // human-readable reason for the token
};

type IssueTokenResponse = {
  jti: string;
  token: string;        // JWT plaintext, returned only once
  expiresAt: string;
  actor: "viewer" | "operator" | "admin" | "security-admin";
  issuer: "meristem-local";
  audience: "meristem-core";
  purpose: string;
  status: "active";
};
```

**Error Responses**: 401, 403, 503.

### `GET /api/v0/identity/tokens/:jti`

Protected by `identity:token-inspect` (admin + security-admin).

Returns token metadata and status without token plaintext.

```ts
 type ActorTokenRecord = {
  jti: string;
  actor: "viewer" | "operator" | "admin" | "security-admin";
  issuer: "meristem-local";
  audience: "meristem-core" | "meristem-service";
  issuedAt: string;
  expiresAt: string;
  issuedBy: "viewer" | "operator" | "admin" | "security-admin";
  purpose: string;
  status: "active" | "revoked" | "expired";
  revokedAt?: string;
  revokedBy?: "viewer" | "operator" | "admin" | "security-admin";
  revokeReason?: string;
};
```

**Error Responses**: 401, 403, 404, 503.

### `POST /api/v0/identity/tokens/:jti/revoke`

Protected by `identity:token-revoke` (security-admin only).

Revokes one actor token by `jti`. Writes Audit before changing token status.

```ts
type RevokeTokenRequest = {
  reason: string;
};

type RevokeTokenResponse = {
  jti: string;
  status: "revoked";
  revokedAt: string;
  revokedBy: "viewer" | "operator" | "admin" | "security-admin";
  revokeReason: string;
  token: {
    jti: string;
    status: "revoked";
    revokedAt: string;
    revokedBy: "viewer" | "operator" | "admin" | "security-admin";
    revokeReason: string;
  };
};
```

**Error Responses**: 401, 403, 404, 503.

### `POST /internal/v0/identity/tokens/introspect`

Internal endpoint. Requires `x-meristem-internal-token`. Never returns token plaintext.

Capability domain services must call this endpoint to verify revocation state instead of reading Core token tables directly. Core unavailable fails closed for protected external capability domain routes.

```ts
type IntrospectTokenRequest = {
  jti: string;
};

type IntrospectTokenResponse = {
  jti?: string;
  active: boolean;
  actor?: "viewer" | "operator" | "admin" | "security-admin";
};
```

**Error Responses**: 401 (invalid or missing internal token), 503 (Core unavailable).

**Rules**:

- `active: false` means the token is revoked, expired, or the jti is unknown.
- positive-result caching is allowed for at most 30 seconds keyed by `jti`.
- revoked, denied, expired, or unknown results must not be cached as active.
- Core stores only the token hash; token plaintext is never persisted.

---

## 4.3 SecretRef v0.1 Routes

SecretRef v0.1 routes are owned by Core. They do not introduce M-Secret.

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
- secret values must never appear in error envelopes, Timeline / Full / Audit logs, events, OpenSearch projections, CLI stdout/stderr, UI errors, or LLM prompts.

---

## 4.4 Config Lifecycle v0.1 Routes

Config Lifecycle v0.1 routes are owned by Core.

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

## 4.5 M-Net Profile Routes (M-Net External)

M-Net profile lifecycle routes are owned by M-Net, not Core. These routes use Bearer authentication and are mounted on the M-Net service.

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
- enabling M-Net CN requires M-Policy approval: M-Policy returns `require_manual_review`, M-Net creates a suspended operation, and the request returns `202` with `approvalId` and `operationId`.
- disabling M-Net CN is immediate with M-Policy allow + Audit, no approval required.
- disable is allowed as a recovery path from `failed` state.
- M-Net exposes OpenAPI for these external routes.
- Core exposes read-only facade routes for list/detail at the same `/api/v0/network-profiles*` paths on the Core service. The facade must call only M-Net public HTTP routes and must not call `/internal/v0/*` or M-Net private stores. Mutating profile lifecycle routes remain owned by M-Net.

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

## 4.6 Core Read Facades for Approval and Profile Data

Core owns a public read facade for UI/BFF callers that need one stable Core boundary. The facade does not own approval or profile data. It authenticates the caller, authorizes with M-Policy, forwards the caller Bearer token and actor context to explicit Core dependency ports, and those production ports call only the owning service public HTTP routes.

Routes:

```text
GET /api/v0/policy/approvals
GET /api/v0/policy/approvals/:id
GET /api/v0/network-profiles
GET /api/v0/network-profiles/:profileVersion
```

Permissions:

- approval list/detail: `policy:approval-read`
- profile list/detail: `network:profile-read`

Dependency-port rules:

- Core route handlers call `approvalReader` and `networkProfileReader` ports only.
- `approvalReader` production adapters call only M-Policy `/api/v0/policy/approvals*` public HTTP routes.
- `networkProfileReader` production adapters call only M-Net `/api/v0/network-profiles*` public HTTP routes.
- Core must not import M-Policy/M-Net private stores, tables, service internals, or call `/internal/v0/*` for these reads.

Error responses use the common Core envelope:

- missing/invalid token: `401`
- insufficient permission: `403`
- missing approval/profile: `404`
- owning service unavailable or invalid facade response: `503`

The approval queue list returns `{ approvals: [] }` when there are no pending records; it does not return `404`.

---

## 5. Nodes

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
    mode: "agent" | "managed" | "simulated";
    status: "ready" | "joining" | "healthy" | "degraded" | "offline" | "disabled" | "isolated" | "recovering" | "revoked";
    reachability: "unknown" | "public" | "private" | "reachable" | "unreachable";
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
- `simulated` mode preserves the synchronous local-only path used for development and tests.
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
- node-agent restart or explicit reconfiguration is required to use the replacement token; this slice does not provide automatic in-agent token refresh.

**Error Responses**: `404` (node not found), `503` (audit write failed)

### `POST /api/v0/nodes/:id/credentials/revoke`

Protected by `node:issue-token`.

```ts
type RevokeNodeCredentialResponse = {
  nodeId: string;
  revokedAt: string;
  policyDecisionId: string;
  correlationId: string;
};
```

Rules:

- revokes the active runtime token for the target node without returning replacement token material.
- missing node returns `404 node.not_found`.
- nodes without an active runtime token return `409 node.credential_not_active` and do not write a success timeline fact.
- revoked runtime tokens fail closed for later runtime authentication or `session.resume` attempts.
- a later replacement token still requires node-agent restart or explicit reconfiguration in this slice.

**Error Responses**: `404` (node not found), `409` (no active credential), `503` (audit write failed)

### `GET /api/v0/nodes`

Protected by `core:read`.

Returns all MVP node records.

### `GET /api/v0/nodes/:id`

Protected by `core:read`.

Returns one node or `404`.

### `POST /api/v0/nodes/:id/control`

Protected by one of the node-control permissions selected by action:

- `node:disable` for `disable`
- `node:isolate` for `isolate`
- `node:recover` for `recover`
- `node:switch-role` for `switch-role`

```ts
type NodeControlRequest = {
  action: 'disable' | 'isolate' | 'recover' | 'switch-role';
  reason: string;
  targetKind?: 'stem' | 'leaf';
};

type NodeControlResponse = {
  node: MNode;
  policyDecisionId: string;
  correlationId: string;
};
```

Rules:

- Core is the public facade; it authorizes the actor and forwards the control request to M-Net.
- `disable`, `isolate`, and `recover` are admin/security-admin actions.
- `switch-role` is operator-only and requires `targetKind`.
- demoting a stem to a leaf fails closed if any joined network would be left without another stem.
- policy denials and successful transitions are auditable.

**Error Responses**: `403` (policy denied), `404` (node not found), `409` (invalid transition), `503` (audit/side-effect failed)

---

## 6. Networks

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

## 7. Tasks

M-Task cutover changes the owner of the canonical task API from Core to M-Task. The resource path remains `/api/v0/tasks`, but the service exposing it is M-Task, not Core.

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

- M-Task supports only `noop` execution.
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

M-Task returns `not_implemented_yet` after auth, RBAC, and risk checks allow the retry request.

---

## 8. Logs

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

## 9. Policy

### `GET /api/v0/policy/decisions/:id`

Protected by `core:read`.

Returns one policy decision record.

---

## 10. M-UI Session and Search Surface

This section collects read-only BFF session context and log search endpoints used by M-UI.

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

### OpenSearch Search Endpoints

Core exposes three REST search endpoints that delegate to M-Log internal search APIs. Core does not implement OpenSearch query logic directly.

#### `GET /api/v0/logs/timeline/search`

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

#### `GET /api/v0/logs/full/search`

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

#### `GET /api/v0/audit/search`

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

## 11. Projection Platform Endpoints

Core exposes Projection Platform REST endpoints as thin adapters over the M-Log projection engine. Core owns public authentication, M-Policy authorization, Audit fail-closed behavior, and Timeline / Full Log observability; M-Log owns projection jobs, cursors, DLQ records, backfill execution, and OpenSearch writes.

### `GET /api/v0/projection/health`

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

### `POST /api/v0/projection/backfill`

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

### `GET /api/v0/projection/dlq`

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

### `POST /api/v0/projection/dlq/:id/replay`

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

### `POST /api/v0/projection/dlq/:id/skip`

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

## 12. OpenAPI Requirements

OpenAPI must include:

- every route above
- request and response schemas
- protected endpoint permission metadata
- error response schema
- API version `v0`

## 13. M-Policy Approval Routes (M-Policy External)

M-Policy owns the external approval REST surface. These routes use Bearer authentication and are mounted on the M-Policy service. Core also exposes read-only facade list/detail routes for BFF/UI callers; that facade must call these M-Policy public routes, not `/internal/v0/*`.

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

## 14. M-Task Resume (Internal)

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
