/**
 * NetBird 数据面 adapter 边界（ADR-N04 决策 5）。
 *
 * 本模块只声明 NetBird 运行时 adapter 的类型边界与 gate 关闭时的 noop 默认实现：
 * - gate 关闭（默认）时返回 noop，等价于 `data-plane/noop-adapter.ts` 的行为，
 *   `m-net-cn@0.1.x` 的 `controlPlaneOnly: true` decode-only 路径不受影响；
 * - gate 开启时同样不触碰任何运行时传输路径——真实 NetBird 客户端 sidecar
 *   编排（Signal / Relay / STUN 连接、peer/session 生命周期）**尚未实现**，
 *   在这里显式建模为 `runtimeTransport: 'not_implemented'`，而不是静默伪装成功。
 *
 * Viability gate 契约（ADR-N04 决策 4）：
 * - `bun run mnet:v02:sidecar-proof` 仅当 sidecar 启动、无 Management 模式 config 获取、
 *   peer/session 建立、干净停止四个环节全部完成才可成功；
 * - 若客户端路径需要被排除的 NetBird Management 行为，proof 以 nonzero 退出，
 *   本边界以 `NETBIRD_UNSUPPORTED_MANAGEMENT_DEPENDENCY` 描述该 typed outcome，
 *   调用方不得将其解释为可重试的传输故障。
 *
 * 密钥处理（ADR-N04 决策 7）：NetBird 客户端凭证只允许以 SecretRef 规则传递，
 * 不得进入日志、OpenSearch、UI error envelope 或 LLM context。
 *
 * 不引入任何真实 NetBird 逻辑；未来实现（sidecar 生命周期、peer/session 管理）
 * 必须实现 `NetbirdAdapter`，并保持 Meristem 为唯一授权与审计根（决策 2）。
 */

/** adapter 状态与 `data-plane/noop-adapter.ts` 的 DataPlaneAdapterStatus 对齐。 */
export type NetbirdAdapterStatus = 'noop' | 'deferred'

/**
 * ADR-N04 决策 4 定义的 proof 失败模式：客户端路径需要被排除的 Management 行为。
 * 该 outcome 表示"不可用"而不是"暂时失败"，调用方不得重试或降级到传输路径。
 */
export const NETBIRD_UNSUPPORTED_MANAGEMENT_DEPENDENCY = 'unsupported_management_dependency'

/** NetBird 侧探测到的被排除依赖（NetBird Management 系组件）的 typed outcome。 */
export type NetbirdUnsupportedManagementDependency = {
  readonly code: typeof NETBIRD_UNSUPPORTED_MANAGEMENT_DEPENDENCY
  readonly message: string
}

/** noop 边界结果：永远不会宣称传输可用或可变。 */
export interface NetbirdAdapterResult {
  /** 恒为 false：在真实实现落地前，adapter 不承载任何数据面传输。 */
  readonly enabled: false
  readonly status: NetbirdAdapterStatus
  /** 运行时传输未实现的显式语义；未来真实实现必须移除本字段并返回 enabled: true。 */
  readonly runtimeTransport: 'not_implemented'
}

/**
 * NetBird 数据面 adapter 契约。v0.2 仅存在 noop 默认实现；
 * 真实实现（sidecar 启停、无 Management config 获取、peer/session 建立）落地时
 * 需要扩展本接口，且不得改变 `controlPlaneOnly` decode-only 路径的语义。
 */
export interface NetbirdAdapter {
  /**
   * 探测 NetBird 客户端 sidecar 的可用性。
   * noop 实现永不触达运行时传输；真实实现需把 sidecar-proof 四环节映射为
   * 成功 / `NetbirdUnsupportedManagementDependency` / 可重试故障三类结果。
   */
  probeRuntime(): Promise<NetbirdAdapterResult | NetbirdUnsupportedManagementDependency>
}

/**
 * 创建 NetBird 数据面 adapter（默认 noop）。
 *
 * gate 关闭（默认，见 `DATA_PLANE_FEATURE_GATE_DEFAULT`）与 gate 开启时行为一致：
 * 返回 noop 且 `runtimeTransport: 'not_implemented'`，不做任何运行时传输路径变更。
 * 真实实现引入前，本工厂不得产生副作用。
 */
export function createNetbirdAdapter(_config: { enabled: boolean }): NetbirdAdapter {
  return {
    probeRuntime: async () => ({
      enabled: false,
      status: 'noop',
      runtimeTransport: 'not_implemented'
    })
  }
}
