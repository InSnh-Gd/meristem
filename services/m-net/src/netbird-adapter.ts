/**
 * NetBird 数据面 adapter 边界（ADR-N04 决策 5）。
 *
 * gate 关闭（默认）时返回 noop，等价于 `data-plane/noop-adapter.ts` 的行为，
 * `m-net-cn@0.1.x` 的 `controlPlaneOnly: true` decode-only 路径不受影响。
 *
 * gate 开启且配置了 `MERISTEM_NETBIRD_CLIENT_BINARY` 时，probeRuntime 通过
 * `netbird status --json` 真实探测本地 NetBird 客户端 sidecar 进程状态：
 * - Signal/Relay 已连接且 Management 未接入 → `enabled: true` 的 sidecar 运行态；
 * - 客户端需要 NetBird Management → `NETBIRD_UNSUPPORTED_MANAGEMENT_DEPENDENCY`
 *   typed outcome（不可用，不可重试）；
 * - 二进制缺失、超时或输出不可解析 → `sidecar_unreachable` 可重试故障。
 *
 * Viability gate 契约（ADR-N04 决策 4）：
 * - `bun run mnet:v02:sidecar-proof` 仅当 sidecar 启动、无 Management 模式 config 获取、
 *   peer/session 建立、干净停止四个环节全部完成才可成功；
 * - proof 不通过时按 ADR-N04 回退到自有 WireGuard 渲染 + NetBird Signal/Relay 基础设施。
 *
 * 密钥处理（ADR-N04 决策 7）：NetBird 客户端凭证只允许以 SecretRef 规则传递，
 * 不得进入日志、OpenSearch、UI error envelope 或 LLM context；本模块只读取
 * status 输出中的连接状态，不输出任何凭证字段。
 *
 * Meristem 是唯一授权与审计根（决策 2）：探测只读，绝不向 NetBird Management 注册。
 */

/** adapter 状态与 `data-plane/noop-adapter.ts` 的 DataPlaneAdapterStatus 对齐。 */
export type NetbirdAdapterStatus = 'noop' | 'deferred' | 'sidecar_running' | 'sidecar_unreachable'

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

/** NetBird 客户端 status 输出中与本边界相关的连接状态切片。 */
export type NetbirdRuntimeState = {
  readonly signalConnected: boolean
  readonly relayConnected: boolean
  readonly managementConnected: boolean
  readonly peerCount: number
}

/** sidecar 运行态结果：探测到真实可用的 NetBird 客户端 sidecar。 */
export interface NetbirdSidecarRunningResult {
  readonly enabled: true
  readonly status: 'sidecar_running'
  readonly runtimeTransport: 'netbird_sidecar'
  readonly runtime: NetbirdRuntimeState
  readonly probedAt: string
}

/** sidecar 不可达结果：二进制缺失、超时或输出不可解析；可重试。 */
export interface NetbirdSidecarUnreachableResult {
  readonly enabled: false
  readonly status: 'sidecar_unreachable'
  readonly runtimeTransport: 'netbird_sidecar'
  readonly reason: string
  readonly probedAt: string
}

/** noop 边界结果：永远不会宣称传输可用或可变。 */
export interface NetbirdAdapterResult {
  /** gate 未开启时的恒定形态；gate 开启后由 running/unreachable 结果取代。 */
  readonly enabled: false
  readonly status: Extract<NetbirdAdapterStatus, 'noop' | 'deferred'>
  /** 运行时传输未实现的显式语义；真实实现路径返回 `netbird_sidecar`。 */
  readonly runtimeTransport: 'not_implemented'
}

export type NetbirdProbeOutcome =
  | NetbirdAdapterResult
  | NetbirdSidecarRunningResult
  | NetbirdSidecarUnreachableResult
  | NetbirdUnsupportedManagementDependency

/** 从 `netbird status --json` 输出中提取连接状态切片的最小结构。 */
type NetbirdStatusOutput = {
  ManagementState?: { Connected?: boolean }
  SignalState?: { Connected?: boolean }
  RelayState?: { Connected?: boolean; URI?: string }
  Peers?: unknown[]
}

export type NetbirdAdapterProbeDependencies = {
  /** 执行探测命令的注入点；生产默认 Bun.spawn 加超时守护，测试注入受控结果。 */
  runStatusCommand?: (binary: string) => Promise<{ exitCode: number; stdout: string }>
  /** 显式客户端二进制路径；未提供时回退到 MERISTEM_NETBIRD_CLIENT_BINARY。 */
  clientBinary?: string
  now?: () => Date
}

function defaultRunStatusCommand(binary: string): Promise<{ exitCode: number; stdout: string }> {
  const proc = Bun.spawn([binary, 'status', '--json'], {
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const timeout = new Promise<{ exitCode: number; stdout: string }>(resolve => {
    setTimeout(() => {
      proc.kill()
      resolve({ exitCode: 124, stdout: '' })
    }, 5000)
  })
  const finished = proc.exited.then(async exitCode => ({
    exitCode,
    stdout: await new Response(proc.stdout as ReadableStream).text()
  }))
  return Promise.race([finished, timeout])
}

export function parseNetbirdStatusOutput(stdout: string): NetbirdRuntimeState | null {
  let parsed: NetbirdStatusOutput
  try {
    parsed = JSON.parse(stdout) as NetbirdStatusOutput
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  return {
    signalConnected: parsed.SignalState?.Connected === true,
    relayConnected: parsed.RelayState?.Connected === true,
    // Management 接入属于 ADR-N04 排除路径，即使客户端报告连接也必须按不可用处理
    managementConnected: parsed.ManagementState?.Connected === true,
    peerCount: Array.isArray(parsed.Peers) ? parsed.Peers.length : 0
  }
}

/** NetBird 数据面 adapter 契约：探测 sidecar 运行态并返回 typed outcome。 */
export interface NetbirdAdapter {
  probeRuntime(): Promise<NetbirdProbeOutcome>
}

/**
 * 创建 NetBird 数据面 adapter。
 *
 * - `enabled: false` 或未配置客户端二进制 → noop 工厂，不产生任何副作用；
 * - 配置了 `MERISTEM_NETBIRD_CLIENT_BINARY` → probeRuntime 真实执行 status 探测。
 */
export function createNetbirdAdapter(
  config: { enabled: boolean },
  probeDependencies: NetbirdAdapterProbeDependencies = {}
): NetbirdAdapter {
  const runStatusCommand = probeDependencies.runStatusCommand ?? defaultRunStatusCommand
  const now = probeDependencies.now ?? (() => new Date())

  return {
    async probeRuntime(): Promise<NetbirdProbeOutcome> {
      // 二进制路径在每次探测时读取，保持工厂无副作用并便于测试注入
      const binary = probeDependencies.clientBinary ?? process.env.MERISTEM_NETBIRD_CLIENT_BINARY
      if (!config.enabled || !binary) {
        return {
          enabled: false,
          status: 'noop',
          runtimeTransport: 'not_implemented'
        }
      }
      let result: { exitCode: number; stdout: string }
      try {
        result = await runStatusCommand(binary)
      } catch (error) {
        return {
          enabled: false,
          status: 'sidecar_unreachable',
          runtimeTransport: 'netbird_sidecar',
          reason: error instanceof Error ? error.message : 'netbird status probe failed to start',
          probedAt: now().toISOString()
        }
      }

      const runtime = parseNetbirdStatusOutput(result.stdout)
      if (result.exitCode !== 0 || runtime === null) {
        return {
          enabled: false,
          status: 'sidecar_unreachable',
          runtimeTransport: 'netbird_sidecar',
          reason: `netbird status exited with ${result.exitCode} or returned unparsable output`,
          probedAt: now().toISOString()
        }
      }

      if (runtime.managementConnected) {
        return {
          code: NETBIRD_UNSUPPORTED_MANAGEMENT_DEPENDENCY,
          message:
            'netbird client is connected to a NetBird Management server; Meristem excludes Management per ADR-N04'
        }
      }

      return {
        enabled: true,
        status: 'sidecar_running',
        runtimeTransport: 'netbird_sidecar',
        runtime,
        probedAt: now().toISOString()
      }
    }
  }
}
