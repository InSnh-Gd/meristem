# Services Index

> Service documents define responsibility, contracts, permissions, dependencies, lifecycle, and logging behavior.

---

## Service Documents

| Service | Document | MVP Role |
|---------|----------|----------|
| Service Definition Template | `SERVICE-DEFINITION-TEMPLATE.md` | required template |
| Core | `core.md` | MVP orchestrator |
| M-CLI | `m-cli.md` | MVP operator entrypoint |
| M-EventBus | `m-eventbus.md` | MVP NATS boundary |
| M-Log | `m-log.md` | MVP Timeline / Full / Audit |
| M-Policy | `m-policy.md` | MVP RBAC |
| M-Net | `m-net.md` | logical network orchestration now; future real transport later |
| Node Agent | `node-agent.md` | future agent; MVP simulated by Core |
| M-UI BFF | `m-ui-bff.md` | out of MVP |

---

## MVP Rule

For the current local phases, Core may orchestrate logical node, logical network, and noop task flows, but it must not implement real networking or bypass M-Policy / M-Log.
