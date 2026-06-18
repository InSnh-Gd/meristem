# ADR-N03: M-Net Production Data-Plane

## 状态

Accepted

## 上下文

ADR-N01 和 ADR-N02 限制 M-Net 仅进行 control-plane 逻辑和 mock data-plane，明确延后了真实的数据面行为（如 packet forwarding、TCP/UDP relay、WireGuard protocol）。现在需要明确开启生产环境数据面的实现范围，并且不再局限于 control-plane。

我们引入了 `m-net-cn@0.2.0` profile，用以支持生产数据面能力，同时保留 `m-net-cn@0.1.x` 仅作为 control-plane 并且自动向 `0.2.0` 迁移。

## 决策

1. **M-Net/Core Orchestration Scope:** M-Net/Core orchestrates identity, topology, public-key metadata, ACL intent, relay selection, network-map signing, status, and audit. **M-Net/Core MUST NOT forward user packets or implement transport protocols.**
2. **Packet Path Ownership:** Packet path is owned by Meristem node-agent (host-local) + WireGuard + pinned external wstunnel relay sidecars over WSS/443 with ACME TLS.
3. **Topology:** The first supported topology is 1 control-plane+relay host + 2 Leaf hosts.
4. **Profile Capability:** `m-net-cn@0.2.0` profile carries production data-plane capabilities; `m-net-cn@0.1.x` remains control-plane-only and auto-migrates to `0.2.0`.
5. **Key Management:** Node-agent private keys never leave the host; Meristem stores public keys and key metadata only.
6. **Network-map TTL Fail-closed:** Signed network-map TTL fail-closed: node-agent tears down Meristem-managed tunnels after `MERISTEM_MNET_NETWORK_MAP_STALE_TTL_MS` (default 15m) without a fresh signed map.
7. **Overlay CIDR:** Default overlay CIDR is `100.96.0.0/12`.
8. **Network Count:** Single active data-plane network per node for `m-net-cn@0.2.0`.
9. **Exclusions:** No DNS, TURN, multi-region relay pool, or mobile roaming in the first production slice.
10. **Infrastructure Requirement:** No Kubernetes/service mesh requirement.

## 结果

通过这个决策，M-Net 具备了真实的生产级数据面控制能力。
节点之间的通信通过 host-local 的 sidecar 组件（WireGuard, wstunnel）完成，Core 本身不承担数据包的路由、转发等消耗 CPU/内存的重负载任务。
保持了 Core 作为轻量微服务的定位。

## 重访条件

当我们需要支持多活 relay pool、自动漫游、DNS 劫持、或者脱离 WireGuard/wstunnel 改为其他数据面传输协议时，需要重新开启本决策。
