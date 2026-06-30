# Services Index

> Service documents define responsibility, contracts, permissions, dependencies, lifecycle, and logging behavior.
>
> 本文档只做索引与阅读顺序，不额外定义 Core / 功能域的规范边界。跨服务治理规则由 `MERISTEM-DEV.md`、`docs/contracts/CONTRACT-VERSIONING.md` 与对应服务定义共同约束。

---

## 1. Service Documents

| Service | Document | Role |
|---------|----------|------|
| Service Definition Template | `SERVICE-DEFINITION-TEMPLATE.md` | Shared markdown structure for service definitions |
| Core | `core.md` | Core microkernel service definition |
| M-CLI | `m-cli.md` | Official operator CLI service definition |
| M-EventBus | `m-eventbus.md` | Event publishing and envelope service definition |
| M-Log | `m-log.md` | Timeline / Full / Audit log service definition |
| M-Policy | `m-policy.md` | RBAC / approval / decision service definition |
| M-Net | `m-net.md` | Logical network and agent-join orchestration service definition |
| M-Task | `m-task.md` | Canonical task lifecycle service definition |
| M-Extension | `m-extension.md` | Extension control-plane service definition |
| Node Agent | `node-agent.md` | Agent runtime, session, and task execution service definition |
| M-UI BFF | `m-ui-bff.md` | M-UI BFF service definition |

---

## 2. Reading Order

1. `SERVICE-DEFINITION-TEMPLATE.md` — understand the required fields and markdown shape.
2. `core.md` — understand the Core boundary before reading follow-on services.
3. Read the service definition for the domain you are changing.
4. Cross-check with the related contract, data, event, security, and testing documents before changing implementation.
