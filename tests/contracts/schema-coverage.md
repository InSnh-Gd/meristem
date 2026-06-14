# Effect Schema coverage map for active events and responses

## Scope rule

- **Active emitted events** = there is a real `publish()` call in `apps/core/src/` or `services/*/src/`.
- **Active REST responses** = the route is mounted now and returns a concrete response shape in code.
- **Future deferred to Phase 20** = documented/planned contract exists, but no current publisher or no active mounted response requires it yet.
- **Not active** = no real publisher and no active mounted path in the current codebase.

## Active / implemented now

### Active emitted events

| Subject | Publisher path(s) | Effect Schema |
| --- | --- | --- |
| `core.lifecycle.started.v0` | `apps/core/src/index.ts` | `CoreLifecycleStartedPayloadSchema` |
| `core.lifecycle.degraded.v0` | `apps/core/src/routes/health.ts` | `CoreLifecycleDegradedPayloadSchema` |
| `service.lifecycle.registered.v0` | `apps/core/src/routes/services.ts` | `ServiceLifecycleRegisteredPayloadSchema` |
| `service.lifecycle.reload.requested.v0` | `apps/core/src/routes/services.ts` | `ServiceLifecycleReloadRequestedPayloadSchema` |
| `node.registration.requested.v0` | `apps/core/src/routes/nodes.ts` | `NodeRegistrationRequestedPayloadSchema` |
| `node.join-ticket.created.v0` | `apps/core/src/routes/nodes.ts` | `NodeJoinTicketCreatedPayloadSchema` |
| `node.registration.accepted.v0` | `apps/core/src/routes/nodes.ts` | `NodeRegistrationAcceptedPayloadSchema` |
| `node.status.changed.v0` | `apps/core/src/routes/nodes.ts` | `NodeStatusChangedPayloadSchema` |
| `mnet.network.created.v0` | `apps/core/src/routes/networks.ts` | `MNetNetworkCreatedPayloadSchema` |
| `mnet.membership.joined.v0` | `apps/core/src/routes/networks.ts` | `MNetMembershipJoinedPayloadSchema` |
| `mnet.profile.enable.requested.v0` | `services/m-net/src/app.ts` | `MNetProfileEventPayloadSchema` |
| `mnet.profile.enabled.v0` | `services/m-net/src/app.ts` | `MNetProfileEventPayloadSchema` |
| `mnet.profile.disable.requested.v0` | `services/m-net/src/app.ts` | `MNetProfileEventPayloadSchema` |
| `mnet.profile.disabled.v0` | `services/m-net/src/app.ts` | `MNetProfileEventPayloadSchema` |
| `mnet.profile.apply_failed.v0` | `services/m-net/src/app.ts` | `MNetProfileEventPayloadSchema` |
| `mnet.profile.enable.canceled.v0` | `services/m-net/src/app.ts` | `MNetProfileEventPayloadSchema` |
| `task.requested.v0` | `services/m-task/src/app.ts` | `TaskLifecycleEventPayloadSchema` |
| `task.queued.v0` | `services/m-task/src/app.ts` | `TaskLifecycleEventPayloadSchema` |
| `task.dispatched.v0` | `services/m-task/src/app.ts` | `TaskLifecycleEventPayloadSchema` |
| `task.running.v0` | `services/m-task/src/app.ts` | `TaskLifecycleEventPayloadSchema` |
| `task.completed.v0` | `services/m-task/src/app.ts` | `TaskLifecycleEventPayloadSchema` |
| `task.failed.v0` | `services/m-task/src/app.ts` | `TaskLifecycleEventPayloadSchema` |
| `task.canceled.v0` | `services/m-task/src/app.ts` | `TaskLifecycleEventPayloadSchema` |
| `task.operation.suspended.v0` | `services/m-task/src/app.ts` | `TaskOperationSuspendedPayloadSchema` |
| `task.operation.resumed.v0` | `services/m-task/src/app.ts` | `TaskOperationResumedPayloadSchema` |
| `task.operation.resume.failure.v0` | `services/m-task/src/app.ts` | `TaskOperationResumeFailurePayloadSchema` |
| `task.operation.rejected.v0` | `services/m-task/src/app.ts` | `TaskOperationRejectedPayloadSchema` |
| `policy.approval.created.v0` | `services/m-policy/src/approvals.ts` | `PolicyApprovalEventPayloadSchema` |
| `policy.approval.approved.v0` | `services/m-policy/src/approvals.ts` | `PolicyApprovalEventPayloadSchema` |
| `policy.approval.rejected.v0` | `services/m-policy/src/approvals.ts` | `PolicyApprovalEventPayloadSchema` |
| `policy.approval.expired.v0` | `services/m-policy/src/approvals.ts` | `PolicyApprovalEventPayloadSchema` |
| `policy.decision.created.v0` | `services/m-policy/src/index.ts` | `PolicyDecisionCreatedEventPayloadSchema` |
| `audit.entry.created.v0` | `services/m-log/src/index.ts`, `services/m-policy/src/index.ts` | `AuditEntryCreatedEventPayloadSchema` |
| `extension.definition.registered.v0` | `services/m-extension/src/app.ts` | `MExtensionLifecyclePayloadSchema` |
| `extension.definition.rejected.v0` | `services/m-extension/src/app.ts` | `MExtensionLifecyclePayloadSchema` |
| `extension.instance.enabled.v0` | `services/m-extension/src/app.ts` | `MExtensionLifecyclePayloadSchema` |
| `extension.instance.disabled.v0` | `services/m-extension/src/app.ts` | `MExtensionLifecyclePayloadSchema` |
| `extension.instance.enable_failed.v0` | `services/m-extension/src/app.ts` | `MExtensionLifecyclePayloadSchema` |
| `extension.instance.disable_failed.v0` | `services/m-extension/src/app.ts` | `MExtensionLifecyclePayloadSchema` |

### Active REST responses

| Route / response family | Effect Schema |
| --- | --- |
| Core health/session/ready/status | `HealthResponseSchema`, `SessionResponseSchema`, `ReadyResponseSchema`, `StatusResponseSchema` |
| Core service routes | `ServiceRegisterResponseSchema`, `ServiceListResponseSchema`, `ServiceReloadResponseSchema` |
| Core node routes | `CreateNodeTicketResponseSchema`, `RegisterNodeResponseSchema`, `IssueNodeCredentialResponseSchema`, `NodeListResponseSchema`, `NodeDetailResponseSchema` |
| Core network routes | `CreateNetworkResponseSchema`, `NetworkListResponseSchema`, `JoinNetworkResponseSchema`, `NetworkMembersResponseSchema` |
| Core policy/log/projection routes | `PolicyDecisionResponseSchema`, `TimelineLogListResponseSchema`, `FullLogListResponseSchema`, `AuditLogListResponseSchema`, `TimelineLogSearchResponseSchema`, `FullLogSearchResponseSchema`, `AuditLogSearchResponseSchema`, `ProjectionHealthResponseSchema`, `BackfillResultSchema`, `ProjectionDLQResponseSchema`, `ProjectionReplayResponseSchema`, `ProjectionSkipResponseSchema` |
| Identity routes | `IdentityActorListResponseSchema`, `IdentityActorDetailResponseSchema`, `IssueActorTokenRouteResponseSchema`, `InspectActorTokenResponseSchema`, `RevokeActorTokenCompatResponseSchema`, `InternalTokenIntrospectionResponseSchema` |
| SecretRef routes | `SecretListResponseSchema`, `SecretDetailResponseSchema`, `SecretCreateResponseSchema`, `SecretRotateResponseSchema`, `SecretDisableResponseSchema`, `SecretReferenceResponseSchema` |
| Config routes | `ConfigListResponseSchema`, `ConfigDetailResponseSchema`, `ConfigDraftResponseSchema`, `ConfigValidateResponseSchema`, `ConfigPublishResponseSchema`, `ConfigRollbackResponseSchema`, `ConfigApplyAckResponseSchema` |
| M-Net profile routes | `MNetProfileListResponseSchema`, `MNetRegionalProfileSchema`, `SetNetworkProfileResponseSchema`, `InternalNetworkProfileResumeResponseSchema`, `InternalNetworkProfileRejectResponseSchema` |
| M-Policy approval routes | `ApprovalCreateResponseSchema`, `ApprovalListResponseSchema`, `ApprovalDetailResponseSchema`, `ApprovalActionResponseSchema` |
| M-Extension routes | `ExtensionListResponseSchema`, `ExtensionDetailResponseSchema`, `RegisterExtensionResponseSchema`, `ExtensionInstanceControlResponseSchema` |
| M-Task routes | `TaskDefinitionsResponseSchema`, `TaskListResponseSchema`, `SubmitTaskResponseSchema`, `TaskStatusResponseSchema`, `TaskControlResponseSchema`, `TaskRetryNotImplementedResponseSchema`, `InternalTaskOperationResumeResponseSchema`, `InternalTaskOperationRejectResponseSchema`, `NodeAgentTaskExecuteEnvelopeResponseSchema` |

### Executable proof

- `tests/contracts/schema-coverage.contract.test.ts` round-trips every active emitted event subject above.
- The same contract test round-trips every active response schema listed above, including `SetNetworkProfileResponseSchema`.

## Non-active / deferred to Phase 20

These documented event catalog entries currently have **no real publisher** in the active codebase, so their payload contracts stay explicitly deferred to Phase 20 rather than being treated as implemented now.

- `service.lifecycle.reload.failed.v0`
- `task.cancel.requested.v0`
- `task.timed_out.v0`
- `task.retry.requested.v0`
- `task.retry.rejected.v0`
- `config.publish.requested.v0`
- `config.published.v0`
- `config.apply.acked.v0`
- `config.validated.v0`
- `config.apply.failed.v0`
- `config.rollback.requested.v0`
- `config.rolled_back.v0`
- `identity.token.issued.v0`
- `identity.token.revoked.v0`
- `secret.ref.created.v0`
- `secret.ref.rotated.v0`
- `secret.ref.disabled.v0`
- `mnet.reachability.changed.v0`
- `mnet.path.changed.v0`
- `mnet.derp.fallback.changed.v0`
- `audit.lock.required.v0`

## Explicit exclusions from this wave

- No fake publishers were added.
- No inactive event catalog entries were implemented just to reach parity with docs.
- No active emitted event or active mounted response was deferred to Phase 20.
