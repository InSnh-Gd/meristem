# ADR-N01: M-Net 默认网络

## Status

Superseded by `ADR-N03` (`ADR-N03-m-net-production-data-plane.md`)

## Context

M-Net 需要一个默认的 Core / Stem / Leaf 节点互联策略，作为后续 Regional Network Profile 与回退控制的基础。

## Decision

当前默认设计如下：

- Core 运行 Headscale DERP Server。
- 默认优先 UDP。
- Tailscale 公共 DERP 可作为可配置且可禁用的回退路径。

## Consequences

- M-Net 以一个可操作的默认组网基线启动。
- 区域网络 Profile 与回退控制仍保留显式扩展空间。
- 后续真实连通性验证必须回到此 ADR 重新确认默认策略是否继续成立。

## Revisit When

当首次 M-Net 实网验证完成，或默认回退、审计、实际连通性要求被证明与当前策略不兼容时，重新开启本 ADR。
