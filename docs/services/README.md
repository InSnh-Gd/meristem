# Services Index

> Service documents define responsibility, contracts, permissions, dependencies, lifecycle, and logging behavior.

---

## Service Documents

| Service | Document | MVP Role |
|---------|----------|----------|
| Service Definition Template | `SERVICE-DEFINITION-TEMPLATE.md` | required template |
| Core | `core.md` | MVP orchestrator |
| M-CLI | `m-cli.md` | MVP operator entrypoint |
| M-EventBus | `m-eventbus.md` | MVP internal loopback HTTP + Eden publisher to NATS |
| M-Log | `m-log.md` | MVP Timeline / Full / Audit |
| M-Policy | `m-policy.md` | MVP RBAC |
| M-Net | `m-net.md` | logical network orchestration now; future real transport later |
| M-Task | `m-task.md` | Phase 11 canonical task lifecycle service |
| Node Agent | `node-agent.md` | agent heartbeat, noop execution, and forwarded logs |
| M-UI BFF | `m-ui-bff.md` | out of MVP |

---

## MVP Rule

For the current local phases, Core may orchestrate logical node and logical network flows, but it must not implement real networking or bypass M-Policy / M-Log. After Phase 11, M-Task owns canonical noop task submission, lifecycle state, events, and task log facts.
