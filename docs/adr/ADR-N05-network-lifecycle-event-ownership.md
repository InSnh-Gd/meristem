# ADR-N05: Network-Lifecycle Event Ownership And Durable Outbox

## 状态

Accepted

## 上下文

`mnet.network.created.v0` / `mnet.membership.joined.v0` / `mnet.network.deleted.v0` /
`mnet.membership.removed.v0` 描述的是 M-Net 权威网络状态的变更，但当前由 Core 在调用
M-Net 内部端口成功之后**内联发布**（`apps/core/src/routes/network/networks-support.ts`）。

这是一处「先提交、后发布」的双写：

- 权威变更在 M-Net 的 PostgreSQL 事务里提交；
- 事件在 Core 进程内、事务之外发布；发布失败时 Core 返回 typed `503`，但已提交的变更没有
  持久补发路径（除 DELETE 的幂等重放外）。

客户端不重试、或 Core 在提交与发布之间崩溃时，事件永久丢失，M-Log / M-UI BFF 等消费方
看到的网络状态与权威状态发散。对照实现显示这是本仓独有的缺口：

- M-Deploy 有 `mdeploy_event_intents`：权威操作与 event-intent 同事务提交，之后再 dispatch
  （`event-outbox.ts`）。
- M-Net closed-loop 有 `mnet_closed_loop_facts` 的 `event-intent` 记录与 30s 补发 sweep
  （`closed-loop-store-pg.ts`、`closed-loop-workflow-support.ts` 的 `dispatchPendingEvents`）。

DFW-043 记录了这个缺口，并要求「先由 ADR 决定事件发布者归属」再实现。

## 决策

### 1. 变更与事件归属同一服务

**谁拥有权威变更，谁拥有该变更的事件。** 网络生命周期事件发布者从 Core 迁移到 M-Net：
只有 M-Net 能在**同一个 PostgreSQL 事务**里既写网络状态、又写待发布事件意图（event intent）。

Core 保留的职责不变，且与事件发布解耦：

- **授权**（M-Policy，变更前，fail-closed）；
- **审计**（Audit Log，变更前，fail-closed）；
- **Timeline**（变更后写，失败降级为 warn）。

M-Net 承担：

- **权威状态变更**（现有事务）；
- **事件意图与状态变更原子提交**；
- **事件发布**：提交后立即 best-effort 投递一次，失败则留在 durable pending intent；
  30s sweep 作为兜底重试（at-least-once）。

审计（Core，`auth.correlationId`）与事件（M-Net，透传的 `correlationId`）用同一个
correlationId 关联——这是 PR-A 的 correlationId 透传成为本次迁移前置的原因。

### 2. Durable outbox 而非内联发布

采用与 M-Deploy（`event-outbox.ts`）和 M-Net closed-loop（`dispatchPendingEvents`）一致的
「commit-then-dispatch」序列：先在同一事务里提交权威变更与 event-intent，提交后立即尝试投递，
投递失败只留 pending，由周期性 sweep 补发。sweep 是兜底，不是唯一投递路径——否则正常路径的
事件延迟会退化到最多一个 sweep 周期。

新增两张表：

- `mnet_network_event_intents`：`intent_id` 主键、`subject`、`payload` jsonb、`status`
  （`pending` / `published`）、`correlation_id`、`network_id`、`created_at`、`published_at`、
  `last_error`。
- `mnet_network_tombstones`：`network_id` 主键、`deleted_at`。

`network_id` **不得** FK 到 `networks.id`：删除 intent 与 tombstone 必须活过网络行本身，
否则删除网络时会因外键违例无法记录删除事件。两张表永不 GC（tombstone 用于区分「删过」与
「从未存在」，是 DELETE 幂等语义的权威判据）。

tombstone 必须是独立表而非复用 intent 台账：DELETE 幂等判据是同步读，其正确性不能依赖
事件投递状态，也不能被未来 intent 的 GC 策略破坏。

事件 envelope 的 `source` 由 `meristem-core` 改为 `m-net`。已查证无消费方硬编码依赖该字段。

### 3. REST 语义变更（breaking）

- 变更从「发布失败 → `503`」改为「变更成功 → `200`，事件 at-least-once 异步补发」。
  响应中的发布状态不引入新字段，避免扩大 breaking 面；补发由 outbox 保证。
- `DELETE /api/v0/networks/:id` 从「`network.not_found` → 幂等 `200`」改为
  「`network.not_found` → `404`；tombstone 存在 → 幂等 `200`」。
- 删除 `mnet.network.deleted.v0` payload 的 `replayed` 字段。该字段是代码相对
  EVENT-CATALOG 的漂移（`MNetNetworkDeletedPayload` 只定义 `{ networkId }`），且它把
  「补发」与「从未存在」混为一谈——tombstone + outbox 已能区分二者，统一为 `{ networkId }`。

## 结果

使能：

- 网络生命周期事件不再因 Core 崩溃或客户端不重试而丢失：正常路径提交后立即投递，
  投递失败由 30s sweep 以 at-least-once 最终补发（延迟上界为一个 sweep 周期）。
- 权威状态与事件在同一事务边界内一致提交，消除了「变更已提交但无事件记录」的窗口
  （事件记录随事务落库；投递延迟是另一个问题，见上）。
- `network_id` 软引用使删除事件与 tombstone 在网络行消失后仍可持久记录。

阻止 / 成本：

- Core 不再直接发布网络生命周期事件；任何依赖 Core 内联 `events.publish` 失败即 `503`
  行为的调用方必须适配（v0.2 无外部部署用户，按 CONTRACT-VERSIONING 记录后直接断代，
  不设兼容窗口）。
- 新增一张 outbox 表与一张 tombstone 表的运维成本，以及 30s 补发 sweep 的常驻循环。
- `replayed` 字段移除属 payload 形状 breaking；按 CONTRACT-VERSIONING 迁移清单登记。
- 这是本仓第三个同形状的 durable outbox dispatcher（M-Deploy、M-Net closed-loop、网络生命周期）。
  出现第四个领域 outbox 时应抽取共享 dispatcher，而不是继续复制。

## 重访条件

- 引入外部部署用户，需要为 REST `503 → 200` 语义变更提供兼容窗口时。
- 事件量增长到需要按 network 维度限流 / 分区，或 outbox 需要 GC 策略、死信 / 告警时。
- M-Net 需要多副本运行：当前 sweep 无租约与 `SKIP LOCKED` 声明，多副本会重复投递
  （在 at-least-once 语义内，但需要显式裁决）。
- 事件新鲜度成为用户可见 SLA，需要收紧「一个 sweep 周期」的延迟上界时。
- 出现除 M-Net 之外的权威变更所有者（例如某功能域服务也直接改网络状态），需要重新裁决
  「变更 => 事件」的单一所有者边界时。
- 出现第四个领域 outbox，需要抽取共享 dispatcher 时。

已知未决项（登记在 DEFERRED-WORK DFW-050，不阻塞本决策）：

- 投递侧无并发声明（无 `FOR UPDATE SKIP LOCKED`、`markEventIntentPublished` 无
  `status='pending'` 谓词），因此内联投递与 sweep 重叠、或多副本运行时会出现重复投递；
  在 at-least-once 语义内，但消费方只能按领域键去重（重试会生成新的 envelope id）。
- 无退避/死信/告警，也无投递 deadline；持续失败的 intent 会被无限重试，
  EventBus 挂起可能拖住变更响应。
