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
| `service.lifecycle.reload.failed.v0` | deferred event | service | Core, M-Log | `ServiceReloadFailedPayload` | reserved until a real publisher is wired |
| `node.registration.requested.v0` | command | Core | M-Policy | `NodeRegistrationRequestedPayload` | at-least-once |
| `node.registration.accepted.v0` | event | Core | M-Net, M-Log, M-UI BFF | `NodeRegistrationAcceptedPayload` | at-least-once |
| `node.join-ticket.created.v0` | event | Core | M-Net, M-Log, M-UI BFF | `NodeJoinTicketCreatedPayload` | at-least-once |
| `node.role.changed.v0` | event | M-Net | M-Log, M-UI BFF | `NodeRoleChangedPayload` | at-least-once |
| `node.status.changed.v0` | event | Core / M-Net | M-Log, M-UI BFF | `NodeStatusChangedPayload` | at-least-once |
| `mnet.network.created.v0` | event | Core | M-Net, M-Log, M-UI BFF | `MNetNetworkCreatedPayload` | at-least-once |
| `mnet.membership.joined.v0` | event | Core | M-Net, M-Log, M-UI BFF | `MNetMembershipJoinedPayload` | at-least-once |
| `task.requested.v0` | event | M-Task | M-Log, M-UI BFF | `TaskRequestedPayload` | at-least-once |
| `task.queued.v0` | event | M-Task | M-Log, M-UI BFF | `TaskQueuedPayload` | at-least-once |
| `task.dispatched.v0` | event | M-Task | M-Log, M-UI BFF | `TaskDispatchedPayload` | at-least-once |
| `task.running.v0` | event | M-Task | M-Log, M-UI BFF | `TaskRunningPayload` | at-least-once |
| `task.completed.v0` | event | M-Task | M-Log, M-UI BFF | `TaskCompletedPayload` | at-least-once |
| `task.failed.v0` | event | M-Task | M-Log, M-UI BFF | `TaskFailedPayload` | at-least-once |
| `task.cancel.requested.v0` | event | M-Task | M-Net, M-Log, M-UI BFF | `TaskCancelRequestedPayload` | at-least-once |
| `task.canceled.v0` | event | M-Task | M-Log, M-UI BFF | `TaskCanceledPayload` | at-least-once |
| `task.timed_out.v0` | event | M-Task | M-Log, M-UI BFF | `TaskTimedOutPayload` | at-least-once |
| `task.retry.requested.v0` | event | M-Task | M-Policy, M-Log | `TaskRetryRequestedPayload` | at-least-once |
| `task.retry.rejected.v0` | event | M-Task | M-Log, M-UI BFF | `TaskRetryRejectedPayload` | at-least-once |
| `mnet.reachability.changed.v0` | event | M-Net | Core, M-Log, M-UI BFF | `MNetReachabilityChangedPayload` | at-least-once |
| `mnet.path.changed.v0` | event | M-Net | M-Log, M-UI BFF | `MNetPathChangedPayload` | at-least-once |
| `mnet.wstunnel.fallback.changed.v0` | event | M-Net | Core, M-Log, M-Policy | `MNetWstunnelFallbackChangedPayload` | at-least-once |
| `mnet.network_map.published.v0` | event | M-Net | node-agent, M-Log, M-UI BFF | `MNetNetworkMapPublishedPayload` | at-least-once |
| `mnet.node_key.rotated.v0` | event | M-Net | M-Log, M-Policy, M-UI BFF | `MNetNodeKeyRotatedPayload` | at-least-once |
| `mnet.relay.assigned.v0` | event | M-Net | node-agent, M-Log, M-UI BFF | `MNetRelayAssignedPayload` | at-least-once |
| `mnet.dataplane.tunnel.changed.v0` | event | M-Net | M-Log, M-Policy, M-UI BFF | `MNetDataplaneTunnelChangedPayload` | at-least-once |
| `config.publish.requested.v0` | command | Core | domain services, M-Log, M-Policy | `ConfigPublishRequestedPayload` | at-least-once |
| `config.published.v0` | event | Core | domain services, M-Log, M-Policy | `ConfigPublishedPayload` | at-least-once |
| `config.apply.acked.v0` | event | Core | domain services, M-Log, M-Policy | `ConfigApplyAckedPayload` | at-least-once |
| `policy.decision.created.v0` | event | M-Policy | M-Log, Core, M-UI BFF | `PolicyDecisionCreatedPayload` | at-least-once |
| `extension.definition.registered.v0` | event | M-Extension | M-Log, M-UI BFF | `ExtensionDefinitionRegisteredPayload` | at-least-once |
| `extension.definition.rejected.v0` | event | M-Extension | M-Log, M-UI BFF | `ExtensionDefinitionRejectedPayload` | at-least-once |
| `extension.instance.enabled.v0` | event | M-Extension | M-Log, M-UI BFF | `ExtensionInstanceEnabledPayload` | at-least-once |
| `extension.instance.disabled.v0` | event | M-Extension | M-Log, M-UI BFF | `ExtensionInstanceDisabledPayload` | at-least-once |
| `extension.instance.enable_failed.v0` | event | M-Extension | M-Log, M-UI BFF | `ExtensionInstanceEnableFailedPayload` | at-least-once |
| `extension.instance.disable_failed.v0` | event | M-Extension | M-Log, M-UI BFF | `ExtensionInstanceDisableFailedPayload` | at-least-once |
| `identity.token.issued.v0` | event | Core | M-Log, M-UI BFF | `IdentityTokenIssuedPayload` | at-least-once |
| `identity.token.revoked.v0` | event | Core | M-Log, M-UI BFF | `IdentityTokenRevokedPayload` | at-least-once |
| `secret.ref.created.v0` | event | Core | M-Log, M-UI BFF | `SecretRefCreatedPayload` | at-least-once |
| `secret.ref.rotated.v0` | event | Core | M-Log, M-UI BFF | `SecretRefRotatedPayload` | at-least-once |
| `secret.ref.disabled.v0` | event | Core | M-Log, M-UI BFF | `SecretRefDisabledPayload` | at-least-once |
| `config.validated.v0` | event | Core | domain services, M-Log, M-Policy | `ConfigValidatedPayload` | at-least-once |
| `config.apply.failed.v0` | event | Core | domain services, M-Log, M-Policy | `ConfigApplyFailedPayload` | at-least-once |
| `config.rollback.requested.v0` | command | Core | domain services, M-Log, M-Policy | `ConfigRollbackRequestedPayload` | at-least-once |
| `config.rolled_back.v0` | event | Core | domain services, M-Log, M-Policy | `ConfigRolledBackPayload` | at-least-once |
| `audit.lock.required.v0` | event | M-Policy / M-Log | Core, M-UI BFF | `AuditLockRequiredPayload` | at-least-once |
| `audit.entry.created.v0` | event | M-Log | Core, M-UI BFF | `AuditEntryCreatedPayload` | at-least-once |
| `meventbus.publish.rejected.v0` | event | M-EventBus | M-Log | `EventBusRejectedPayload` | at-least-once |
| `meventbus.publish.failed.v0` | event | M-EventBus | M-Log | `EventBusPublishFailedPayload` | at-least-once |

EventBus operational subjects preserve publish attribution when available:

- `callerService` mirrors the original publisher `source` explicitly for operational consumers.
- `actor` is copied from the original event payload only when the payload exposes a stable actor field.
- `eventType`, `correlationId`, `traceId`, and `causationId` remain available so M-Log can join transport failures back to the originating workflow.

EventBus publish counters are exported separately from NATS subjects through the loopback metrics route `GET /internal/v0/metrics/publish-summary`; the control-room overview consumes that read model rather than inferring counts from Full Log replay.

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
  previousStatus:
    | "joining"
    | "healthy"
    | "degraded"
    | "offline"
    | "disabled"
    | "isolated"
    | "recovering"
    | "revoked";
  nextStatus:
    | "joining"
    | "healthy"
    | "degraded"
    | "offline"
    | "disabled"
    | "isolated"
    | "recovering"
    | "revoked";
  reason?: string;
};

type NodeRoleChangedPayload = {
  nodeId: string;
  previousKind: "stem" | "leaf";
  nextKind: "stem" | "leaf";
  reason: string;
};

type JoinRedeemMessage = {
  type: "join.redeem";
  ticket: string;
};

type SessionResumeMessage = {
  type: "session.resume";
  nodeId: string;
  token: string;
};

type SessionHeartbeatMessage = {
  type: "heartbeat";
  sessionId: string;
  agentVersion: string;
  reportedStatus: "healthy" | "degraded";
  timestamp: string;
};

type SessionLogForwardMessage = {
  type: "log.forward";
  sessionId: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  timestamp: string;
  correlationId?: string;
  traceId?: string;
  payload?: unknown;
};

type SessionTaskResultMessage = {
  type: "task.result";
  sessionId: string;
  taskId: string;
  result: "completed";
  completedAt: string;
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

type MNetNetworkMapMember = {
  nodeId: string;
  tunnelIp: string;
  publicKeyFingerprint: string;
};

type MNetNetworkMapRelayAssignment = {
  relayType: "wstunnel" | "direct";
  relayEndpoint: string;
  nodeIds: string[];
};

type MNetAclRule = {
  ruleId: string;
  action: "allow" | "deny";
  sourceNodeId: string;
  targetNodeId: string;
  protocol: "any" | "tcp" | "udp" | "icmp";
};

type MNetReachabilityChangedPayload = {
  networkId: string;
  nodeId: string;
  reachable: boolean;
  latencyMs?: number;
  checkedAt: string;
  correlationId: string;
};

type MNetPathChangedPayload = {
  networkId: string;
  nodeId: string;
  pathType: "direct" | "relay" | "none";
  previousPathType: "direct" | "relay" | "none";
  relayEndpoint?: string;
  correlationId: string;
};

type MNetDerpFallbackChangedPayload = {
  networkId: string;
  nodeId: string;
  fallbackActive: boolean;
  reason: string;
  correlationId: string;
};

type MNetNetworkMapPublishedPayload = {
  networkId: string;
  mapVersion: string;
  members: MNetNetworkMapMember[];
  relayAssignment: MNetNetworkMapRelayAssignment;
  aclRules: MNetAclRule[];
  expiresAt: string;
  signedBy: string;
  correlationId: string;
};

type MNetNodeKeyRotatedPayload = {
  nodeId: string;
  oldKeyFingerprint: string;
  newKeyFingerprint: string;
  rotationReason: string;
  actor: string;
  correlationId: string;
  auditId: string;
};

type MNetRelayAssignedPayload = {
  networkId: string;
  nodeId: string;
  relayEndpoint: string;
  relayType: "wstunnel" | "direct";
  correlationId: string;
};

type MNetDataplaneTunnelChangedPayload = {
  networkId: string;
  nodeId: string;
  tunnelStatus: "up" | "down" | "degraded";
  previousStatus: "up" | "down" | "degraded";
  reason: string;
  correlationId: string;
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

type EventBusRejectedPayload = {
  failedSubject: string;
  eventId?: string;
  source?: string;
  correlationId?: string;
  traceId?: string;
  reason: 'invalid_envelope' | 'subject_not_allowed' | 'subject_mismatch';
  errors: string[];
  originalEvent: unknown;
};

type EventBusPublishFailedPayload = {
  failedSubject: string;
  eventId: string;
  source: string;
  correlationId?: string;
  traceId?: string;
  reason: 'publish_failed';
  attempts: number;
  errorMessage: string;
  originalEvent: unknown;
  actor?: string;
};

type ExtensionLifecyclePayload = {
  extensionId: string;
  manifestVersion: string;
  kind: "metadata-only" | "webhook-declared" | "wasm-placeholder" | "http-callback-placeholder";
  actor: string;
  decisionId: string;
  scopeType: "system";
  scopeId: "default";
  reason?: string;
  correlationId?: string;
};

type ExtensionDefinitionRegisteredPayload = ExtensionLifecyclePayload;

type ExtensionDefinitionRejectedPayload = ExtensionLifecyclePayload & {
  errorCode: string;
};

type ExtensionInstanceEnabledPayload = ExtensionLifecyclePayload;

type ExtensionInstanceDisabledPayload = ExtensionLifecyclePayload;

type ExtensionInstanceEnableFailedPayload = ExtensionLifecyclePayload & {
  errorCode: string;
};

type ExtensionInstanceDisableFailedPayload = ExtensionLifecyclePayload & {
  errorCode: string;
};

type IdentityTokenLifecyclePayload = {
  jti: string;
  actor: string;
  performedBy: string;
  reason?: string;
  correlationId?: string;
};

type IdentityTokenIssuedPayload = IdentityTokenLifecyclePayload;
type IdentityTokenRevokedPayload = IdentityTokenLifecyclePayload;

type SecretRefLifecyclePayload = {
  secretRefId: string;
  scope: "system" | "service" | "node";
  actor: string;
  decisionId: string;
  reason?: string;
  correlationId?: string;
};

type SecretRefCreatedPayload = SecretRefLifecyclePayload;
type SecretRefRotatedPayload = SecretRefLifecyclePayload;
type SecretRefDisabledPayload = SecretRefLifecyclePayload;

type ConfigLifecyclePayload = {
  configId: string;
  configVersion: string;
  configHash: string;
  domain: string;
  actor: string;
  decisionId?: string;
  reason?: string;
  correlationId?: string;
};

type ConfigValidatedPayload = ConfigLifecyclePayload;
type ConfigPublishRequestedPayload = ConfigLifecyclePayload;
type ConfigPublishedPayload = ConfigLifecyclePayload;
type ConfigApplyAckedPayload = ConfigLifecyclePayload & {
  targetService: string;
  ackedAt?: string;
};
type ConfigApplyFailedPayload = ConfigLifecyclePayload & { errorCode: string };
type ConfigRollbackRequestedPayload = ConfigLifecyclePayload & { rollbackVersion: string };
type ConfigRolledBackPayload = ConfigLifecyclePayload & { rollbackVersion: string };
```

---

## 5. Failure and Retry

- Commands that mutate state must be idempotent.
- Consumers must tolerate duplicate events.
- Schema validation failure rejects the event and writes Full Log.
- High-risk validation failure writes Audit Log when an actor and resource are known.
- Dead-letter handling is required before v1 for long-running or externally triggered commands.

### Approval Lifecycle Events

| Subject | Type | Publisher | Subscribers | Payload Schema | Delivery |
|---------|------|-----------|-------------|----------------|----------|
| `policy.approval.created.v0` | event | M-Policy | M-Log, M-UI BFF | `PolicyApprovalCreatedPayload` | at-least-once |
| `policy.approval.approved.v0` | event | M-Policy | M-Task, M-Log, M-UI BFF | `PolicyApprovalApprovedPayload` | at-least-once |
| `policy.approval.rejected.v0` | event | M-Policy | M-Task, M-Log, M-UI BFF | `PolicyApprovalRejectedPayload` | at-least-once |
| `policy.approval.expired.v0` | event | M-Policy | M-Task, M-Log, M-UI BFF | `PolicyApprovalExpiredPayload` | at-least-once |
| `policy.approval.canceled.v0` | event | M-Policy | M-Task, M-Log, M-UI BFF | `PolicyApprovalCanceledPayload` | at-least-once |
| `task.operation.suspended.v0` | event | M-Task | M-Log, M-UI BFF | `TaskOperationSuspendedPayload` | at-least-once |
| `task.operation.resumed.v0` | event | M-Task | M-Log, M-UI BFF | `TaskOperationResumedPayload` | at-least-once |
| `task.operation.resume.failure.v0` | event | M-Task | M-Log, M-UI BFF | `TaskOperationResumeFailurePayload` | at-least-once |
| `task.operation.rejected.v0` | event | M-Task | M-Log, M-UI BFF | `TaskOperationRejectedPayload` | at-least-once |

### Vote-Level Events (active)

Vote-level events capture individual actor votes as distinct facts, independent of approval lifecycle terminal events. These events power read-model projections and the approval profile UI without coupling to lifecycle state-machine transitions.

| Subject | Type | Publisher | Subscribers | Payload Schema | Delivery |
|---------|------|-----------|-------------|----------------|----------|
| `policy.approval.vote.approved.v0` | event | M-Policy | M-Log, M-UI BFF, projections | `PolicyApprovalVoteEventPayload` | at-least-once |
| `policy.approval.vote.rejected.v0` | event | M-Policy | M-Log, M-UI BFF, projections | `PolicyApprovalVoteEventPayload` | at-least-once |

> `approval.comment.*` subjects remain deferred and are **not active** in this wave.

```ts
type PolicyApprovalVoteEventPayload = {
  approvalId: string;
  actor: string;
  vote: 'approve' | 'reject';
  reason?: string;
  timestamp: string;
};
```

Approval authorization and resume execution are distinct facts. `policy.approval.approved.v0` does not imply the origin operation executed; `task.operation.resumed.v0` or `task.operation.resume.failure.v0` records the business execution result.

```ts
type PolicyApprovalCreatedPayload = {
  approvalId: string;
  policyDecisionId: string;
  originService: string;
  operationId: string;
  requestedBy: string;
  requiredAction: 'manual_review' | 'multi_approval';
  quorumRequired: number;
  expiresAt: string;
  correlationId?: string;
};

type PolicyApprovalApprovedPayload = {
  approvalId: string;
  policyDecisionId: string;
  correlationId?: string;
};

type PolicyApprovalRejectedPayload = {
  approvalId: string;
  policyDecisionId: string;
  correlationId?: string;
};

type PolicyApprovalExpiredPayload = {
  approvalId: string;
  policyDecisionId: string;
  correlationId?: string;
};

type PolicyApprovalCanceledPayload = {
  approvalId: string;
  policyDecisionId: string;
  correlationId?: string;
};

type TaskOperationSuspendedPayload = {
  suspendedOpId: string;
  policyDecisionId: string;
  action: string;
  resource: string;
  actor: string;
  correlationId?: string;
};

type TaskOperationResumedPayload = {
  suspendedOpId: string;
  action: string;
  resource: string;
  taskId?: string;
  correlationId?: string;
};

type TaskOperationResumeFailurePayload = {
  suspendedOpId: string;
  reason: string;
  correlationId?: string;
};

type TaskOperationRejectedPayload = {
  suspendedOpId: string;
  action: string;
  resource: string;
  correlationId?: string;
};

### M-Net Profile Lifecycle Events

| Subject | Type | Publisher | Subscribers | Payload Schema | Delivery |
|---------|------|-----------|-------------|----------------|----------|
| `mnet.profile.enable.requested.v0` | event | M-Net | M-Policy, M-Log, M-UI BFF | `MNetProfileEnableRequestedPayload` | at-least-once |
| `mnet.profile.enabled.v0` | event | M-Net | M-Log, M-UI BFF | `MNetProfileEnabledPayload` | at-least-once |
| `mnet.profile.disable.requested.v0` | event | M-Net | M-Log, M-UI BFF | `MNetProfileDisableRequestedPayload` | at-least-once |
| `mnet.profile.disabled.v0` | event | M-Net | M-Log, M-UI BFF | `MNetProfileDisabledPayload` | at-least-once |
| `mnet.profile.apply_failed.v0` | event | M-Net | M-Log, M-UI BFF | `MNetProfileApplyFailedPayload` | at-least-once |
| `mnet.profile.enable.canceled.v0` | event | M-Net | M-Log, M-UI BFF | `MNetProfileEnableCanceledPayload` | at-least-once |
| `mnet.profile.defaults.updated.v0` | event | M-Net | M-Log, M-UI BFF | `MNetProfileDefaultsUpdatedEventPayload` | at-least-once |

All profile events use singular `profile` in the subject. Events are emitted after PostgreSQL state changes; they do not replace PostgreSQL as the authoritative state.

Events published by M-Net through M-EventBus; subscribers consume through NATS.

```ts
type MNetProfileEventPayload = {
  networkId: string;
  fromProfileVersion: string;
  toProfileVersion: string;
  actor: string;
  policyDecisionId: string;
  approvalId?: string;
  operationId?: string;
  correlationId: string;
  reason: string;
  controlPlaneOnly: true;
};

type MNetProfileEnableRequestedPayload = MNetProfileEventPayload;
type MNetProfileEnabledPayload = MNetProfileEventPayload;
type MNetProfileDisableRequestedPayload = MNetProfileEventPayload;
type MNetProfileDisabledPayload = MNetProfileEventPayload;
type MNetProfileDefaultsUpdatedEventPayload = {
  defaultProfileVersion: string;
  actor: string;
  reason: string;
  correlationId: string;
  controlPlaneOnly: boolean;
  migrationOperationId?: string;
};

type MNetProfileApplyFailedPayload = MNetProfileEventPayload & {
  errorCode: string;
};

type MNetProfileEnableCanceledPayload = MNetProfileEventPayload;
```
