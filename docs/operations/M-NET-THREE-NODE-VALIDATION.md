# M-Net 三节点验证运行手册

> 目标：在一台控制机 + 两个 node-agent 容器（`1 stem + 1 leaf`）的 first multi-host topology 上，验证 M-Net `m-net-cn@0.2.0` 已具备真实多节点组网与管理能力。

---

## 1. 适用范围

本手册对应当前仓库内置的 multi-host harness：

- 控制面服务全部运行在本机（Core / M-Net / M-Task / M-Log / M-Policy / M-EventBus / M-Extension）
- 两个 node-agent 容器通过 Docker/Podman bridge 网络隔离运行，其中一个 `kind=stem`，一个 `kind=leaf`
- 数据面采用 **node-agent + WireGuard + wstunnel**
- 不依赖 M-UI

权威脚本入口：

```bash
mnet-harness preflight
mnet-harness start
mnet-harness status
mnet-harness stop
mnet-harness reset
```

其中 `mnet-harness` 是 fish alias，指向系统命令 `meristem-mnet-harness`。在当前 NixOS 主机上，这个 wrapper 会：

- 通过 `/run/wrappers/bin/capsh-netadmin` 注入 `CAP_NET_ADMIN`
- 显式导出 `wg` / `wstunnel` / `openssl` 路径
- 直接执行 `bun run scripts/mnet-multihost-harness.ts <command>`

---

## 2. 验收目标

本次三节点验证的通过标准不是“控制面 API 可访问”，而是下面三类结果同时成立：

1. **真实组网**
   - `stem + leaf` 两个节点完成 join/resume
   - M-Net 能发布最新 signed network map
   - node-agent 能拉取 map、注册公钥、落地本地 WireGuard 配置
   - leaf 能通过 tunnel IP 访问 stem 的 tunnel IP（不是只看 control-plane `healthy`）

2. **真实管理**
   - 通过 M-Task 向活跃 Leaf 下发 noop 任务并成功完成

3. **真实失败路径**
   - stale map 会触发 fail-closed 评估
   - 无效目标节点的任务提交会在执行前被拒绝，而不是静默成功

---

## 3. 前置条件

### 3.1 基础依赖

```bash
bun install
docker info
wg --version
wstunnel --version
openssl version
```

当前仓库要求：

- Bun 可用
- Docker/Podman API 可用
- `wg` 二进制可用
- `wstunnel` 二进制可用
- `/sys/module/wireguard` 可见
- `oven/bun:1` 镜像可被容器运行时拉起

如需显式指定路径，可设置：

```bash
export MERISTEM_WG_BINARY_PATH="/run/current-system/sw/bin/wg"
export MERISTEM_WSTUNNEL_BINARY_PATH="/run/current-system/sw/bin/wstunnel"
```

### 3.2 `CAP_NET_ADMIN` 是谁需要

需要该 capability 的不是 Core / M-Net 控制面，而是**执行宿主机本地组网动作的 node-agent / harness 进程**。

它具体用于：

- `ip link add ... type wireguard`
- `ip addr add ...`
- `ip link set up/down`
- `wg` 写入 peer / key / allowed IPs
- fail-closed / teardown 时清理本地 WireGuard 接口

如果没有 `CAP_NET_ADMIN`，harness 会在 preflight / start 阶段直接失败：

```json
{
  "code": "host.cap_net_admin_missing",
  "message": "CAP_NET_ADMIN is missing for the current host process"
}
```

---

## 4. 推荐启动方式

### 4.1 推荐：直接使用稳定 wrapper

当前主机推荐直接运行：

```bash
mnet-harness preflight
mnet-harness start
mnet-harness status
```

这条链路已经在本机真实 proof 中验证通过。

### 4.2 备用：直接调用 capability wrapper

如果当前 shell 还没加载 alias，或系统尚未把 `meristem-mnet-harness` 纳入 PATH，可直接调用：

```bash
/run/wrappers/bin/capsh-netadmin -- -c 'cd /home/gdzzc/Projects/meristem && exec bun run scripts/mnet-multihost-harness.ts preflight'
/run/wrappers/bin/capsh-netadmin -- -c 'cd /home/gdzzc/Projects/meristem && exec bun run scripts/mnet-multihost-harness.ts start'
/run/wrappers/bin/capsh-netadmin -- -c 'cd /home/gdzzc/Projects/meristem && exec bun run scripts/mnet-multihost-harness.ts status'
```

关键要求仍然只有一个：

> **运行 harness 的宿主机进程必须携带 `CAP_NET_ADMIN`。**

---

## 5. 标准执行步骤

### 步骤 1：预检

```bash
mnet-harness preflight
```

通过时应返回：

- `ok: true`
- `message: "host capability, relay binary, and docker bridge checks passed"`

如果失败，优先查看：

- `host.wireguard_missing`
- `host.cap_net_admin_missing`
- `host.wireguard_module_missing`
- `host.wstunnel_missing`
- Docker / bridge / container reachability 相关错误

### 步骤 2：启动三节点拓扑

```bash
mnet-harness start
```

期望结果：

- `active: true`
- `controlPlane.ready: true`
- relay endpoint / health URL 可见
- 两个 node-agent 容器被拉起，其中一个 `kind=stem`，一个 `kind=leaf`

### 步骤 3：查看状态

```bash
mnet-harness status
```

重点看：

- control plane ready 状态
- relay ready 状态
- leaf 列表（当前实现应看到 `1 stem + 1 leaf`）
- 日志路径（通常在 `.local/mnet-multihost/logs/`）

真实成功样例：

```json
{
  "active": true,
  "controlPlane": {
    "ready": true,
    "url": "http://127.0.0.1:3000/api/v0/ready"
  },
  "leafs": [
    {
      "found": true,
      "kind": "stem",
      "status": "healthy"
    },
    {
      "found": true,
      "kind": "leaf",
      "status": "healthy"
    }
  ],
  "relay": {
    "endpoint": "wss://host.docker.internal:18443",
    "healthUrl": "http://127.0.0.1:19090/health",
    "ready": true
  }
}
```

### 步骤 4：运行真实验收测试

```bash
bun test tests/e2e/mnet-multihost-happy.e2e.test.ts
bun test tests/e2e/mnet-multihost-failures.e2e.test.ts
```

通过标准：

- happy suite 验证 signed network map 发布与 noop 管理路径成功
- failure suite 验证 stale-map fail-closed 与 invalid target task 提交前拒绝路径

### 步骤 5：确认隧道内真实流量

当前仓库还没有把 in-tunnel TCP proof 包成单独命令，因此这一步仍按运行态验证执行。真实 proof 的通过标准是：

- stem / leaf 容器内都能看到 `meristem-wg0`
- stem 挂载 `100.96.0.2/32`，leaf 挂载 `100.96.0.1/32`
- 从 leaf 通过 `100.96.0.2:<port>` 访问 stem 时，stem 侧实际看到 `remoteAddress=100.96.0.1`

本轮已验证的实证结论：

- 控制面与 relay 正常
- node-agent runtime sync 已真实落盘 `/run/meristem/wireguard/*`
- overlay TCP 已通过 leaf `100.96.0.1` → stem `100.96.0.2` 打通

---

## 6. 验收判定

### 6.1 通过

满足以下条件即可判定三节点验证通过：

- `mnet-harness preflight` 返回成功
- `mnet-harness start` 返回 `active: true`
- `mnet-harness status` 能看到 `1 stem + 1 leaf` healthy 与日志路径
- 两个 E2E 文件全部通过，不是 skip，不是 placeholder
- 已完成一次 tunnel IP 层的真实 TCP proof，而不是只看 control-plane healthy

### 6.2 未通过但已定位

如果当前机器仍然卡在环境层，可按下面归类：

- `host.cap_net_admin_missing`：当前启动 harness 的 shell/服务没有 `CAP_NET_ADMIN`
- `host.wireguard_missing`：`wg` 不可见或路径不对
- `host.wireguard_module_missing`：内核模块不可用
- `host.wstunnel_missing`：`wstunnel` 不可见或路径不对
- 容器网络类错误：Docker/Podman bridge / `host.docker.internal` 解析不可用

这类失败说明**仓库逻辑未必有问题，优先检查宿主机能力**。

---

## 7. 清理与重试

停止拓扑：

```bash
mnet-harness stop
```

完全清理：

```bash
mnet-harness reset
```

建议在以下情况使用 `reset`：

- Leaf 容器状态异常
- 上一次验证中断
- relay / logs / temporary state 看起来不一致

当前 harness 已补齐强清场语义：

- 即使 `state.json` 不存在，也会兜底清理 `meristem-mnet-leaf-*` 容器
- 会回收 `meristem-mnet-harness-*` 网络
- 会回收 relay / wstunnel / `docker logs -f` 跟随进程 / 本地控制面孤儿进程

因此 `mnet-harness reset` 之后，通常不再需要手动清理 `19090 / 18443 / 3000 / 3101-3106` 端口。

---

## 8. 当前这台机器的已知结论

本轮实际验证中已经确认：

- `wg` / `wstunnel` / `openssl` 均已接入 harness 启动链
- `mnet-harness preflight` 可返回 `ok: true`
- `mnet-harness start` 可拉起真实 multi-host topology
- `mnet-harness status` 可稳定返回 `controlPlane.ready=true`、`relay.ready=true`、`stem/leaf healthy`
- 两份多主机 E2E 已通过核心验收路径
- 已完成一次真实 overlay TCP proof：leaf `100.96.0.1` 成功访问 stem `100.96.0.2`

同时，本轮还修掉了几类会误导运维判断的历史问题：

- relay log 现在按每次 start **覆盖重写**，不会再把旧的 `EADDRINUSE` 误当作当前故障
- relay readiness 现在必须满足 **当前 relay pid 存活 + health endpoint 成功**，不会再把旧进程误判成当前成功
- gateway probe 改成系统分配的临时端口，不会再因固定探测端口冲突而自撞
