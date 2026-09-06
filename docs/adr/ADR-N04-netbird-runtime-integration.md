# ADR-N04: NetBird Runtime Gate and License Posture (v0.2 Data-Plane Direction)

## 状态

Accepted（v0.2 数据面运行时方向；对 v0.2 目标 profile 取代 ADR-N03 的 legacy 路径，`m-net-cn@0.2.0` 保留为迁移窗口 legacy）

## 上下文

ADR-N03 授权了 WireGuard + wstunnel 生产数据面（`m-net-cn@0.2.0`）：packet path 由 node-agent（host-local）+ WireGuard + 固定外部 wstunnel relay sidecar 承载。运行该路径意味着 Meristem 要在每个节点上自行负责 WireGuard 渲染、relay 生命周期和证书编排。

v0.2 需要一个受管的数据面运行时来降低每节点的自维组件数量，同时必须保持两条产品红线：

1. Core 仍是微内核，M-Net/Core 不进入 packet path；
2. Meristem——而不是任何外部控制面——是授权与审计的唯一根（`MERISTEM.md` 产品边界）。

NetBird 提供 WireGuard mesh 客户端与 Signal + Relay/STUN 基础设施，但其完整发行版附带 NetBird Management（Dashboard、ACL/policy、auth/SSO、audit/logging、account model）。把 Management 引入会建立一个位于 M-Policy / M-Log 之外的第二个授权与审计根。同时，引入外部网络运行时必须先过依赖与许可治理（`MERISTEM-DEV.md` §7.2）。

## 决策

1. **运行时方向：NetBird-only at runtime。** v0.2 数据面 profile（`m-net@0.3.0`、`m-net-cn@0.3.0`）以 NetBird 客户端 sidecar 为唯一运行时传输目标；`m-net-cn@0.2.0`（WireGuard + wstunnel，ADR-N03 legacy 路径）仅在迁移窗口内保留。
2. **排除 NetBird Management。** Dashboard、ACL/policy、auth/SSO、audit/logging、account model 一律不得运行。授权决策只属于 M-Policy，审计事实只属于 M-Log。
3. **Packet path 归属：** node-agent（host-local）+ NetBird 客户端 sidecar + NetBird Signal + NetBird Relay/STUN。M-Net/Core MUST NOT forward user packets or implement transport protocols（延续 ADR-N03 决策 1）。
4. **Viability gate：** `bun run mnet:v02:sidecar-proof`。该 proof 仅当 sidecar 启动、无 Management 模式 config 获取、peer/session 建立、干净停止四个环节全部完成才可成功；若客户端路径需要被排除的 Management 行为，命令以 nonzero 退出并输出 `unsupported_management_dependency`。
5. **Adapter 边界：** `services/m-net/src/netbird-adapter.ts` 是 NetBird 数据面 adapter 边界；`m-net-cn@0.1.x` 保持 `controlPlaneOnly: true` 走 noop adapter；gate 关闭时默认 noop，不触碰任何运行时传输路径。
6. **迁移：** `m-net-cn@0.2.0` 旧节点获得 typed `migration-required` 指导（`mnet.migration.required.v0`）与 rebuild 指引；legacy 路径仅在迁移窗口内运行。
7. **密钥处理：** NetBird 客户端凭证走 SecretRef 规则；凭证不得进入日志、OpenSearch、UI error envelope 或 LLM context。
8. **License posture：** NetBird 客户端、Signal 与 Relay 以**外部运行时 artifacts**（sidecar 二进制/容器）形态使用，不作为 Go/TS 依赖链接进 Meristem 代码，因此不污染 BSD-3 的 Core license；WireGuard 内核模块按其原生许可证随宿主内核分发，Meristem 不对其再分发或修改。NetBird 组件的升级与来源固定纳入 ops 部署文档管理；任何把 NetBird 代码链接/内嵌进 Meristem 仓库的行为都需要新的 ADR。

## 4. 回退方案

如果 sidecar-proof 未通过：回退为 **Meristem 自有 WireGuard 渲染 + NetBird Signal/Relay/STUN 基础设施**，仍排除 NetBird Management。该回退保留 ADR-N03 的拓扑与 CIDR 决策（1 control-plane+relay host + 2 Leaf host、`100.96.0.0/12`），仅移除 wstunnel sidecar，以 node-agent 的 host-local WireGuard 渲染承担传输。

## 结果

v0.2 获得一个降低节点自维成本的数据面方向，同时 Core 微内核边界、M-Policy 授权根与 M-Log 审计根不受影响。profile 契约以 `m-net@0.3.0` / `m-net-cn@0.3.0` 承载 NetBird 语义；legacy 迁移窗口以 `mnet.migration.required.v0` 提供 typed 指导。license 层面，NetBird 以外部 artifacts 边界使用，BSD-3 Core 不被污染。生产级声明仍必须由当前验收证据（sidecar-proof、harness、three-node validation）支撑。

## 重访条件

当出现以下情况需要重新开启本决策：NetBird 客户端无 Management 模式无法维持（proof 长期失败且回退不可行）、需要 DNS/TURN/多区域 relay pool/移动漫游（超出第一生产切片）、NetBird 许可条款变更导致 artifacts 边界不再成立、或需要引入 NetBird Management 的任何组件。
