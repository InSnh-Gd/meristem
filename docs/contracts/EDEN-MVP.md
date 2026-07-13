# Eden MVP Contract

> Eden 是 Meristem 内部优先的 TypeScript typed client 契约。
>
> 本文档是 supporting contract：它说明 CLI→Core 与 Core→内部服务如何通过 Eden 消费 HTTP 契约；外部 request / response shape 仍以 `REST-API-MVP.md` 为准。

---

## 1. Scope

- 覆盖 CLI → Core 的 typed client。
- 覆盖 Core → `M-Policy` / `M-Log` / `M-EventBus` / `M-Net` / `M-Deploy` 的 loopback HTTP typed client。
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

type MDeployClient = {
  desiredState(): Promise<MDeployDesiredStateSummary>;
  createProposal(input: MDeployProposalRequest): Promise<{ proposal: MDeployProposalV01 }>;
  proposal(id: string): Promise<{ proposal: MDeployProposalV01 }>;
  approve(id: string, input: MDeployApprovalRequest): Promise<{ approval: MDeployApprovalV01 }>;
  apply(input: MDeployApplyRequest): Promise<{ operation: MDeployOperation & { applyStatus: MDeployApplyStatus } }>;
  rollback(input: MDeployRollbackRequest): Promise<{ operation: MDeployOperation }>;
  drift(): Promise<{ reports: MDeployDriftReportV01[] }>;
  requestDriftCheck(): Promise<{ requested: true; correlationId: string }>;
  evidence(): Promise<{ evidence: MDeployEvidenceMetadataV01[] }>;
  agents(): Promise<{ agents: MDeployAgentRecord[] }>;
};

type MDeployAgentClient = {
  enroll(input: MDeployAgentEnrollmentV01): Promise<{ agent: MDeployAgentRecord }>;
  heartbeat(agentId: string, input: MDeployAgentHeartbeatV01): Promise<{ agent: MDeployAgentRecord }>;
  reconcile(agentId: string): Promise<
    { reconcile: MDeployReconcileResultV01 } | { rollback: MDeployRollbackResultV01 }
  >;
  reportDrift(input: MDeployDriftReportV01): Promise<{ report: MDeployDriftReportV01 }>;
};
```

`MDeployClient` maps exactly to the mounted `/api/v0/deploy/*` routes in `REST-API-MVP.md`. `MDeployAgentClient` maps exactly to `/internal/v0/deploy/agents/enroll`, `.../:id/heartbeat`, `.../:id/reconcile`, and `/internal/v0/deploy/drift`; it sends `MERISTEM_INTERNAL_TOKEN` and never exposes these methods to external users. `MDeployReconcileResultV01` and `MDeployRollbackResultV01` include `publicationStatus: "pending" | "published"`; `pending` is a durably successful/accepted operation whose outbox dispatch will retry, not a runtime failure.

---

## 4. Rules

- Eden contracts are internal TS contracts only.
- External users rely on REST + OpenAPI, not Eden.
- CLI uses the Eden Core client as the official TypeScript path.
- Core uses Eden over loopback HTTP with `MERISTEM_INTERNAL_TOKEN` for `M-Policy`, `M-Log`, `M-EventBus`, and M-Deploy. `createProductionMDeployComposition` uses typed internal HTTP adapters for M-Policy authorization/vote/quorum, M-Log Timeline/Full/Audit/deployment-evidence, and M-EventBus publication; enrolled deployment agents use the authenticated M-Deploy internal HTTP contract for enrollment, heartbeat, reconcile, and drift.
- `M-Net` exposes its synchronous business boundary through loopback HTTP + Eden; the public agent boundary remains TLS + WebSocket join ingress.
- Eden types must not use `any`.
- Eden contract tests must fail when REST or internal HTTP response shape changes incompatibly.
- Eden package semver must reflect incompatible contract changes.

---

## 5. Acceptance

- Core exposes the status contract.
- CLI uses the generated Eden client.
- Core uses generated Eden clients for `M-Policy`, `M-Log`, and `M-EventBus`.
- Contract tests verify `status()`, M-Deploy public/internal route shapes, reconcile publication status, M-Policy quorum, M-Log deployment evidence, and other internal service calls return documented shapes.
