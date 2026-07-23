# Deferred Event Gap Map

> Checked-in map of every event catalog subject that remains deferred after the current contract baseline.
> A subject is deferred when it has neither a real `publish()` call nor an explicitly contract-activated schema/fixture mapping.
> This map is a deferred-coverage audit artifact; it does not add schemas, publishers, or fixtures.
> M-Net closed-loop subjects are active through durable event-intent publishers and are not part of this deferred map.

---

## Scope

- `EVENT-CATALOG.md` remains the canonical event registry.
- This file is a checked-in audit map of catalog subjects that are still deferred in the active codebase.
- Active publisher subjects have Effect Schema coverage and are intentionally absent from this contract-gap table.
- M-Net closed-loop subjects are active publishers because their authoritative mutations transactionally persist durable event intents and the production composition retries pending delivery.
- The scanner behind `getActivePublisherSubjects()` reads literal subjects from `publish()`, `publishTaskEvent()`, `publish.post({ subject: ... })`, workflow subject options, durable event-intent objects, and known dynamic helpers in `services/m-extension/src/`. `getActiveCoverageSubjects()` additionally includes versioned schema and fixture mappings.

## Deferred event gap map

| Subject | Domain | Catalog publisher | Current publisher status | Effect Schema status | Test fixture status | Owner | Reason deferred | Reopen trigger | Deferred-work action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `service.lifecycle.reload.failed.v0` | service lifecycle | service | no active publisher in active codebase | deferred, no Effect Schema in packages/contracts | deferred, no contract test fixture | Core / service lifecycle | Service reload failure path is not wired to emit this event yet. | When service reload failure handling is implemented and a real publisher exists. | deferred, implement when real publisher exists |
| `task.cancel.requested.v0` | task lifecycle | M-Task | no active publisher in active codebase | deferred, no Effect Schema in packages/contracts | deferred, no contract test fixture | M-Task | Running-task cancellation only transitions to `task.canceled.v0`; the explicit cancel-requested event is not emitted. | When M-Task implements running-task cancellation hardening and emits this subject. | deferred, implement when real publisher exists |
| `task.timed_out.v0` | task lifecycle | M-Task | no active publisher in active codebase | deferred, no Effect Schema in packages/contracts | deferred, no contract test fixture | M-Task | The timeout worker currently transitions tasks to failed without a distinct timed-out event. | When M-Task introduces explicit timeout as a lifecycle event with a real publisher. | deferred, implement when real publisher exists |
| `task.retry.requested.v0` | task lifecycle | M-Task | no active publisher in active codebase | deferred, no Effect Schema in packages/contracts | deferred, no contract test fixture | M-Task | Real retry execution is deferred (see `DFW-007`). | When real M-Task retry execution is implemented. | deferred, implement when real publisher exists |
| `task.retry.rejected.v0` | task lifecycle | M-Task | no active publisher in active codebase | deferred, no Effect Schema in packages/contracts | deferred, no contract test fixture | M-Task | Real retry execution is deferred (see `DFW-007`). | When real M-Task retry execution is implemented. | deferred, implement when real publisher exists |
| `config.publish.requested.v0` | config | Core | no active publisher in active codebase | deferred, no Effect Schema in packages/contracts | deferred, no contract test fixture | Core / config subsystem | Generic config lifecycle subsystem is deferred (see `DFW-012`). | When Core implements config publish command and emits this subject. | deferred, implement when real publisher exists |
| `config.published.v0` | config | Core | no active publisher in active codebase | deferred, no Effect Schema in packages/contracts | deferred, no contract test fixture | Core / config subsystem | Generic config lifecycle subsystem is deferred (see `DFW-012`). | When Core implements config publish confirmation and emits this subject. | deferred, implement when real publisher exists |
| `config.apply.acked.v0` | config | Core | no active publisher in active codebase | deferred, no Effect Schema in packages/contracts | deferred, no contract test fixture | Core / config subsystem | Generic config lifecycle subsystem is deferred (see `DFW-012`). | When Core implements node-level config apply acknowledgement. | deferred, implement when real publisher exists |
| `config.validated.v0` | config | Core | no active publisher in active codebase | deferred, no Effect Schema in packages/contracts | deferred, no contract test fixture | Core / config subsystem | Generic config lifecycle subsystem is deferred (see `DFW-012`). | When Core implements config validation and emits this subject. | deferred, implement when real publisher exists |
| `config.apply.failed.v0` | config | Core | no active publisher in active codebase | deferred, no Effect Schema in packages/contracts | deferred, no contract test fixture | Core / config subsystem | Generic config lifecycle subsystem is deferred (see `DFW-012`). | When Core implements config apply failure handling. | deferred, implement when real publisher exists |
| `config.rollback.requested.v0` | config | Core | no active publisher in active codebase | deferred, no Effect Schema in packages/contracts | deferred, no contract test fixture | Core / config subsystem | Generic config lifecycle subsystem is deferred (see `DFW-012`). | When Core implements config rollback command. | deferred, implement when real publisher exists |
| `config.rolled_back.v0` | config | Core | no active publisher in active codebase | deferred, no Effect Schema in packages/contracts | deferred, no contract test fixture | Core / config subsystem | Generic config lifecycle subsystem is deferred (see `DFW-012`). | When Core implements config rollback confirmation. | deferred, implement when real publisher exists |
| `identity.token.issued.v0` | identity | Core | no active publisher in active codebase | deferred, no Effect Schema in packages/contracts | deferred, no contract test fixture | Core / security | Production identity integration is deferred (see `DFW-027`); Core does not yet emit token lifecycle events. | When Core identity service emits token issued events. | deferred, implement when real publisher exists |
| `identity.token.revoked.v0` | identity | Core | no active publisher in active codebase | deferred, no Effect Schema in packages/contracts | deferred, no contract test fixture | Core / security | Production identity integration is deferred (see `DFW-027`); Core does not yet emit token lifecycle events. | When Core identity service emits token revoked events. | deferred, implement when real publisher exists |
| `secret.ref.created.v0` | SecretRef | Core | no active publisher in active codebase | deferred, no Effect Schema in packages/contracts | deferred, no contract test fixture | Core / security | SecretRef v0.1 control plane does not yet publish lifecycle events (see `DFW-028`). | When SecretRef lifecycle emits creation events. | deferred, implement when real publisher exists |
| `secret.ref.rotated.v0` | SecretRef | Core | no active publisher in active codebase | deferred, no Effect Schema in packages/contracts | deferred, no contract test fixture | Core / security | SecretRef v0.1 control plane does not yet publish lifecycle events (see `DFW-028`). | When SecretRef lifecycle emits rotation events. | deferred, implement when real publisher exists |
| `secret.ref.disabled.v0` | SecretRef | Core | no active publisher in active codebase | deferred, no Effect Schema in packages/contracts | deferred, no contract test fixture | Core / security | SecretRef v0.1 control plane does not yet publish lifecycle events (see `DFW-028`). | When SecretRef lifecycle emits disable events. | deferred, implement when real publisher exists |
| `policy.approval.canceled.v0` | approval lifecycle | M-Policy | no active publisher in active codebase | deferred, no Effect Schema in packages/contracts | deferred, no contract test fixture | M-Policy | Approval cancellation is cataloged as a future lifecycle fact, but current approval flows create, approve, reject, or expire only. | When M-Policy implements real approval cancellation and emits this subject. | deferred, implement when real publisher exists |
| `audit.lock.required.v0` | audit | M-Policy / M-Log | no active publisher in active codebase | deferred, no Effect Schema in packages/contracts | deferred, no contract test fixture | M-Policy / M-Log | Audit lock workflow is not yet implemented. | When audit lock policy workflow is implemented and emits this subject. | deferred, implement when real publisher exists |
| `mdeploy.apply.failed.v0` | M-Deploy | M-Deploy | no active publisher in active codebase | draft schema exists, publisher deferred | draft fixture exists | M-Deploy | M-Deploy is a post-v0.1 production-track contract and has no active publisher yet. | When M-Deploy apply failure is wired to EventBus. | deferred, implement when real publisher exists |
| `mdeploy.rollback.failed.v0` | M-Deploy | M-Deploy | no active publisher in active codebase | draft schema exists, publisher deferred | draft fixture exists | M-Deploy | M-Deploy is a post-v0.1 production-track contract and has no active publisher yet. | When M-Deploy rollback failure is wired to EventBus. | deferred, implement when real publisher exists |
| `mdeploy.drift.resolved.v0` | M-Deploy | M-Deploy | no active publisher in active codebase | draft schema exists, publisher deferred | draft fixture exists | M-Deploy | M-Deploy is a post-v0.1 production-track contract and has no active publisher yet. | When M-Deploy drift resolution is wired to EventBus. | deferred, implement when real publisher exists |
---

## Consistency check

`tests/contracts/schema-coverage.deferred-map.contract.test.ts` enforces:

- Every subject listed in `tests/contracts/schema-coverage.md` under `## Non-active / deferred to post-v0.1 coverage` appears in the table above.
- No active subject (from `tests/contracts/schema-coverage.md` active table or from the source scanner) appears in the table above.

The test validates this audit map against the catalog and implementation scan; it does not replace `EVENT-CATALOG.md` as the contract authority.

If either rule is violated, the contract test fails.
