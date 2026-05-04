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

Returns registered service definitions.

---

## 4. Nodes

### `POST /api/v0/nodes`

Protected by `node:register`.

```ts
type RegisterNodeRequest = {
  kind: "stem" | "leaf";
  name: string;
  capabilities?: string[];
};

type RegisterNodeResponse = {
  node: {
    id: string;
    kind: "stem" | "leaf";
    name: string;
    status: "healthy";
    capabilities: string[];
    createdAt: string;
  };
  policyDecisionId: string;
  correlationId: string;
};
```

Rules:

- Leaf nodes default to low permission, restricted API, and restricted interconnect metadata.
- Core node registration is not exposed through this MVP endpoint.
- Successful registration publishes `node.registration.accepted.v0`.

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
- The task completes synchronously for MVP.
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

## 9. OpenAPI Requirements

OpenAPI must include:

- every route above
- request and response schemas
- protected endpoint permission metadata
- error response schema
- API version `v0`
