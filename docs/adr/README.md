# ADR Index

> Architecture Decision Records 记录 Meristem 的持久性架构决策。ADR 被实现文档、服务定义和 PR 审查引用。

---

## 当前活跃决策

| ADR | 标题 | 状态 | 主题 |
|-----|------|------|------|
| [ADR-F01](ADR-F01-foundational-technology-stack.md) | 基础技术栈 | Accepted | TypeScript / Elysia / REST+OpenAPI / Eden / Effect / SvelteKit / 负面清单 |
| [ADR-F02](ADR-F02-architecture-organization.md) | 架构组织原则 | Accepted | 微服务 / Core 微内核 / M-Extension / 横切关注点 / M-Policy 起点 |
| [ADR-F03](ADR-F03-infrastructure-backbone.md) | 基础设施主干 | Accepted | NATS / PostgreSQL / OpenSearch / NATS KV / OpenTelemetry / APISIX / M-Log 语义 |
| [ADR-N01](ADR-N01-m-net-default-network.md) | M-Net 默认网络 | Superseded by ADR-N03 | M-Net 默认组网策略 |
| [ADR-N02](ADR-N02-m-net-cn-profile.md) | M-Net CN 区域网络 Profile | Accepted (data-plane scope superseded by ADR-N03) | 区域网络 Profile（当前接受范围：control-plane profile lifecycle） |
| [ADR-N03](ADR-N03-m-net-production-data-plane.md) | M-Net Production Data-Plane | Accepted | M-Net 数据面范围授权和 Sidecar 代理定义 |
| [ADR-T01](ADR-T01-m-task-canonical-service.md) | M-Task 规范任务服务 | Accepted | 任务服务边界 |

---

## ADR 模板

```md
# ADR-XXX: 标题

## 状态

Accepted / Proposed / Deprecated / Superseded by `ADR-YYY` (`ADR-YYY.md`)

## 上下文

该决策存在的背景。

## 决策

已决定的内容。

## 结果

该决策使能什么、阻止什么、带来什么成本。

## 重访条件

能够证明需要重新开启该决策的具体条件。
```
