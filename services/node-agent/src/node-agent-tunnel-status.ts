/**
 * 节点隧道状态上报：把 sidecar 健康与隧道可达性周期性上报到 M-Net 运营读模型。
 *
 * 设计边界：
 * - 健康结论只由观测事实推导（enforcement 状态 + sidecar 生命周期 + supervisor 状态），
 *   不在失败时伪装健康；
 * - Signal/Relay/STUN 可达性通过真实 TCP 探测获得，endpoint 来自 deployment config
 *   的 netbird 引用；解析失败按不可达处理，不猜测协议语义；
 * - 上报走 node-runtime REST 通道（runtime token 认证），M-Net 侧落 mnet.sidecar.health.v0。
 */
import type { AgentEnforcementState } from './node-agent-map-enforcement.ts'
import type { NodeAgentRuntimeStatus } from '../../../packages/contracts/src/index.ts'
import type { SidecarSupervisorState } from './node-agent-sidecar-supervisor.ts'
import { loadNetbirdEndpoints, type NetbirdEndpoints } from './node-agent-sidecar-lifecycle.ts'
import {
  reportNodeTunnelStatus,
  type NodeTunnelStatusReport,
  type NodeTunnelStatusReportResult
} from './node-agent-runtime-client.ts'
import type { SidecarSupervisor } from './node-agent-sidecar-supervisor.ts'

export type SidecarHealthStatus = NodeTunnelStatusReport['healthStatus']

export type TunnelStatusObservation = {
  enforcementStatus: AgentEnforcementState['status']
  sidecarRuntimeStatusKind: NodeAgentRuntimeStatus['kind']
  supervisorStateKind?: SidecarSupervisorState['kind']
}

/**
 * 从观测事实推导 sidecar 健康结论。fail_closed / stopped / gave_up 属于不可用；
 * degraded、starting、recovering、crashed 属于降级；applied 且健康才是 healthy。
 */
export function deriveSidecarHealthStatus(
  observation: TunnelStatusObservation
): SidecarHealthStatus {
  if (
    observation.enforcementStatus === 'fail_closed' ||
    observation.sidecarRuntimeStatusKind === 'stopped' ||
    observation.supervisorStateKind === 'gave_up'
  ) {
    return 'unhealthy'
  }
  if (
    observation.sidecarRuntimeStatusKind === 'degraded' ||
    observation.sidecarRuntimeStatusKind === 'starting' ||
    observation.supervisorStateKind === 'crashed' ||
    observation.supervisorStateKind === 'recovering' ||
    observation.enforcementStatus === 'stale'
  ) {
    return 'degraded'
  }
  if (
    observation.enforcementStatus === 'applied' &&
    observation.sidecarRuntimeStatusKind === 'healthy' &&
    (observation.supervisorStateKind === undefined || observation.supervisorStateKind === 'running')
  ) {
    return 'healthy'
  }
  return 'unknown'
}

/** 解析 endpoint 字符串为 host:port；支持 host:port 与带 scheme 的 URL，缺端口或失败返回 null。 */
export function parseEndpointHostPort(endpoint: string): { hostname: string; port: number } | null {
  const trimmed = endpoint.trim()
  if (trimmed.length === 0) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `tcp://${trimmed}`
  try {
    const url = new URL(withScheme)
    // 探测必须有显式端口；缺失端口的 endpoint 属于配置错误，不能靠默认值掩盖
    const port = url.port === '' ? NaN : Number(url.port)
    if (!url.hostname || !Number.isFinite(port) || port <= 0 || port > 65535) return null
    return { hostname: url.hostname, port }
  } catch {
    return null
  }
}

export type EndpointProbe = (endpoint: string) => Promise<boolean>

async function defaultProbeEndpoint(endpoint: string): Promise<boolean> {
  const target = parseEndpointHostPort(endpoint)
  if (!target) return false
  const timeout = new Promise<boolean>(resolve => setTimeout(() => resolve(false), 2000))
  const connection = Bun.connect({
    hostname: target.hostname,
    port: target.port,
    socket: {
      data() {},
      error() {},
      close() {}
    }
  })
    .then(socket => {
      void socket.end()
      return true
    })
    .catch(() => false)
  return Promise.race([connection, timeout])
}

export type TunnelStatusReporterOptions = {
  nodeId: () => string | null
  controlUrl: () => string | null
  nodeToken: () => string | null
  networkId: () => string | null
  profileVersion: () => string | null
  observation: () => TunnelStatusObservation
  supervisor?: SidecarSupervisor
  /** 上报间隔毫秒；环境变量 MERISTEM_TUNNEL_STATUS_REPORT_INTERVAL_MS 可覆盖，默认 30s。 */
  intervalMs?: number
  probeEndpoint?: EndpointProbe
  onReport?: (result: NodeTunnelStatusReportResult, report: NodeTunnelStatusReport) => void
  env?: NodeJS.ProcessEnv
  now?: () => Date
}

export type TunnelStatusReporter = {
  reportOnce(): Promise<NodeTunnelStatusReport | null>
  start(): void
  stop(): void
}

export function createTunnelStatusReporter(
  options: TunnelStatusReporterOptions
): TunnelStatusReporter {
  const env = options.env ?? process.env
  const now = options.now ?? (() => new Date())
  const probeEndpoint = options.probeEndpoint ?? defaultProbeEndpoint
  const configuredInterval = Number(
    env.MERISTEM_TUNNEL_STATUS_REPORT_INTERVAL_MS ?? options.intervalMs ?? 30_000
  )
  const intervalMs =
    Number.isFinite(configuredInterval) && configuredInterval >= 5_000 ? configuredInterval : 30_000

  let previousHealthStatus: SidecarHealthStatus = 'unknown'
  let timer: ReturnType<typeof setInterval> | null = null
  let reporting = false

  async function resolveReachability(): Promise<{
    signalReachable: boolean
    relayReachable: boolean
    stunReachable: boolean
  } | null> {
    const endpoints: NetbirdEndpoints | null = await loadNetbirdEndpoints()
    if (!endpoints) return null
    const [signalReachable, relayReachable, stunReachable] = await Promise.all([
      probeEndpoint(endpoints.signalEndpoint),
      probeEndpoint(endpoints.relayEndpoint),
      probeEndpoint(endpoints.stunEndpoint)
    ])
    return { signalReachable, relayReachable, stunReachable }
  }

  return {
    async reportOnce() {
      const nodeId = options.nodeId()
      const controlUrl = options.controlUrl()
      const nodeToken = options.nodeToken()
      const networkId = options.networkId()
      const profileVersion = options.profileVersion()
      if (!nodeId || !controlUrl || !nodeToken || !networkId || !profileVersion) return null
      if (reporting) return null
      reporting = true
      try {
        const reachability = await resolveReachability()
        if (!reachability) return null
        const healthStatus = deriveSidecarHealthStatus(options.observation())
        const report: NodeTunnelStatusReport = {
          networkId,
          profileVersion,
          healthStatus,
          previousHealthStatus,
          ...reachability,
          checkedAt: now().toISOString()
        }
        previousHealthStatus = healthStatus
        const result = await reportNodeTunnelStatus(controlUrl, nodeId, nodeToken, report)
        options.onReport?.(result, report)
        return report
      } finally {
        reporting = false
      }
    },

    start() {
      if (timer) return
      timer = setInterval(() => {
        void this.reportOnce()
      }, intervalMs)
    },

    stop() {
      if (!timer) return
      clearInterval(timer)
      timer = null
    }
  }
}

/** 暴露给 index.ts 的便捷组合：deployment config 缺失时 reporter 静默跳过上报。 */
export { loadNetbirdEndpoints }
