# Contracts Documentation Index

> `docs/contracts/` 收敛 Meristem 的外部 REST 契约、内部 Eden 契约、CLI 行为契约，以及跨边界版本化规则。
>
> 本目录中的文档按“权威规则”与“补充映射”分层：`REST-API-MVP.md` 与 `CONTRACT-VERSIONING.md` 定义规范；`CLI-COMMANDS.md`、`EDEN-MVP.md`、`SERVICE-LIFECYCLE-PROTOTYPE.md` 负责说明特定消费面如何映射到这些规范。

---

## 1. Canonical vs Supporting

| 文档 | 角色 | 状态 |
|------|------|------|
| `CONTRACT-VERSIONING.md` | 版本化总规则、兼容性与迁移要求 | Canonical |
| `REST-API-MVP.md` | 外部 REST / OpenAPI 契约主文档 | Canonical |
| `CLI-COMMANDS.md` | CLI 对 REST 契约的命令映射与操作规则 | Supporting |
| `EDEN-MVP.md` | Eden 内部 TypeScript 客户端契约 | Supporting |
| `SERVICE-LIFECYCLE-PROTOTYPE.md` | 服务生命周期运行时补充约束 | Supporting |

---

## 2. Reading Order

1. `CONTRACT-VERSIONING.md` — 先理解哪些对象必须版本化，以及 breaking / non-breaking 边界。
2. `REST-API-MVP.md` — 查看外部 HTTP surface、request / response shape、权限与 error envelope。
3. `CLI-COMMANDS.md` — 查看 M-CLI 如何消费外部 REST 契约。
4. `EDEN-MVP.md` — 查看 CLI→Core 与 Core→内部服务的 typed client 约束。
5. `SERVICE-LIFECYCLE-PROTOTYPE.md` — 查看服务 reload 运行时语义与非目标边界。

---

## 3. Directory Rules

- 新的外部 HTTP 行为先落在 `REST-API-MVP.md`，再由 CLI / Eden / supplemental 文档引用。
- CLI 文档可以镜像权限与命令行为，但 REST 文档仍是外部权限与响应 shape 的权威来源。
- Eden 文档不重新定义外部 REST schema；如果某个类型已经在 REST 文档命名，应直接引用该类型名。
- 运行时补充文档只能补充语义、限制与非目标，不能悄悄覆盖 REST 主契约。
- 若契约跨 service、node、runtime 或 time 边界，变更前先更新 `CONTRACT-VERSIONING.md` 的相关规则或引用。
