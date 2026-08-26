/** 多主机 Harness 前置检查可报告的确定性结果代码。 */
export type HarnessIssueCode =
  | 'ok'
  | 'harness.not_started'
  | 'host.wireguard_missing'
  | 'host.wireguard_module_missing'
  | 'host.cap_net_admin_missing'
  | 'host.wstunnel_missing'
  | 'docker.unavailable'
  | 'docker.image_missing'
  | 'docker.gateway_unreachable'

/** 多主机 Harness 前置检查的成功或可操作失败结果。 */
export type HarnessCheckResult =
  | {
      readonly ok: true
      readonly code: 'ok'
      readonly message: string
      readonly mode: 'docker-bridge'
      readonly details: {
        readonly dockerImage: string
        readonly wgBinaryPath: string
        readonly wstunnelBinaryPath: string
      }
    }
  | {
      readonly ok: false
      readonly code: Exclude<HarnessIssueCode, 'ok'>
      readonly message: string
      readonly hint: string
    }

export type HarnessServiceProcess = {
  readonly label: string
  readonly logFile: string
  readonly pid: number
}

export type HarnessLeafState = {
  readonly containerName: string
  readonly leafName: string
  readonly logFile: string
  readonly logPid: number
}

/** 多主机 Harness 写入磁盘以支持跨命令生命周期操作的状态。 */
export type HarnessState = {
  readonly dockerImage: string
  readonly dockerNetworkName: string
  readonly infraWasRunning: boolean
  readonly leafs: readonly HarnessLeafState[]
  readonly operatorToken: string
  readonly relay: {
    readonly healthUrl: string
    readonly logFile: string
    readonly pid: number
    readonly relayEndpoint: string
  }
  readonly services: readonly HarnessServiceProcess[]
  readonly startedAt: string
}

export type HarnessNodeStatus = {
  readonly found: boolean
  readonly id: string | null
  readonly kind: string | null
  readonly leafName: string
  readonly logFile: string
  readonly status: string | null
}

/** 多主机 Harness 控制面、Relay 与 Leaf 运行状况快照。 */
export type HarnessStatus = {
  readonly active: boolean
  readonly controlPlane: {
    readonly ready: boolean
    readonly url: string
  }
  readonly issue?: HarnessCheckResult
  readonly leafs: readonly HarnessNodeStatus[]
  readonly logFiles: readonly string[]
  readonly relay: {
    readonly endpoint: string | null
    readonly healthUrl: string | null
    readonly ready: boolean
  }
}
