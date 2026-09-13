# ADR-N04: NetBird Runtime Integration

## 状态

Accepted

## 上下文

ADR-N03 授权了 M-Net 生产数据面的架构范围，但其数据面路径（WireGuard + wstunnel relay sidecar）存在 wstunnel 维护成本高、NAT 穿透能力有限、与上游 NetBird 生态对齐度低等问题。NetBird 作为基于 WireGuard 的开源 overlay mesh，提供了成熟的内网穿透（Signal）、中继（Relay）和 NAT 遍历（STUN）基础设施，其客户端 sidecar 可直接替代 wstunnel 数据面角色。

同时，NetBird 的 Management 层（Dashboard、ACL/策略、auth/SSO、审计/日志、账户模型）与 Meristem 控制平面（M-Net 管理、M-Policy 策略、M-Log 审计、M-UI 界面、profile 生命周期）存在功能重叠。引入 NetBird Management 会导致双重事实源、策略冲突、审计碎片化，与 Meristem 微内核多服务架构的根本原则相悖。

本 ADR 确认 v0.2 数据面运行时方向，划定 NetBird 组件的引入边界，设定 viability gate 作为 sidecar 采纳前提，并定义 sidecar proof 失败时的 typed fallback。

## 决策

### 1. NetBird 客户端 Sidecar Only（数据面）

每节点部署 NetBird 客户端二进制（`netbird`）作为 sidecar 进程，由 node-agent 管理生命周期。NetBird 客户端负责：

- WireGuard 隧道建立与对等连接
- 通过 NetBird Signal 服务进行信令交换
- 通过 NetBird Relay 服务进行中继转发（NAT 穿透失败时）
- 通过 NetBird STUN 服务进行 NAT 类型检测

NetBird 客户端 sidecar 的进程管理、配置注入、健康探测和崩溃恢复由 node-agent 通过 `services/node-agent/src/node-agent-sidecar-lifecycle.ts` 中的 `applySidecarDesiredState()` 统一执行。M-Net 控制平面通过 `services/m-net/src/data-plane/netbird-adapter.ts` 中的 `createNetBirdAdapter()` 将 profile 契约翻译为 node-agent sidecar 期望态。

### 2. 排除 NetBird Management / Dashboard

以下 NetBird 组件**明确排除**，不得引入 Meristem 部署拓扑：

- **NetBird Management**（管理服务）：Meristem M-Net 自身就是管理权威，负责 profile 生命周期、网络拓扑编排、节点加入/离开、ACL 意图渲染。
- **NetBird Dashboard**（Web 管理界面）：M-UI 是唯一的操作界面；不接受第二套管理 UI。
- **NetBird ACL/策略引擎**：M-Policy 是唯一的策略决策源；NetBird ACL 规则由 M-Net 控制平面根据 M-Policy 决策结果渲染生成，不引入 NetBird 原生的 ACL 管理语义。
- **NetBird 认证/SSO**：Meristem 使用 OIDC 联邦 + 本地 IAM（参见生产轨道决策）；不接入 NetBird 的身份系统。
- **NetBird 审计/日志**：M-Log 是唯一的审计事实记录系统；NetBird 客户端日志仅作为 node-agent `log.forward` 的 Full Log 来源之一，不形成独立的审计链。
- **NetBird 账户模型**：节点身份由 Meristem Core 管理；NetBird 不持有独立的账户/用户/组织模型。

`services/m-net/src/data-plane/netbird-adapter.ts` 中的 `validateResolvedConfig()` 函数已内置运行时守卫：若 NetBird 控制面配置中检测到 `management`、`dashboard`、`acl`、`acls` 字段，适配器拒绝输出 sidecar 期望态，返回 `netbird.config.forbidden_management_plane`。

### 3. Meristem 保留管理权威

以下能力由 Meristem 独占，不委托给 NetBird 或任何外部系统：

| 能力 | 归属 | 说明 |
|------|------|------|
| M-Net 管理 | Meristem M-Net | 逻辑网络 CRUD、节点加入编排、网络拓扑、profile 生命周期 |
| M-Policy 策略 | Meristem M-Policy | RBAC 授权、高风险操作审批门、策略决策 |
| M-Log 审计 | Meristem M-Log | Timeline / Full / Audit 日志事实、不可绕过审计链 |
| Profile 生命周期 | Meristem M-Net | 区域网络 profile 定义、启用、禁用、迁移、回滚 |
| M-UI 界面 | Meristem M-UI / M-UI BFF | 运维面板、CommandWell、状态可视化 |
| NetBird ACL 渲染 | Meristem M-Net（生成） | M-Net 根据 M-Policy 决策结果渲染 NetBird 格式的 ACL 规则 |
| NetBird 配置注入 | Meristem node-agent（注入） | node-agent 将 M-Net 签发的配置注入 NetBird 客户端 sidecar |

### 4. Signal / Relay / STUN 按 Proof Gate 引入

NetBird Signal、Relay 和 STUN 是 NetBird 客户端 sidecar 运行所必需的基础设施依赖。它们由 NixOS/systemd 管理，作为未经修改的上游二进制部署。Meristem 不管理这些服务的生命周期、配置或版本。

这些基础设施的引入**不是假定成功的**。它们的必要性由 proof gate `bun run mnet:v02:sidecar-proof` 验证。

### 5. Proof Gate

`bun run mnet:v02:sidecar-proof` 是 sidecar 路径的 viability gate。该命令必须在类生产环境中执行（非 CI mock），验证以下条件全部满足后才能通过：

1. NetBird 客户端二进制存在且可执行。
2. NetBird 客户端能够通过 SecretProvider 获取 setup key 并成功启动。
3. NetBird 客户端能够连接到 Meristem 指定的 Management URL。
4. NetBird 客户端能够通过 Signal 服务建立对等信令。
5. NetBird 客户端能够在两个节点之间建立 WireGuard 对等连接。
6. NetBird 客户端能够通过 Relay 服务完成中继转发。
7. NetBird 客户端能够优雅停止，不残留进程或内核状态。

若命令检测到 NetBird Management 依赖（如 Dashboard URL、ACL 管理 API 调用），输出 `unsupported_management_dependency` 并退出非零。

Proof gate **不得在 CI 中 mock 通过**。CI 中的自动化测试仅覆盖 typed failure path（`netbird.binary.invalid`、`netbird.start_failed`、`netbird.probe.*`），不模拟真实 NetBird 进程行为。真实 viability 验证必须由操作员在部署前手动执行或由自动化部署流水线在 staging 环境中执行。

### 6. Typed Fallback

若 `bun run mnet:v02:sidecar-proof` 失败，或 proof gate 证明 NetBird 客户端 sidecar 在目标环境中不可行，Meristem 退回以下 typed fallback：

- **传输路径**：`wireguard-rendered`（`packages/contracts/src/schemas/mnet-profile-v03.ts` 中定义的 `MNetNodeRuntimeProfileSchema.transport` 取值之一）。
- **数据面实现**：Meristem 自主渲染 WireGuard 配置（peer 列表、AllowedIPs、端点），由 node-agent 直接管理 `wg` 接口，不依赖 NetBird 客户端 sidecar。
- **基础设施保留**：NetBird Signal / Relay / STUN 基础设施可保留部署（由 NixOS/systemd 管理），因为这些服务不携带 Management 语义且为 future proof gate 重试提供基础。
- **profile 契约不变**：`m-net@0.3.0` 和 `m-net-cn@0.3.0` profile 契约的 schema 不变；`wireguard-rendered` 作为 `transport` 字段的合法取值，与 `netbird-sidecar` 并列存在。

Fallback 路径通过 `MNetNodeRuntimeProfileSchema` 中的 `transport: Schema.Literal('netbird-sidecar', 'wstunnel', 'wireguard-rendered')` 实现类型安全。运行时代码根据 `transport` 字段分发到对应的适配器。

Fallback 不是永久降级。Proof gate 可在基础设施就绪后重试；重试成功后可切换回 `netbird-sidecar` transport。

### 7. Ownership Boundaries

```text
Meristem 拥有:
  M-Net 管理、M-Policy 策略、M-Log 审计、Profile 生命周期、M-UI 界面
  NetBird ACL 规则渲染（生成端）
  NetBird sidecar 配置注入（node-agent 端）
  WireGuard 配置渲染（fallback 路径）

NetBird 提供（仅数据面 + 基础设施）:
  NetBird 客户端 sidecar（WireGuard 隧道、对等连接、NAT 穿透）
  NetBird Signal（信令服务）
  NetBird Relay（中继转发）
  NetBird STUN（NAT 检测）

NetBird 排除（不得引入）:
  NetBird Management、Dashboard、ACL/策略引擎、认证/SSO、审计/日志、账户模型
```

## 结果

### 使能

- v0.2 数据面获得成熟的 WireGuard mesh 能力（对等连接、NAT 穿透、中继转发），无需自建 wstunnel relay。
- Meristem 控制平面保持单一管理权威，不引入 NetBird Management 的双重事实源。
- NetBird 基础设施（Signal/Relay/STUN）由 NixOS/systemd 管理，Meristem 不承担其运维复杂度。
- 明确的 proof gate 防止未经验证的 sidecar 路径进入生产。
- Typed fallback（`wireguard-rendered`）确保 proof gate 失败时数据面仍可工作。

### 阻止

- Meristem 操作员无法使用 NetBird Dashboard 管理网络（必须使用 M-UI）。
- Meristem 无法使用 NetBird 原生的 ACL/策略/认证功能（必须使用 M-Policy / M-Log / OIDC）。
- wstunnel 旧版路径仅保留迁移窗口，v0.2 运行时不再支持 wstunnel 混合/fallback 模式。
- NetBird 客户端 sidecar 的 viability 必须在部署前通过 proof gate 验证，不是假定可用的。

### 成本

- 每节点需安装 NetBird 客户端二进制（通过系统包管理器或 Nix）。
- 需部署和维护 NetBird Signal / Relay / STUN 基础设施（NixOS/systemd 管理）。
- Proof gate 必须由操作员在类生产环境中手动执行；CI 仅覆盖 typed failure path。
- `wireguard-rendered` fallback 路径需维护两套数据面适配器（`netbird-adapter` + `wireguard-rendered` 渲染器），增加代码路径复杂度。

## 重访条件

当以下任一条件满足时，需要重新开启本决策：

1. Proof gate (`bun run mnet:v02:sidecar-proof`) 在目标生产环境中持续失败，且 `wireguard-rendered` fallback 无法满足生产数据面需求。
2. NetBird Management 提供了 Meristem 无法替代的关键能力，且通过新的 ADR 证明了引入 NetBird Management 不会造成双重事实源或策略冲突。
3. 出现了比 NetBird 更合适的数据面方案（如 Headscale/Tailscale 集成、原生 WireGuard mesh），需要替换整个数据面策略。
4. NetBird 许可证变更导致其在 Meristem 部署拓扑中的使用不合规。
