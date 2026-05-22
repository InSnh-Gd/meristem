# Phase 10.1 - Projection Platform Track

> Phase 10.0 搜索功能完成后，Phase 10.1 进入 Projection Platform Track。
> 目标：围绕 M-Log 拥有的 PostgreSQL 事实，构建可操作的读模型平台原语。

---

## 1. Prerequisites

Phase 10.0 搜索测试通过，projection degraded state 可观测（M-Log /ready 端点包含 `opensearch` 字段）。

## 2. Task List

### 2.1 Projector Job Metadata

- [x] 定义 projector job 类型：`backfill` | `incremental` | `repair`
- [x] 定义 job 状态机：`pending` → `running` → `completed` | `failed` | `cancelled`
- [x] 定义 job 元数据 schema：`{ id, type, index, startCursor, endCursor, status, createdAt, updatedAt, error? }`
- [x] 投影 job 记录写入 M-Log 管理的 PostgreSQL 表，不依赖 OpenSearch

### 2.2 Idempotency Keys

- [x] 定义投影文档 idempotency key 规则：`{index}:{factId}:{version}`
- [x] OpenSearch `_id` 使用 idempotency key，保证重复投影不产生重复文档
- [x] 文档 `_version` 字段与 `factId`（PostgreSQL 事实主键）一一对应

### 2.3 Cursor / Offset

- [x] 定义 cursor 形状：`{ factId: string, timestamp: ISO8601 }`
- [x] cursor 基于 PostgreSQL 事实表的 `(id, timestamp)` 排序
- [x] cursor 持久化到 PostgreSQL，不依赖 OpenSearch 状态
- [x] 支持 per-index 独立 cursor

### 2.4 Retry & Dead-Letter Queue (DLQ)

- [x] 定义重试策略：指数退避（1s / 2s / 4s / 8s），最大 3 次重试
- [x] 重试失败后进入 DLQ
- [x] DLQ 记录 schema：`{ jobId, factId, index, error, attemptedAt, retries }`
- [x] DLQ 支持手动重放和逐条跳过
- [x] DLQ 记录持久化到 PostgreSQL

### 2.5 Backfill Command

- [x] 定义 `backfill` CLI 命令或内部 API 端点
- [x] backfill 参数：`--index <name>` `--from <cursor>` `--to <cursor>` `--batch-size <n>`
- [x] backfill 读取 PostgreSQL 事实表，逐批投影到 OpenSearch
- [x] backfill 支持断点续投（基于 cursor）
- [x] backfill 不影响在线增量投影

### 2.6 Projection Health & Lag

- [x] M-Log `/ready` 端点已包含 `opensearch` 可用性（Phase 10.0）
- [x] 新增投影健康端点：`lagSeconds`、`lastProjectedAt`、`pendingCount`
- [x] 投影健康指标暴露为 OpenTelemetry gauge
- [x] degraded 状态自动触发告警（日志 warn 级别）

### 2.7 Schema Version Behavior

- [x] 定义索引 schema 版本规则：`meristem-{type}-logs-v{N}`
- [x] schema 变更时创建新索引版本（v1, v2, ...），不原地修改
- [x] 旧索引保留可查询，不自动迁移
- [x] backfill 命令支持指定目标索引版本
- [x] 索引 alias 机制：`meristem-{type}-logs-latest` → 当前活跃版本

### 2.8 State Model Update

- [x] 更新 `docs/data/STATE-MODEL.md`：新增投影状态表
- [x] 投影状态表归属 M-Log，不引入新 M-* 域

---

## 3. Out of Scope

Phase 10.1 does not include:

- M-Net state projection（保留为后续阶段占位）
- M-Policy behavior analysis projection（保留为后续阶段占位）
- 通用全系统投影平台
- 跨服务投影编排
- OpenSearch 集群管理自动化

---

## 4. Completion Criteria

- [x] projector job 可创建、执行、完成
- [x] idempotency key 保证重复投影安全
- [x] cursor 持久化支持断点续投
- [x] DLQ 记录投影失败并可手动重放
- [x] backfill 命令可全量重建索引
- [x] 投影健康指标可观测
- [x] 索引 schema 版本策略已文档化
- [x] 所有新增状态表写入 `docs/data/STATE-MODEL.md`
