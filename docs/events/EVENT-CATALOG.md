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
  traceId?: string;
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
| `node.join-ticket.created.v0` | event | Core | M-Net, M-Log, M-UI BFF | `NodeJoinTicketCreatedPayload` | at-least-once |
| `node.status.changed.v0` | event | Core / M-Net | M-Log, M-UI BFF | `NodeStatusChangedPayload` | at-least-once |
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

MVP sync HTTP/Eden boundaries:

| Boundary | Transport | Notes |
|----------|-----------|-------|
| Core -> M-Policy | loopback HTTP + Eden + internal token | `/internal/v0/authorize`, `/internal/v0/decisions/:id` |
| Core -> M-Log | loopback HTTP + Eden + internal token | `/internal/v0/timeline`, `/internal/v0/full`, `/internal/v0/audit` |
| Core -> M-EventBus | loopback HTTP + Eden + internal token | `/internal/v0/publish` |
| Core -> M-Net | loopback HTTP + Eden + internal token | `/internal/v0/networks`, `/internal/v0/networks/:id/members`, `/internal/v0/tasks/noop` |
| node-agent -> M-Net | public TLS + WebSocket session protocol | `/join/v0/session` with `join.redeem`, `session.resume`, `heartbeat`, `log.forward`, `task.result` |

---

## 4. Payload Skeletons

```ts
type CoreLifecyclePayload = {
  nodeId: string;
  startedAt: string;
  version: string;
};

type ServiceRegisteredPayload = {
  serviceId: string;
  version: string;
  domain: string;
  kind: string;
};

type ServiceReloadRequestedPayload = {
  serviceId: string;
  actor: string;
  reason?: string;
};

type ServiceReloadFailedPayload = {
  serviceId: string;
  actor: string;
  reason?: string;
  errorCode: string;
  errorMessage: string;
};

type NodeStatusChangedPayload = {
  nodeId: string;
  previousStatus: "joining" | "healthy" | "degraded" | "offline" | "revoked";
  nextStatus: "joining" | "healthy" | "degraded" | "offline" | "revoked";
  reason?: string;
};

type NodeAgentHeartbeatPayload = {
  nodeId: string;
  token: string;
  agentVersion: string;
  reportedStatus: "healthy" | "degraded";
  timestamp: string;
};

type NodeAgentLogPayload = {
  nodeId: string;
  token: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  timestamp: string;
  correlationId?: string;
  traceId?: string;
  payload?: unknown;
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
