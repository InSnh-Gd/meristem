# ADR-N02: M-Net CN 区域网络 Profile

## Status

Accepted

## Context

某些网络环境需要默认 M-Net 策略之外的区域路由与回退行为。M-Net CN 是第一个显式区域网络 Profile。

## Decision

定义 M-Net CN 作为第一个 Regional Network Profile。

- 亚洲 Stem 节点可以承担 DERP 角色。
- 没有公网访问能力的大陆节点可以使用 TCP 互联。
- 亚洲 Stem 节点可以通过 TCP 与 Core 连接。

当前接受范围仅限于 **control-plane profile lifecycle**：

- profile definition
- per-network profile state
- profile transition
- suspended enable operation
- approval-flow integration

真实数据面行为 —— DERP relay、TCP tunnel、UDP path switching、Headscale control、主动探测、时延测量、endpoint URL 管理、TLS 私钥材料、STUN/TURN 凭据、route table、relay assignment —— 明确延后。

数据面骨架（`services/m-net/src/data-plane/`）已作为 feature-gated noop adapter 边界存在，默认关闭。该骨架不暴露任何运行时传输端口或协议，不改变 `controlPlaneOnly: true` 语义。真实传输实现仍延后。

## Consequences

- 区域行为意图通过 profile state、transition、event、Timeline 与 Audit Log 变得显式且可审计。
- M-Net CN 保持为 per-network 的可选 profile，由 M-Policy 控制（启用走 approval flow；禁用走 M-Policy allow + Audit）。
- `m-net-cn@0.1.0` 保持 `controlPlaneOnly: true`，不包含真实 endpoint、secret、route 或 probe 数据。
- 启用 `m-net-cn@0.1.0` 不会直接改变真实网络传输路径。
- profile 契约可与未来的 Config Lifecycle validate / publish / apply / ack / rollback 语义保持兼容。

## Revisit When

- 在实现任何真实数据面网络行为（DERP relay、TCP/UDP interconnect、Headscale、probe）之前。
- 在出现具体区域连通性验证结果，或 M-Net CN 带来不可接受的运维风险之后。
