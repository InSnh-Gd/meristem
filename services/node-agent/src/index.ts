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
  applySidecarDesiredState,
  stopSidecarLifecycle,
  type NodeAgentLifecycleState
} from './node-agent-sidecar-lifecycle.ts'
import {
  createInitialEnforcementState,
  type LocalOverlayEnv,
  loadLocalOverlayEnv,
  reconcileLocalOverlay
} from './node-agent-local-apply.ts'
import {
  decodeMessage,
  heartbeatIntervalMs,
  parseServerMessage,
  requiredOneOf
} from './node-agent-runtime.ts'
import {
  DEFAULT_NODE_AGENT_RUNTIME_STATE_PATH,
  loadRuntimeCredentials,
  saveRuntimeCredentials
} from './node-agent-runtime-state.ts'
import {
  deriveControlUrl,
  fetchLatestNodeRuntimeNetworkMap,
  registerNodeRuntimeKey
} from './node-agent-session.ts'
import { discoverPublicEndpoint } from './node-agent-stun.ts'
import {
  loadOrCreateWireGuardKeyMaterial,
  type WireGuardKeyMaterial
} from './node-agent-wireguard-keys.ts'

const agentVersion = process.env.MERISTEM_AGENT_VERSION ?? '0.1.0'
const joinUrl = process.env.MERISTEM_JOIN_URL ?? 'wss://localhost:8443/join/v0/session'
const configuredControlUrl = process.env.MERISTEM_MNET_CONTROL_URL
const runtimeStatePath =
  process.env.MERISTEM_NODE_RUNTIME_STATE_PATH ?? DEFAULT_NODE_AGENT_RUNTIME_STATE_PATH
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
let currentLifecycleState: NodeAgentLifecycleState = stopSidecarLifecycle({
  desiredState: 'stop',
  observedAt: new Date(0).toISOString(),
  correlationId: 'node-agent-bootstrap',
  reason: 'profile_disabled'
})
const localOverlayEnv: LocalOverlayEnv = loadLocalOverlayEnv()
let socket: WebSocket | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let runtimeSyncTimer: ReturnType<typeof setInterval> | null = null
let runtimeSyncInFlight = false
let stopping = false

function isIdempotentRuntimeKeyRegistrationFailure(reason: string): boolean {
  const normalized = reason.toLowerCase()
  return normalized.includes('duplicate') || normalized.includes('key.duplicate')
}

initTelemetry('node-agent')

function sendFrame(frame: unknown): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return
  socket.send(JSON.stringify(frame))
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
 * join.accepted / session.resumed 之后才开始发心跳，避免未认证连接提前污染节点运行态。
 */
function startHeartbeat(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  heartbeatTimer = setInterval(() => {
    if (!currentSessionId) return
    sendFrame({
      type: 'heartbeat',
      sessionId: currentSessionId,
      agentVersion,
      reportedStatus: currentLifecycleState.runtimeStatus.kind === 'healthy' ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      runtimeStatus: currentLifecycleState.runtimeStatus
    })
  }, heartbeatIntervalMs())
}

function stopHeartbeat(): void {
  if (!heartbeatTimer) return
  clearInterval(heartbeatTimer)
  heartbeatTimer = null
}

function runtimeSyncIntervalMs(): number {
  const value = Number(
    process.env.MERISTEM_NODE_RUNTIME_SYNC_INTERVAL_MS ??
      process.env.MERISTEM_NODE_AGENT_POLL_INTERVAL_MS ??
      '5000'
  )
  return Number.isFinite(value) && value >= 1000 ? value : 5000
}

function stopRuntimeSyncLoop(): void {
  if (!runtimeSyncTimer) return
  clearInterval(runtimeSyncTimer)
  runtimeSyncTimer = null
}

function triggerRuntimeSync(mode: 'join' | 'resume' | 'poll'): void {
  if (runtimeSyncInFlight) return
  runtimeSyncInFlight = true
  void reconcileNodeRuntimeState(mode)
    .catch(error => {
      process.stderr.write(
        `node runtime sync failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n`
      )
    })
    .finally(() => {
      runtimeSyncInFlight = false
    })
}

function startRuntimeSyncLoop(): void {
  stopRuntimeSyncLoop()
  runtimeSyncTimer = setInterval(() => triggerRuntimeSync('poll'), runtimeSyncIntervalMs())
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

  // STUN 发现公网 endpoint（仅尝试一次，缓存后续复用）
  if (!stunDiscoveryAttempted && !currentPublicEndpoint) {
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
    !isIdempotentRuntimeKeyRegistrationFailure(registration.reason)
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
  currentLifecycleState = await applySidecarDesiredState({
    nodeId,
    correlationId: lifecycleCorrelationId,
    observedAt,
    desired: latestMap.sidecar,
    runtimeMap: {
      networkId: latestMap.map.networkId,
      mapVersion: latestMap.map.mapVersion
    }
  })

  if (currentLifecycleState.runtimeStatus.kind !== 'healthy') {
    forwardLog('warn', 'node sidecar lifecycle is degraded', lifecycleCorrelationId, {
      nodeId,
      runtimeStatus: currentLifecycleState.runtimeStatus
    })
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
}

function stopLifecycle(reason: 'break_glass_stop' | 'profile_disabled'): void {
  currentLifecycleState = stopSidecarLifecycle({
    desiredState: currentLifecycleState.runtimeStatus.desiredState,
    observedAt: new Date().toISOString(),
    correlationId: crypto.randomUUID(),
    reason,
    process: currentLifecycleState.process
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
 * 断线重连保持单一退避入口，避免 onerror / onclose 等多个边界各自复制重连时序。
 */
function scheduleReconnect(): void {
  if (stopping) return
  setTimeout(() => {
    if (!stopping) connect()
  }, 1000)
}

/**
 * WebSocket 边界统一承载 join.redeem、session.resume、消息分发与重连回收。
 * 这里显式避免把服务端原始错误文本直接打印到 stderr，防止上游 message 意外携带敏感内容。
 */
function connect(): void {
  if (!joinTicket && (!nodeId || !runtimeToken)) {
    exitWithError('MERISTEM_JOIN_TICKET or MERISTEM_NODE_ID + MERISTEM_NODE_TOKEN is required')
  }

  const ws = new WebSocket(joinUrl)
  socket = ws

  // 首连优先兑换 Join Ticket；一旦拿到运行 token，后续所有断线重连都改走 session.resume。
  ws.onopen = () => {
    if (nodeId && runtimeToken) {
      sendFrame({
        type: 'session.resume',
        nodeId,
        token: runtimeToken
      })
      return
    }

    if (!joinTicket) {
      exitWithError('MERISTEM_JOIN_TICKET is required for the first join')
    }

    sendFrame({
      type: 'join.redeem',
      ticket: joinTicket
    })
  }

  // 消息处理集中在这一段，避免 join/session/task 三类服务器消息各自散落独立状态机。
  ws.onmessage = event => {
    void Promise.resolve(decodeMessage(event.data))
      .then(raw => {
        const message = parseServerMessage(raw)
        if (!message) {
          process.stderr.write('invalid session message received\n')
          return
        }

        if (message.type === 'join.accepted' || message.type === 'session.resumed') {
          handleAccepted(message)
          return
        }

        if (message.type === 'task.execute') {
          handleTaskExecute(message)
          return
        }

        if (message.type === 'error') {
          process.stderr.write(`join session rejected with code ${message.code}\n`)
          // Join Ticket 首连失败和 resume token 失效都属于“凭据已无效”的终态，继续自动重连只会制造噪音。
          if (
            message.code === 'nodeagent.invalid_token' ||
            (!runtimeToken && message.code.startsWith('node.join_ticket_'))
          ) {
            stopLifecycle('profile_disabled')
            stopping = true
            ws.close()
          }
        }
      })
      .catch(error => {
        process.stderr.write(
          `failed to process join session message: ${error instanceof Error ? error.name : 'unknown error'}\n`
        )
      })
  }

  // transport error 只作为链路事实输出，不拼接浏览器/WebSocket 栈里的任意原始文本。
  ws.onerror = () => {
    if (!stopping) process.stderr.write('join ingress websocket error\n')
  }

  // close 是唯一重连入口：它同时负责清空当前 session lease，避免旧 sessionId 继续出现在后续帧里。
  ws.onclose = () => {
    stopHeartbeat()
    stopRuntimeSyncLoop()
    stopLifecycle('break_glass_stop')
    currentSessionId = null
    if (!stopping) scheduleReconnect()
  }
}

if (!joinTicket && (!nodeId || !runtimeToken)) {
  requiredOneOf(['MERISTEM_JOIN_TICKET', 'MERISTEM_NODE_ID', 'MERISTEM_NODE_TOKEN'])
}

connect()

process.on('SIGINT', () => {
  stopping = true
  stopHeartbeat()
  stopRuntimeSyncLoop()
  forwardLog('warn', 'node agent stopping')
  socket?.close()
  void shutdownTelemetry().then(() => process.exit(0))
})
