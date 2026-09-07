# Meristem Documentation Index

> Current implementation documents live in `docs/`; this file is navigation, not a duplicate specification. Read [`../AGENTS.md`](../AGENTS.md), [`../MERISTEM.md`](../MERISTEM.md), [`../MERISTEM-DEV.md`](../MERISTEM-DEV.md), [`../MERISTEM-ROADMAP.md`](../MERISTEM-ROADMAP.md), and [`../DEFERRED-WORK.md`](../DEFERRED-WORK.md) first.

## Canonical map

All links below are relative to this file. Listed files are active unless marked archive. Contract details and test-required facts remain in their existing documents.

| Area | Entry and documents |
| --- | --- |
| ADRs | [`adr/README.md`](adr/README.md); foundation: [`adr/ADR-F01-foundational-technology-stack.md`](adr/ADR-F01-foundational-technology-stack.md), [`adr/ADR-F02-architecture-organization.md`](adr/ADR-F02-architecture-organization.md), [`adr/ADR-F03-infrastructure-backbone.md`](adr/ADR-F03-infrastructure-backbone.md), [`adr/ADR-TOOLING-effect-platform-bun-pilot.md`](adr/ADR-TOOLING-effect-platform-bun-pilot.md); network: [`adr/ADR-N01-m-net-default-network.md`](adr/ADR-N01-m-net-default-network.md), [`adr/ADR-N02-m-net-cn-profile.md`](adr/ADR-N02-m-net-cn-profile.md), [`adr/ADR-N03-m-net-production-data-plane.md`](adr/ADR-N03-m-net-production-data-plane.md), [`adr/ADR-N04-netbird-runtime-integration.md`](adr/ADR-N04-netbird-runtime-integration.md); production: [`adr/ADR-P01-oidc-iam-architecture.md`](adr/ADR-P01-oidc-iam-architecture.md), [`adr/ADR-P02-vault-integration.md`](adr/ADR-P02-vault-integration.md), [`adr/ADR-P03-m-deploy-service.md`](adr/ADR-P03-m-deploy-service.md), [`adr/ADR-P04-production-topology.md`](adr/ADR-P04-production-topology.md); task/UI: [`adr/ADR-T01-m-task-canonical-service.md`](adr/ADR-T01-m-task-canonical-service.md), [`adr/ADR-U01-sdui-runtime-renderer-migration.md`](adr/ADR-U01-sdui-runtime-renderer-migration.md), [`adr/ADR-U02-plugin-ui-sandbox-security-model.md`](adr/ADR-U02-plugin-ui-sandbox-security-model.md) |
| Services | [`services/README.md`](services/README.md), [`services/SERVICE-DEFINITION-TEMPLATE.md`](services/SERVICE-DEFINITION-TEMPLATE.md), [`services/core.md`](services/core.md), [`services/m-cli.md`](services/m-cli.md), [`services/m-eventbus.md`](services/m-eventbus.md), [`services/m-log.md`](services/m-log.md), [`services/m-policy.md`](services/m-policy.md), [`services/m-net.md`](services/m-net.md), [`services/m-task.md`](services/m-task.md), [`services/m-extension.md`](services/m-extension.md), [`services/m-deploy.md`](services/m-deploy.md), [`services/node-agent.md`](services/node-agent.md), [`services/m-ui-bff.md`](services/m-ui-bff.md) |
| Contracts | [`contracts/README.md`](contracts/README.md), [`contracts/CONTRACT-VERSIONING.md`](contracts/CONTRACT-VERSIONING.md), [`contracts/REST-API-MVP.md`](contracts/REST-API-MVP.md), [`contracts/EDEN-MVP.md`](contracts/EDEN-MVP.md), [`contracts/CLI-COMMANDS.md`](contracts/CLI-COMMANDS.md), [`contracts/SERVICE-LIFECYCLE-PROTOTYPE.md`](contracts/SERVICE-LIFECYCLE-PROTOTYPE.md) |
| Data, events, config | [`data/STATE-MODEL.md`](data/STATE-MODEL.md), [`data/POSTGRES-SCHEMA-MVP.md`](data/POSTGRES-SCHEMA-MVP.md), [`events/EVENT-CATALOG.md`](events/EVENT-CATALOG.md), [`events/DEFERRED-EVENT-GAP-MAP.md`](events/DEFERRED-EVENT-GAP-MAP.md), [`config/CONFIG-LIFECYCLE.md`](config/CONFIG-LIFECYCLE.md) |
| Security and testing | [`security/SECURITY-MODEL.md`](security/SECURITY-MODEL.md), [`testing/TESTING.md`](testing/TESTING.md) |
| Operations | [`operations/RUNBOOK.md`](operations/RUNBOOK.md), [`operations/OPTIONAL-DEPLOYMENT-PACK.md`](operations/OPTIONAL-DEPLOYMENT-PACK.md), [`operations/MNET-V02-RUNBOOK.md`](operations/MNET-V02-RUNBOOK.md), [`operations/M-NET-THREE-NODE-VALIDATION.md`](operations/M-NET-THREE-NODE-VALIDATION.md), [`operations/OCI-PIPELINE.md`](operations/OCI-PIPELINE.md) |
| Release and readiness | [`releases/MERISTEM-V02-RELEASE-NOTES.md`](releases/MERISTEM-V02-RELEASE-NOTES.md), [`production-readiness/READINESS-SUMMARY.md`](production-readiness/READINESS-SUMMARY.md) |
| M-UI | [`ui/SDUI-SCHEMA.md`](ui/SDUI-SCHEMA.md), [`ui/M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md`](ui/M-UI-TRANSITIONAL-WORKBENCH-BRIEF.md) |
| References and agents | [`references/elysiajs-latest.md`](references/elysiajs-latest.md), [`references/effect-latest.md`](references/effect-latest.md), [`references/drizzle-orm-latest.md`](references/drizzle-orm-latest.md), [`references/svelte-latest.md`](references/svelte-latest.md), [`references/wasm3-latest.md`](references/wasm3-latest.md); [`agents/domain.md`](agents/domain.md), [`agents/issue-tracker.md`](agents/issue-tracker.md), [`agents/triage-labels.md`](agents/triage-labels.md) |
| Historical material | [`archive/README.md`](archive/README.md) and its non-authoritative UI archive |

## Minimal contract set

The v0.1 implementation loop is the roadmap plus REST/Eden/CLI/versioning (`contracts/`), service lifecycle, node-agent and M-Task, state/schema/events, security, runbook/testing, and SDUI/BFF/workbench documents listed above. Stable tested paths remain unchanged, including `operations/RUNBOOK.md`, `services/node-agent.md`, `data/POSTGRES-SCHEMA-MVP.md`, `events/EVENT-CATALOG.md`, `adr/ADR-T01-m-task-canonical-service.md`, and the v0.2 release notes.

## Maintenance

- Update the owning contract and its required tests when a boundary changes; do not duplicate contract facts in this index.
- Update root intent documents first when product scope changes, then affected docs.
- `archive/` is historical reference only and must not be used as implementation authority.
