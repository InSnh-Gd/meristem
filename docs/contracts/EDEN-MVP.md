# Eden MVP Contract

> Eden is the preferred internal TypeScript contract. In MVP it covers CLI -> Core and Core -> selected internal services over HTTP.

---

## 1. Package Boundary

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

## 2. Required Typed Calls

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

`HealthResponse`, `ReadyResponse`, and `StatusResponse` are defined in `docs/contracts/REST-API-MVP.md`.

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

## 3. Rules

- Eden contracts are internal TS contracts only.
- External users rely on REST + OpenAPI.
- CLI uses the Eden Core client as the official TypeScript path.
- Core uses Eden over loopback HTTP with `MERISTEM_INTERNAL_TOKEN` for `M-Policy`, `M-Log`, and `M-EventBus`.
- `M-Net` now exposes its synchronous business boundary through loopback HTTP + Eden; the public agent boundary is a separate TLS + WebSocket join ingress.
- Eden types must not use `any`.
- Eden contract tests must fail when REST or internal HTTP response shape changes incompatibly.
- Eden contract version follows package semver.

---

## 4. MVP Acceptance

- Core exposes the status contract.
- CLI uses the generated Eden client.
- Core uses generated Eden clients for `M-Policy`, `M-Log`, and `M-EventBus`.
- Contract tests verify `status()` and internal service calls return documented shapes.
