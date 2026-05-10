# Service Lifecycle Prototype Contract

> This document defines the current post-MVP lifecycle prototype. It is intentionally narrower than the full config lifecycle in `docs/config/CONFIG-LIFECYCLE.md`.

---

## 1. Public REST

Base path: `/api/v0`

### `GET /services`

Permission: `core:read`

```ts
type ServiceSummary = {
  id: string;
  version: string;
  domain: "core" | "m-net" | "m-eventbus" | "m-log" | "m-policy" | "m-ui" | "m-cli" | "m-extension";
  kind: "core" | "internal" | "node" | "task" | "extension" | "bff";
  lifecycle: {
    reloadable: boolean;
    rollbackable: boolean;
    degradable: boolean;
  };
  runtime?: {
    liveness: boolean;
    readiness: boolean;
    mode: "normal" | "degraded";
    lastError?: string;
    lastReloadedAt?: string;
  };
};

type ServiceListResponse = {
  services: ServiceSummary[];
};
```

Rules:

- built-in services always appear.
- registered service definitions may appear even when they do not expose runtime probing.
- built-in runtime is live-probed by Core.

### `POST /services/:id/reload`

Permission: `service:reload`

```ts
type ServiceReloadRequest = {
  reason?: string;
};

type ServiceReloadResponse = {
  serviceId: string;
  accepted: true;
  reloadedAt: string;
  policyDecisionId: string;
  correlationId: string;
};
```

Status mapping:

- `200` reload accepted and completed synchronously
- `403` policy denied
- `404` `service.not_found`
- `409` `service.not_reloadable`
- `503` target service unavailable or reload failed

---

## 2. CLI

```bash
meristem service list
meristem service reload --service <service-id> [--reason <text>]
```

Rules:

- both commands call Core only
- failed command exits non-zero
- reload output includes `serviceId`, `policyDecisionId`, and `correlationId`

---

## 3. Internal Loopback API

Transport: `loopback HTTP + Eden + x-meristem-internal-token`

### `POST /internal/v0/lifecycle/reload`

```ts
type InternalReloadRequest = {
  correlationId?: string;
  reason?: string;
};

type InternalReloadResponse = {
  ok: true;
  serviceId: string;
  reloadedAt: string;
};
```

Rules:

- only reloadable services implement this endpoint
- invalid or missing internal token is treated as service unavailable by Core
- reload must be safe to retry

---

## 4. Logging and Events

- every public reload attempt writes Audit
- successful reload writes Timeline
- failed reload writes Timeline and Full Log
- Core publishes `service.lifecycle.reload.requested.v0` before the internal call
- Core publishes `service.lifecycle.reload.failed.v0` when the internal call fails

---

## 5. Explicit Non-Goals

- no config version creation
- no publish/apply/ack state machine
- no rollback API
- no distributed rollout batching
