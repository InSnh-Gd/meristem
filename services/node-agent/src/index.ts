import { loadRuntimeDeploymentConfigOrThrow } from '../../../packages/config/src/index.ts'
import type {
  JoinAcceptedMessage,
  SessionResumedMessage,
  SessionTaskExecuteMessage
} from '../../../packages/contracts/src/index.ts'
import {
  currentTraceId,
  initTelemetry,
  shutdownTelemetry
} from '../../../packages/telemetry/src/index.ts'
import {
  createInitialEnforcementState,
  type LocalOverlayEnv,
  loadLocalOverlayEnv,
  reconcileLocalOverlay,
  teardownLocalOverlay
} from './node-agent-local-apply.ts'
import { createNodeAgentLoops } from './node-agent-loops.ts'
import {
  heartbeatIntervalMs,
  requiredOneOf,
  resolveAgentReportedStatus
} from './node-agent-runtime.ts'
import { fetchLatestNodeRuntimeNetworkMap, leaveNetwork } from './node-agent-runtime-client.ts'
import {
  DEFAULT_NODE_AGENT_RUNTIME_STATE_PATH,
  loadRuntimeCredentials,
  saveRuntimeCredentials
} from './node-agent-runtime-state.ts'
import { deriveControlUrl, registerNodeRuntimeKey } from './node-agent-session.ts'
import { createSessionTransport } from './node-agent-session-transport.ts'
import {
  applySidecarDesiredState,
  createNodeAgentSecretManager,
  type NodeAgentLifecycleState,
  stopSidecarLifecycle
} from './node-agent-sidecar-lifecycle.ts'
import { createSidecarSupervisor, type SidecarSupervisor } from './node-agent-sidecar-supervisor.ts'
import { discoverPublicEndpoint } from './node-agent-stun.ts'
import { createTunnelStatusReporter } from './node-agent-tunnel-status.ts'
import {
  loadOrCreateWireGuardKeyMaterial,
  type WireGuardKeyMaterial
} from './node-agent-wireguard-keys.ts'

// 版本自报参与 M-Net v0.3 legacy 判定（0.1.* 会被视为 legacy 运行时拒绝数据面）；
// 默认值必须随仓库当前版本演进，不能停留在 0.1.0。
const agentVersion = process.env.MERISTEM_AGENT_VERSION ?? '0.2.0'
const joinUrl = process.env.MERISTEM_JOIN_URL ?? 'wss://localhost:8443/join/v0/session'
const configuredControlUrl = process.env.MERISTEM_MNET_CONTROL_URL
const runtimeStatePath =
  process.env.MERISTEM_NODE_RUNTIME_STATE_PATH ?? DEFAULT_NODE_AGENT_RUNTIME_STATE_PATH
const runtimeDeploymentConfig = await loadRuntimeDeploymentConfigOrThrow()
const nodeAgentSecretManager = createNodeAgentSecretManager(runtimeDeploymentConfig.raw)
const persistedRuntimeCredentials = loadRuntimeCredentials(runtimeStatePath)

let joinTicket = process.env.MERISTEM_JOIN_TICKET
let nodeId = process.env.MERISTEM_NODE_ID ?? persistedRuntimeCredentials?.nodeId
let runtimeToken = process.env.MERISTEM_NODE_TOKEN ?? persistedRuntimeCredentials?.runtimeToken
let currentSessionId: string | null = null
let currentControlUrl: string | null = null
let currentWireGuardKey: WireGuardKeyMaterial | null = null
let currentPublicEndpoint: string | null = null
let stunDiscoveryAttempted = false
let currentEnforcementState = createInitialEnforcementState('network-pending')
let currentLifecycleState: NodeAgentLifecycleState = await stopSidecarLifecycle({
  desiredState: 'stop',
  observedAt: new Date(0).toISOString(),
  correlationId: 'node-agent-bootstrap',
  reason: 'profile_disabled'
})
const localOverlayEnv: LocalOverlayEnv = loadLocalOverlayEnv()
let stopping = false
// 运行时同步应用的最新网络地图事实，供隧道状态上报读取
let currentNetworkId: string | null = null
let currentMapProfileVersion: string | null = null

// NetBird 客户端进程监督器仅在配置了客户端二进制时启用；未配置时生命周期退化为配置写入
const netbirdClientBinary = process.env.MERISTEM_NETBIRD_CLIENT_BINARY
const sidecarSupervisor: SidecarSupervisor | null = netbirdClientBinary
  ? createSidecarSupervisor({
      binaryPath: netbirdClientBinary,
      configPath:
        process.env.MERISTEM_NODE_AGENT_SIDECAR_CONFIG_PATH ?? '/run/meristem/netbird/sidecar.json'
    })
  : null

const tunnelStatusReporter = createTunnelStatusReporter({
  nodeId: () => nodeId ?? null,
  controlUrl: () => currentControlUrl,
  nodeToken: () => runtimeToken ?? null,
  networkId: () => currentNetworkId,
  profileVersion: () => currentMapProfileVersion,
  observation: () => ({
    enforcementStatus: currentEnforcementState.status,
    sidecarRuntimeStatusKind: currentLifecycleState.runtimeStatus.kind,
    ...(sidecarSupervisor ? { supervisorStateKind: sidecarSupervisor.state().kind } : {})
  }),
  ...(sidecarSupervisor ? { supervisor: sidecarSupervisor } : {}),
  onReport: result => {
    if (result.kind === 'runtime.request_failed') {
      process.stderr.write(`tunnel status report failed: ${result.reason}\n`)
    }
  }
})

function isIdempotentRuntimeKeyRegistrationFailure(reason: string): boolean {
  const normalized = reason.toLowerCase()
  return normalized.includes('duplicate') || normalized.includes('key.duplicate')
}

/** 入网前没有成员身份，运行时密钥注册必然 404：良性状态，静默等待 join 后重试。 */
function isPreMembershipRegistrationFailure(reason: string): boolean {
  const normalized = reason.toLowerCase()
  return normalized.includes('network.not_found') || normalized.includes('network not found')
}

initTelemetry('node-agent')

function sendFrame(frame: unknown): void {
  // transport 声明在本行之后，sendFrame 为提升函数且首次调用必然晚于模块初始化，无 TDZ 风险。
  transport.send(frame)
}

/**
 * agent 侧所有运行日志都通过 `log.forward` 回送 M-Net，由 M-Net 负责补全节点身份并落库。
 */
function forwardLog(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  correlationId?: string,
  payload?: unknown
): void {
  const traceId = currentTraceId()
  if (!currentSessionId) return
  sendFrame({
    type: 'log.forward',
    sessionId: currentSessionId,
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(correlationId ? { correlationId } : {}),
    ...(traceId ? { traceId } : {}),
    ...(payload === undefined ? {} : { payload })
  })
}

/**
 * join.accepted / session.resumed 之后才开始发心跳；心跳帧事实每次即时读取。
 */
const loops = createNodeAgentLoops({
  sendFrame,
  hasSession: () => currentSessionId !== null,
  heartbeatFrame: () => ({
    type: 'heartbeat',
    sessionId: currentSessionId,
    agentVersion,
    reportedStatus: resolveAgentReportedStatus(
      currentEnforcementState.partition.networkId,
      currentLifecycleState.runtimeStatus.kind
    ),
    timestamp: new Date().toISOString(),
    runtimeStatus: currentLifecycleState.runtimeStatus
  }),
  reconcile: mode => reconcileNodeRuntimeState(mode),
  heartbeatIntervalMs
})

function startHeartbeat(): void {
  loops.startHeartbeat()
}

function stopHeartbeat(): void {
  loops.stopHeartbeat()
}

function stopRuntimeSyncLoop(): void {
  loops.stopRuntimeSyncLoop()
}

function triggerRuntimeSync(mode: 'join' | 'resume' | 'poll'): void {
  if (!nodeId || !runtimeToken) return
  loops.triggerRuntimeSync(mode)
}

function startRuntimeSyncLoop(): void {
  loops.startRuntimeSyncLoop()
}

function exitWithError(message: string): never {
  process.stderr.write(`${message}\n`)
  stopping = true
  stopHeartbeat()
  stopRuntimeSyncLoop()
  void shutdownTelemetry().then(() => process.exit(1))
  throw new Error(message)
}

async function reconcileNodeRuntimeState(mode: 'join' | 'resume' | 'poll'): Promise<void> {
  if (!nodeId || !runtimeToken) return

  const controlUrl = currentControlUrl ?? configuredControlUrl ?? deriveControlUrl(joinUrl)
  if (!controlUrl) {
    forwardLog('error', 'node runtime control url is invalid')
    return
  }
  currentControlUrl = controlUrl

  const keyMaterial = currentWireGuardKey ?? (await loadOrCreateWireGuardKeyMaterial())
  currentWireGuardKey = keyMaterial

  // 广播 endpoint：显式覆盖优先（1:1 NAT 云主机 / 同宿主容器桥等 STUN 不可达场景），
  // 否则 STUN 发现公网映射（仅尝试一次，缓存后续复用）。
  const advertisedEndpoint = process.env.MERISTEM_NODE_AGENT_ADVERTISED_ENDPOINT
  if (advertisedEndpoint) {
    currentPublicEndpoint = advertisedEndpoint
  } else if (!stunDiscoveryAttempted && !currentPublicEndpoint) {
    stunDiscoveryAttempted = true
    const stunResult = await discoverPublicEndpoint()
    if (stunResult.ok) {
      currentPublicEndpoint = `${stunResult.endpoint.ip}:${stunResult.endpoint.port}`
      process.stdout.write(`node public endpoint discovered via STUN: ${currentPublicEndpoint}\n`)
    } else {
      process.stderr.write(`STUN discovery failed: ${stunResult.reason}\n`)
    }
  }

  const registration = await registerNodeRuntimeKey(controlUrl, nodeId, runtimeToken, {
    keyId: keyMaterial.keyId,
    publicKey: keyMaterial.publicKey,
    createdAt: keyMaterial.createdAt,
    ...(currentPublicEndpoint ? { endpoint: currentPublicEndpoint } : {})
  })
  const keyCorrelationId =
    registration.kind === 'runtime.key.registered' ? registration.correlationId : undefined
  if (
    registration.kind !== 'runtime.key.registered' &&
    !isIdempotentRuntimeKeyRegistrationFailure(registration.reason) &&
    !isPreMembershipRegistrationFailure(registration.reason)
  ) {
    process.stderr.write(`node runtime key registration failed: ${registration.reason}\n`)
    forwardLog('error', 'failed to register node runtime key', undefined, {
      nodeId,
      reason: registration.reason
    })
    return
  }
  if (registration.kind !== 'runtime.key.registered') {
    process.stderr.write(
      `node runtime key registration already satisfied: ${registration.reason}\n`
    )
  }

  const latestMap = await fetchLatestNodeRuntimeNetworkMap(controlUrl, nodeId, runtimeToken)
  if (latestMap.kind !== 'runtime.network_map.fetched') {
    process.stderr.write(`node runtime network map fetch failed: ${latestMap.reason}\n`)
    forwardLog('error', 'failed to fetch latest runtime network map', keyCorrelationId, {
      nodeId,
      reason: latestMap.reason
    })
    return
  }

  const observedAt = new Date().toISOString()
  const lifecycleCorrelationId = crypto.randomUUID()
  currentLifecycleState = await applySidecarDesiredState(
    {
      nodeId,
      correlationId: lifecycleCorrelationId,
      observedAt,
      desired: latestMap.sidecar,
      runtimeMap: {
        networkId: latestMap.map.networkId,
        mapVersion: latestMap.map.mapVersion
      },
      currentProcess: currentLifecycleState.process
    },
    {
      deploymentConfig: runtimeDeploymentConfig.raw,
      secretManager: nodeAgentSecretManager,
      ...(sidecarSupervisor ? { supervisor: sidecarSupervisor } : {})
    }
  )
  currentNetworkId = latestMap.map.networkId
  currentMapProfileVersion = latestMap.map.profileVersion

  if (currentLifecycleState.runtimeStatus.kind !== 'healthy') {
    forwardLog('warn', 'node sidecar lifecycle is degraded', lifecycleCorrelationId, {
      nodeId,
      runtimeStatus: currentLifecycleState.runtimeStatus
    })
  }

  // 退出语义：M-Net 期望态为 stop/drain 时，agent 主动拆除本地隧道并通知 M-Net 移除成员关系
  if (latestMap.sidecar.desiredState === 'stop' || latestMap.sidecar.desiredState === 'drain') {
    await teardownLocalOverlay(localOverlayEnv)
    currentEnforcementState = createInitialEnforcementState(latestMap.map.networkId)
    if (currentControlUrl && runtimeToken) {
      const leave = await leaveNetwork(
        currentControlUrl,
        nodeId,
        runtimeToken,
        latestMap.map.networkId
      )
      if (leave.kind === 'runtime.request_failed') {
        forwardLog('warn', 'node leave notification failed', lifecycleCorrelationId, {
          nodeId,
          reason: leave.reason
        })
      } else {
        forwardLog('info', 'node left network', lifecycleCorrelationId, {
          nodeId,
          networkId: leave.networkId
        })
      }
    }
    return
  }

  const localOverlay = await reconcileLocalOverlay({
    env: localOverlayEnv,
    map: latestMap.map,
    agentNodeId: nodeId,
    keyMaterial,
    currentState:
      currentEnforcementState.partition.networkId === latestMap.map.networkId
        ? currentEnforcementState
        : createInitialEnforcementState(latestMap.map.networkId),
    nowMs: Date.now(),
    serverTime: new Date().toISOString()
  })
  currentEnforcementState = localOverlay.state

  if (localOverlay.kind === 'torn_down') {
    process.stderr.write(
      `node runtime overlay torn down: ${localOverlay.reason} (${localOverlay.state.status})\n`
    )
    forwardLog('warn', 'node runtime overlay torn down', keyCorrelationId, {
      nodeId,
      reason: localOverlay.reason,
      status: localOverlay.state.status
    })
    return
  }

  forwardLog('info', 'node runtime state synchronized', keyCorrelationId, {
    nodeId,
    keyId: registration.kind === 'runtime.key.registered' ? registration.keyId : keyMaterial.keyId,
    mapVersion: latestMap.map.mapVersion,
    mode,
    configHash: localOverlay.configHash,
    sidecarStatus: currentLifecycleState.runtimeStatus,
    interfaceName: localOverlayEnv.interfaceName,
    localTunnelIp: localOverlay.localTunnelIp
  })
  process.stdout.write(
    `node runtime state synchronized: node=${nodeId} mapVersion=${latestMap.map.mapVersion} tunnelIp=${localOverlay.localTunnelIp ?? 'unknown'} mode=${mode}\n`
  )
}

/**
 * join.accepted 会回传新的运行 token；resume 只恢复既有 token 对应的活动 session。
 * 依据 docs/services/node-agent.md §10，运行 token 只能进入内存与后续 resume，不得出现在 stdout。
 */
function handleAccepted(message: JoinAcceptedMessage | SessionResumedMessage): void {
  nodeId = message.node.id
  currentSessionId = message.sessionId
  currentControlUrl = configuredControlUrl ?? deriveControlUrl(joinUrl)
  if (message.type === 'join.accepted') {
    runtimeToken = message.runtimeToken
    joinTicket = undefined
    process.stdout.write(`node-agent joined as ${message.node.id}\n`)
  } else {
    process.stdout.write(`node-agent resumed session for ${message.node.id}\n`)
  }
  if (runtimeToken) {
    saveRuntimeCredentials({ nodeId: message.node.id, runtimeToken }, runtimeStatePath)
  }
  startHeartbeat()
  forwardLog(
    'info',
    message.type === 'join.accepted' ? 'node agent joined' : 'node agent resumed',
    undefined,
    {
      nodeId: message.node.id,
      mode: message.node.mode
    }
  )
  triggerRuntimeSync(message.type === 'join.accepted' ? 'join' : 'resume')
  startRuntimeSyncLoop()
  tunnelStatusReporter.start()
}

function stopLifecycle(reason: 'break_glass_stop' | 'profile_disabled'): void {
  void stopSidecarLifecycle({
    desiredState: currentLifecycleState.runtimeStatus.desiredState,
    observedAt: new Date().toISOString(),
    correlationId: crypto.randomUUID(),
    reason,
    process: currentLifecycleState.process
  }).then(nextState => {
    currentLifecycleState = nextState
  })
}

/**
 * 当前 agent 只执行 noop；任何其他 taskType 都必须显式拒绝并回送日志事实。
 */
function handleTaskExecute(message: SessionTaskExecuteMessage): void {
  if (message.taskType !== 'noop') {
    forwardLog('warn', 'rejected unsupported task execution request', message.correlationId, {
      taskId: message.taskId,
      taskType: message.taskType
    })
    return
  }

  sendFrame({
    type: 'task.result',
    sessionId: currentSessionId,
    taskId: message.taskId,
    result: 'completed',
    completedAt: new Date().toISOString()
  })
  forwardLog('info', `completed noop task ${message.taskId}`, message.correlationId, {
    taskId: message.taskId
  })
}

/**
 * WebSocket 边界统一承载 join.redeem、session.resume、消息分发与重连回收；
 * transport 细节在 node-agent-session-transport.ts，本文件提供凭据 getter 与事件回收钩子。
 */
const transport = createSessionTransport(joinUrl, {
  credentials: () => ({
    ...(joinTicket ? { joinTicket } : {}),
    ...(nodeId ? { nodeId } : {}),
    ...(runtimeToken ? { runtimeToken } : {})
  }),
  onCredentialsMissing: () => exitWithError('MERISTEM_JOIN_TICKET is required for the first join'),
  onAccepted: message => handleAccepted(message),
  onTaskExecute: message => handleTaskExecute(message),
  onServerError: message => {
    // Join Ticket 首连失败和 resume token 失效都属于“凭据已无效”的终态，继续自动重连只会制造噪音。
    if (
      message.code === 'nodeagent.invalid_token' ||
      (!runtimeToken && message.code.startsWith('node.join_ticket_'))
    ) {
      stopLifecycle('profile_disabled')
      stopping = true
      transport.close()
    }
  },
  sendFrame,
  onClosed: () => {
    stopHeartbeat()
    stopRuntimeSyncLoop()
    tunnelStatusReporter.stop()
    stopLifecycle('break_glass_stop')
    currentSessionId = null
  },
  scheduleReconnect: () => {
    if (stopping) return
    setTimeout(() => {
      // 统一走 index 的 connect()：凭据异常经 exitWithError 受控退出，而不是在定时器回调里裸抛。
      if (!stopping) connect()
    }, 1000)
  }
})

/** 断线重连保持单一退避入口，避免 onerror / onclose 等多个边界各自复制重连时序。 */
function connect(): void {
  if (!joinTicket && (!nodeId || !runtimeToken)) {
    exitWithError('MERISTEM_JOIN_TICKET or MERISTEM_NODE_ID + MERISTEM_NODE_TOKEN is required')
  }
  transport.connect()
}

if (!joinTicket && (!nodeId || !runtimeToken)) {
  requiredOneOf(['MERISTEM_JOIN_TICKET', 'MERISTEM_NODE_ID', 'MERISTEM_NODE_TOKEN'])
}

connect()

process.on('SIGINT', () => {
  stopping = true
  stopHeartbeat()
  stopRuntimeSyncLoop()
  tunnelStatusReporter.stop()
  forwardLog('warn', 'node agent stopping')
  transport.close()
  // sidecar 进程必须优雅回收，避免 NetBird 客户端残留持有隧道接口
  const sidecarStop = sidecarSupervisor ? sidecarSupervisor.stop() : Promise.resolve()
  void Promise.all([sidecarStop, shutdownTelemetry()]).then(() => process.exit(0))
})
