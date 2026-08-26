import type {
  DeploymentConfigV02FromSchema,
  NodeAgentRuntimeDesiredSidecar,
  NodeAgentRuntimeStatus
} from '../../../packages/contracts/src/index.ts'
import type { SecretManager } from '../../../packages/secrets/src/index.ts'

/** 节点代理部署配置的默认宿主路径。 */
export const DEFAULT_DEPLOYMENT_CONFIG_PATH = '/etc/meristem/node-agent/deployment-v02.json'
/** NetBird sidecar 渲染配置的默认宿主路径。 */
export const DEFAULT_SIDECAR_CONFIG_PATH = '/run/meristem/netbird/sidecar.json'

type SidecarRuntimeMap = {
  networkId: string
  mapVersion: number
}

type SidecarProcessState = {
  processRef?: string
  sidecarConfigPath?: string
  configHash?: string
  processPid?: number
  processStartedAt?: string
  lastProbeAt?: string
  observedHealth?: 'healthy' | 'degraded' | 'unknown'
  degradedReason?: NodeAgentRuntimeStatus['degradedReasons'][number]
}

type CommandResult = {
  exitCode: number
  stdout: string
  stderr: string
}

/** 由 sidecar 运行时状态与本地进程快照组成的生命周期状态。 */
export type NodeAgentLifecycleState = {
  runtimeStatus: NodeAgentRuntimeStatus
  process: SidecarProcessState
}

/** 一次 sidecar 生命周期协调所需的期望状态与已有进程快照。 */
export type SidecarLifecycleInput = {
  nodeId: string
  correlationId: string
  observedAt: string
  desired: NodeAgentRuntimeDesiredSidecar
  runtimeMap: SidecarRuntimeMap
  currentProcess?: SidecarProcessState
}

/** sidecar 生命周期的宿主 I/O 与 SecretProvider 依赖。 */
export type SidecarLifecycleDependencies = {
  env?: NodeJS.ProcessEnv
  secretManager?: SecretManager
  deploymentConfig?: DeploymentConfigV02FromSchema
  readTextFile?: (path: string) => Promise<string>
  writeTextFile?: (path: string, contents: string) => Promise<void>
  mkdir?: (path: string) => Promise<void>
  spawnProcess?: (command: readonly string[], env: NodeJS.ProcessEnv) => Promise<{ pid: number }>
  runCommand?: (command: readonly string[], env: NodeJS.ProcessEnv) => Promise<CommandResult>
  killProcess?: (pid: number, signal: NodeJS.Signals) => Promise<void>
  isProcessRunning?: (pid: number) => boolean
}
