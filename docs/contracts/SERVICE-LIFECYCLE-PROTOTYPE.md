# Service Lifecycle Runtime Contract

> 本文档记录服务 lifecycle reload 的运行时补充约束。
>
> 它是 supporting contract：外部 REST surface 仍以 `REST-API-MVP.md` 为准，CLI 命令 surface 仍以 `CLI-COMMANDS.md` 为准；本文档只补充 reload 语义、内部 loopback 行为、日志事件与非目标边界。

---

## 1. Scope

- 覆盖 `GET /api/v0/services` 与 `POST /api/v0/services/:id/reload` 的运行时补充语义。
- 覆盖 `POST /internal/v0/lifecycle/reload` 的内部 loopback 约束。
- 覆盖 lifecycle reload 的日志 / 事件语义与显式非目标。
- 不定义配置发布、apply-ack、rollback 或分布式 rollout 契约；这些能力归 `docs/config/CONFIG-LIFECYCLE.md`。

---

## 2. Public REST

Base path: `/api/v0`

### `GET /api/v0/services`

Canonical route definition lives in `REST-API-MVP.md`; the type block below supplements the service lifecycle-specific fields.

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

### `POST /api/v0/services/:id/reload`

Canonical route definition lives in `REST-API-MVP.md`; this section defines the runtime reload semantics.

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

## 3. CLI Mapping

CLI command definitions live in `CLI-COMMANDS.md`:

```bash
meristem service list
meristem service reload --service <service-id> [--reason <text>]
```

Rules:

- both commands call Core only
- failed command exits non-zero
- reload output includes `serviceId`, `policyDecisionId`, and `correlationId`

---

## 4. Internal Loopback API

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

## 5. Logging and Events

- every public reload attempt writes Audit
- successful reload writes Timeline
- failed reload writes Timeline and Full Log
- Core publishes `service.lifecycle.reload.requested.v0` before the internal call
- `service.lifecycle.reload.failed.v0` remains a deferred event subject until a real publisher exists; see `docs/events/EVENT-CATALOG.md`

---

## 6. Explicit Non-Goals

- no config version creation
- no publish/apply/ack state machine
- no rollback API
- no distributed rollout batching
