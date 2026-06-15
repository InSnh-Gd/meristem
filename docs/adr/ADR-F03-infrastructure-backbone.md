# ADR-F03: 基础设施主干

## 状态

Accepted

## 上下文

Meristem 需要一组默认基础设施来承载事件、权威状态、读模型、缓存、可观测性和可选网关。默认基础设施必须足够轻量，不能将可选组件变成部署前提。

## 决策

### NATS 作为 M-EventBus 主干

M-EventBus 使用 NATS 作为事件、命令、同步与互联信息流动的主干。消费者必须处理至少一次投递、幂等性、schema 验证和 NATS 不可用时的降级。

### PostgreSQL 作为权威写模型

PostgreSQL 是 Meristem 的暂定权威写模型，承载用户、角色、权限、节点、服务定义、配置版本、secretRefs 和关键资源状态。该决策在 v0/MVP 阶段接受，生产冻结前需重新评估。

### OpenSearch 作为读模型与搜索

OpenSearch 用于读模型、搜索、日志检索和分析查询。OpenSearch 不是权威写模型，其不可用不得阻塞写模型。

### NATS KV 作为默认缓存

默认缓存使用 NATS KV / MATS。Redis / KeyDB 仅作为 NATS KV 不足时的补充后端，引入前需说明理由并更新依赖文档。

### OpenTelemetry 用于可观测性

使用 OpenTelemetry 采集 traces、metrics 和 logs 的关联。M-Log 仍然是 Meristem 自身的 Timeline / Full / Audit / AI 分析层，二者职责不得混淆。

### APISIX 可选

APISIX 是可选部署组件，不是 Core 默认依赖。默认部署保持更轻，生产部署可以按需使用 APISIX 进行 TLS 终止、限流、认证前置、灰度和流量控制。

### M-Log 日志语义

M-Log 使用三级日志：Timeline Log、Full Log、Audit Log。Audit Log 独立实现且高权限，不是 Full Log 的一个分类。人类状态、运维调试和高可信审计审查拥有独立的语义，实现必须防止 Timeline 或 Full Log 替代 Audit Log。

## 结果

- 默认栈保持轻量且契约驱动。
- 权威状态、事件、缓存、读模型、可观测性各有明确承载，职责不混淆。
- 可选组件不会污染 Core 的默认依赖或许可。

## 重访条件

- 如果 NATS 无法满足投递、拓扑、持久化或运维需求，且已有具体实现经验。
- 生产冻结前，如果有其他 RDBMS 或存储模型被证明更适合权威状态集。
- 如果 OpenSearch 带来不可接受的运维负担或许可约束。
- 如果 v0 或 v1 功能反复需要 Redis-only 语义。
- 如果 OpenTelemetry 无法表达所需的事件或策略决策关联。
- 如果生产需求使 APISIX 实际上成为默认部署组件，且默认部署契约需要改变。
- 如果需要更强的审计存储机制，但不是压缩三级日志层。
