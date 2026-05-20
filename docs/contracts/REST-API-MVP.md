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

## 10. OpenAPI Requirements

OpenAPI must include:

- every route above
- request and response schemas
- protected endpoint permission metadata
- error response schema
- API version `v0`
