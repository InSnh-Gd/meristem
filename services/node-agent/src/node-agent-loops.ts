/**
 * node-agent 周期环：心跳帧与 runtime sync 轮询的定时器所有权集中在本模块。
 * 从 index.ts 拆出以守住单文件 500 行预算（MERISTEM-DEV §8.2）。
 * reconcile 本体留在装配层注入，本模块只负责计时、重入保护与失败落 stderr。
 */
export type NodeAgentLoops = {
  startHeartbeat(): void
  stopHeartbeat(): void
  startRuntimeSyncLoop(): void
  stopRuntimeSyncLoop(): void
  triggerRuntimeSync(mode: 'join' | 'resume' | 'poll'): void
}

export type NodeAgentLoopsDeps = {
  sendFrame(frame: unknown): void
  /** 心跳帧构造所需事实，每次发送时即时读取，不做缓存。 */
  heartbeatFrame(): Record<string, unknown>
  /** tick 内双保险：session 尚未建立（或已被 close 清空）时不发帧，但保留定时器自愈。 */
  hasSession(): boolean
  reconcile(mode: 'join' | 'resume' | 'poll'): Promise<void>
  heartbeatIntervalMs(): number
  syncIntervalMs?: () => number
}

function syncIntervalMs(): number {
  const value = Number(
    process.env.MERISTEM_NODE_RUNTIME_SYNC_INTERVAL_MS ??
      process.env.MERISTEM_NODE_AGENT_POLL_INTERVAL_MS ??
      '5000'
  )
  return Number.isFinite(value) && value >= 1000 ? value : 5000
}

export function createNodeAgentLoops(deps: NodeAgentLoopsDeps): NodeAgentLoops {
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let runtimeSyncTimer: ReturnType<typeof setInterval> | null = null
  let runtimeSyncInFlight = false

  /** join.accepted / session.resumed 之后才开始发心跳，避免未认证连接提前污染节点运行态。 */
  function startHeartbeat(): void {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    heartbeatTimer = setInterval(() => {
      if (!deps.hasSession()) return
      deps.sendFrame(deps.heartbeatFrame())
    }, deps.heartbeatIntervalMs())
  }

  function stopHeartbeat(): void {
    if (!heartbeatTimer) return
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }

  function stopRuntimeSyncLoop(): void {
    if (!runtimeSyncTimer) return
    clearInterval(runtimeSyncTimer)
    runtimeSyncTimer = null
  }

  function triggerRuntimeSync(mode: 'join' | 'resume' | 'poll'): void {
    if (runtimeSyncInFlight) return
    runtimeSyncInFlight = true
    void deps
      .reconcile(mode)
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
    runtimeSyncTimer = setInterval(
      () => triggerRuntimeSync('poll'),
      (deps.syncIntervalMs ?? syncIntervalMs)()
    )
  }

  return {
    startHeartbeat,
    stopHeartbeat,
    startRuntimeSyncLoop,
    stopRuntimeSyncLoop,
    triggerRuntimeSync
  }
}
