# Eden MVP Contract

> Eden 是 Meristem 内部优先的 TypeScript typed client 契约。
>
> 本文档是 supporting contract：它说明 CLI→Core 与 Core→内部服务如何通过 Eden 消费 HTTP 契约；外部 request / response shape 仍以 `REST-API-MVP.md` 为准。

---

## 1. Scope

- 覆盖 CLI → Core 的 typed client。
- 覆盖 Core → `M-Policy` / `M-Log` / `M-EventBus` / `M-Net` 的 loopback HTTP typed client。
- 不定义新的外部 REST shape；已存在的外部类型名直接引用 `REST-API-MVP.md`。

---

## 2. Package Boundary

Target package:

```text
packages/contracts/
```

Initial Core contract:

```ts
export const coreContract = {
  status: "GET /api/v0/status",
  health: "GET /api/v0/health",
  ready: "GET /api/v0/ready",
} as const;
```

Eden remains a typed client layer on top of HTTP. There is no separate "pure Eden" transport for cross-process calls.

---

## 3. Required Typed Calls

```ts
type CoreClient = {
  health(): Promise<HealthResponse>;
  ready(): Promise<ReadyResponse>;
  status(): Promise<StatusResponse>;
  registerNode(input: RegisterNodeRequest): Promise<RegisterNodeResponse>;
  issueNodeToken(nodeId: string): Promise<IssueNodeCredentialResponse>;
  listServices(): Promise<ServiceListResponse>;
  reloadService(serviceId: string, reason?: string): Promise<ServiceReloadResponse>;
};
```

`HealthResponse`、`ReadyResponse`、`StatusResponse` 以及其他外部 HTTP response type name 由 `REST-API-MVP.md` 定义。

Internal service clients in MVP:

```ts
type PolicyClient = {
  authorize(input: PolicyAuthorizeRequest): Promise<{ decision: PolicyDecision }>;
  getDecision(id: string): Promise<PolicyDecision | null>;
};

type LogClient = {
  writeTimeline(input: TimelineWriteRequest): Promise<{ entry: TimelineLog }>;
  writeFull(input: FullWriteRequest): Promise<{ entry: FullLog }>;
  writeAudit(input: AuditWriteRequest): Promise<{ entry: AuditLog }>;
  reload(input: { correlationId?: string; reason?: string }): Promise<{ serviceId: string; reloadedAt: string }>;
};

type EventBusClient = {
  publish(input: EventPublishRequest): Promise<{ eventId: string }>;
};
```

---

## 4. Rules

- Eden contracts are internal TS contracts only.
- External users rely on REST + OpenAPI, not Eden.
- CLI uses the Eden Core client as the official TypeScript path.
- Core uses Eden over loopback HTTP with `MERISTEM_INTERNAL_TOKEN` for `M-Policy`, `M-Log`, and `M-EventBus`.
- `M-Net` exposes its synchronous business boundary through loopback HTTP + Eden; the public agent boundary remains TLS + WebSocket join ingress.
- Eden types must not use `any`.
- Eden contract tests must fail when REST or internal HTTP response shape changes incompatibly.
- Eden package semver must reflect incompatible contract changes.

---

## 5. Acceptance

- Core exposes the status contract.
- CLI uses the generated Eden client.
- Core uses generated Eden clients for `M-Policy`, `M-Log`, and `M-EventBus`.
- Contract tests verify `status()` and internal service calls return documented shapes.
