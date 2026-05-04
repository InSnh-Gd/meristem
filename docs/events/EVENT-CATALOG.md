# Event Catalog

> This catalog defines initial M-EventBus subjects, ownership, payload expectations, and delivery rules. Every published NATS subject must be listed here before implementation.

---

## 1. Envelope

All events use:

```ts
type MEventEnvelope = {
  id: string;
  type: string;
  version: string;
  source: string;
  timestamp: string;
  correlationId?: string;
  causationId?: string;
  subject?: string;
  payload: unknown;
};
```

Rules:

- `payload` starts as `unknown` and must be narrowed by schema.
- `version` is required.
- `correlationId` must propagate across command -> event -> log -> trace when available.
- Consumers must be idempotent by `id` or domain-specific key.

---

## 2. Subject Naming

```text
<domain>.<resource>.<verb>.v<major>
```

Examples:

```text
core.lifecycle.started.v0
node.registration.requested.v0
mnet.path.changed.v0
```

Rules:

- Domain names are lowercase.
- Major version is part of the subject.
- Non-breaking payload changes keep the same subject and increment schema minor version.
- Breaking changes require a new `v<major>` subject.

---

## 3. Initial Catalog

| Subject | Type | Publisher | Subscribers | Payload Schema | Delivery |
|---------|------|-----------|-------------|----------------|----------|
| `core.lifecycle.started.v0` | event | Core | M-Log, M-UI BFF | `CoreLifecyclePayload` | at-least-once |
| `core.lifecycle.degraded.v0` | event | Core | M-Log, M-Policy, M-UI BFF | `CoreDegradedPayload` | at-least-once |
| `service.lifecycle.registered.v0` | event | Core | M-Log, M-Policy, M-UI BFF | `ServiceRegisteredPayload` | at-least-once |
| `service.lifecycle.reload.requested.v0` | command | Core | target service | `ServiceReloadRequestedPayload` | at-least-once |
| `service.lifecycle.reload.failed.v0` | event | service | Core, M-Log | `ServiceReloadFailedPayload` | at-least-once |
| `node.registration.requested.v0` | command | Core | M-Policy | `NodeRegistrationRequestedPayload` | at-least-once |
| `node.registration.accepted.v0` | event | Core | M-Net, M-Log, M-UI BFF | `NodeRegistrationAcceptedPayload` | at-least-once |
| `node.status.changed.v0` | event | Core / node agent | M-Log, M-Net, M-UI BFF | `NodeStatusChangedPayload` | at-least-once |
| `mnet.network.created.v0` | event | Core | M-Net, M-Log, M-UI BFF | `MNetNetworkCreatedPayload` | at-least-once |
| `mnet.membership.joined.v0` | event | Core | M-Net, M-Log, M-UI BFF | `MNetMembershipJoinedPayload` | at-least-once |
| `task.assignment.requested.v0` | command | Core / CLI | Core, M-Log | `TaskAssignmentRequestedPayload` | at-least-once |
| `task.assignment.completed.v0` | event | Core | M-Log, M-UI BFF | `TaskAssignmentCompletedPayload` | at-least-once |
| `mnet.reachability.changed.v0` | event | M-Net | Core, M-Log, M-UI BFF | `MNetReachabilityChangedPayload` | at-least-once |
| `mnet.path.changed.v0` | event | M-Net | M-Log, M-UI BFF | `MNetPathChangedPayload` | at-least-once |
| `mnet.derp.fallback.changed.v0` | event | M-Net | Core, M-Log, M-Policy | `MNetDerpFallbackChangedPayload` | at-least-once |
| `config.publish.requested.v0` | command | Core / M-UI BFF / M-CLI | M-Policy | `ConfigPublishRequestedPayload` | at-least-once |
| `config.published.v0` | event | Core | target nodes, M-Log | `ConfigPublishedPayload` | at-least-once |
| `config.apply.acked.v0` | event | target node | Core, M-Log | `ConfigApplyAckedPayload` | at-least-once |
| `policy.decision.created.v0` | event | M-Policy | M-Log, Core, M-UI BFF | `PolicyDecisionCreatedPayload` | at-least-once |
| `audit.lock.required.v0` | event | M-Policy / M-Log | Core, M-UI BFF | `AuditLockRequiredPayload` | at-least-once |
| `audit.entry.created.v0` | event | M-Log | Core, M-UI BFF | `AuditEntryCreatedPayload` | at-least-once |

MVP service request/reply subjects:

| Subject | Type | Requester | Responder | Payload Schema | Timeout |
|---------|------|-----------|-----------|----------------|---------|
| `mpolicy.authorize.v0` | request/reply | Core | M-Policy | `PolicyAuthorizeRequest` / `PolicyAuthorizeResponse` | 1000ms |
| `mpolicy.decision.get.v0` | request/reply | Core | M-Policy | `PolicyDecisionGetRequest` / `PolicyDecisionGetResponse` | 1000ms |
| `mlog.timeline.write.v0` | request/reply | Core | M-Log | `TimelineWriteRequest` / `TimelineWriteResponse` | 1000ms |
| `mlog.full.write.v0` | request/reply | Core | M-Log | `FullLogWriteRequest` / `FullLogWriteResponse` | 1000ms |
| `mlog.audit.write.v0` | request/reply | Core | M-Log | `AuditWriteRequest` / `AuditWriteResponse` | 1000ms |
| `mlog.timeline.list.v0` | request/reply | Core | M-Log | `LogListRequest` / `TimelineListResponse` | 1000ms |
| `mlog.full.list.v0` | request/reply | Core | M-Log | `LogListRequest` / `FullLogListResponse` | 1000ms |
| `mlog.audit.list.v0` | request/reply | Core | M-Log | `LogListRequest` / `AuditListResponse` | 1000ms |
| `meventbus.publish.v0` | request/reply | Core | M-EventBus | `EventPublishRequest` / `EventPublishResponse` | 1000ms |
| `mnet.network.create.v0` | request/reply | Core | M-Net | `CreateNetworkRequest` / `CreateNetworkResponse` | 1000ms |
| `mnet.network.list.v0` | request/reply | Core | M-Net | `EmptyRequest` / `NetworkListResponse` | 1000ms |
| `mnet.network.join.v0` | request/reply | Core | M-Net | `JoinNetworkRequest` / `JoinNetworkResponse` | 1000ms |
| `mnet.network.members.list.v0` | request/reply | Core | M-Net | `NetworkMembersListRequest` / `NetworkMembersListResponse` | 1000ms |

---

## 4. Payload Skeletons

```ts
type CoreLifecyclePayload = {
  nodeId: string;
  startedAt: string;
  version: string;
};

type NodeStatusChangedPayload = {
  nodeId: string;
  previousStatus: "joining" | "healthy" | "degraded" | "offline" | "revoked";
  nextStatus: "joining" | "healthy" | "degraded" | "offline" | "revoked";
  reason?: string;
};

type MNetNetworkCreatedPayload = {
  networkId: string;
  name: string;
  profileVersion: string;
};

type MNetMembershipJoinedPayload = {
  networkId: string;
  nodeId: string;
  nodeKind: "stem" | "leaf";
  membershipMode: "full" | "restricted";
};

type PolicyDecisionCreatedPayload = {
  decisionId: string;
  actor: string;
  action: string;
  resource: string;
  result: string;
  reasons: string[];
};

type TaskAssignmentRequestedPayload = {
  taskId: string;
  leafNodeId: string;
  type: "noop";
  actor: string;
};

type TaskAssignmentCompletedPayload = {
  taskId: string;
  leafNodeId: string;
  type: "noop";
  completedAt: string;
};

type AuditEntryCreatedPayload = {
  auditId: string;
  actor: string;
  action: string;
  resource: string;
  decisionId?: string;
};
```

---

## 5. Failure and Retry

- Commands that mutate state must be idempotent.
- Consumers must tolerate duplicate events.
- Schema validation failure rejects the event and writes Full Log.
- High-risk validation failure writes Audit Log when an actor and resource are known.
- Dead-letter handling is required before v1 for long-running or externally triggered commands.
