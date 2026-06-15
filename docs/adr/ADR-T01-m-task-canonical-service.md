# ADR-T01: M-Task 规范任务服务

## Status

Accepted

## Context

MVP 任务闭环已经证明：Core 可以将 noop 任务分配给 Leaf 节点、持久化任务状态、发布任务事件，并写入 Timeline / Full / Audit 事实。

但继续让 Core 保持任务 facade，会把任务生命周期语义继续留在微内核边界内。这与“Core 保持微内核、复杂行为进入显式 M-* 域或微服务”的产品边界冲突。

## Decision

将 M-Task 升格为规范任务服务。

- M-Task 成为规范的外部 REST / OpenAPI 任务 API 与任务 owner。
- M-Task 拥有任务生命周期状态、任务定义、任务 transition、任务结果、任务取消与规范任务生命周期事件。
- Core 不再拥有任务 facade、任务状态、任务编排、任务生命周期事件或任务日志事实。
- M-Task 通过共享 `packages/auth` 原语校验外部 actor JWT bearer credential。
- M-Task 直接调用 M-Policy 与 M-Log，处理授权、风险决策、Timeline / Full / Audit 行为与 fail-closed 语义。
- M-Task 通过 M-Net 协调投递，不得直接持有或调用 node-agent session。
- 这是一次从 Core-owned MVP 任务路径到 M-Task-owned 路径的 breaking migration；不保留 Core 任务兼容窗口。
- M-Policy 风险基础能力优先首先接入 M-Task 控制动作。

## Consequences

M-Task 从 Core helper 升格为真实的 M-* 域边界。任务生命周期、事件 ownership、状态 ownership 与 policy risk 语义有了单一规范 owner。

这次迁移要求同步更新 REST、OpenAPI、Eden、CLI、event catalog、security、data model、testing、runbook、MVP 文档、seed permission 与 demo script。旧的 Core 任务入口与 `task:assign` 权限不能再被视为稳定兼容面。

M-Task 必须实现自己的外部服务边界，包括 actor authentication、request correlation、trace propagation、M-Policy 调用、M-Log 写入与 fail-closed 行为。共享 auth 原语必须抽出，避免 Core 与 M-Task 重复实现身份处理。

该决策明确避免让 M-Task 演化成通用 workflow engine。retry execution、lease、多实例 worker 协调、approval queue 与完整多方决策流程仍属于后续工作。

## Revisit When

当以下任一条件成立时，重新开启本 ADR：

- M-Task 无法在不重新引入 Core facade 的情况下安全暴露外部任务 API。
- 任务迁移为 v0.1 用户带来不可接受的兼容性风险。
- M-Task 开始拥有 transport、node-agent 执行内部实现或任务生命周期之外的通用 workflow automation。
