<script lang="ts">
  import type { OperationalStateData } from '$lib/types.ts'
  import InlineOperationalAlert from '$lib/components/ui/InlineOperationalAlert.svelte'
  import StateSourceBadge from '$lib/components/ui/StateSourceBadge.svelte'

  type SidecarNode = NonNullable<OperationalStateData['sidecars']>[number]

  let { operationalState, onRefresh, refreshing = false } = $props<{
    operationalState: OperationalStateData | null
    onRefresh?: () => void | Promise<void>
    refreshing?: boolean
  }>()

  const profileVersion = $derived(operationalState?.profileSelection.profileVersion ?? '')
  const compatibility = $derived(operationalState?.profileSelection.compatibility ?? 'unknown')
  const migrationRequired = $derived(operationalState?.migrationRequired.required ?? false)
  const sidecars = $derived(operationalState?.sidecars ?? [])
  const credentialsStatus = $derived(operationalState?.credentials.status ?? 'healthy')
  const topologyEdges = $derived(operationalState?.topology.edges ?? [])
  const readinessStatus = $derived(operationalState?.deploymentReadiness.status ?? 'healthy')
  const allSidecarsReady = $derived(
    sidecars.every((sidecar: SidecarNode) => sidecar.credentialStatus === 'ready' && sidecar.healthStatus === 'healthy' && !sidecar.stale)
  )
  const readySidecars = $derived(
    sidecars.filter((sidecar: SidecarNode) => sidecar.credentialStatus === 'ready' && sidecar.healthStatus === 'healthy' && !sidecar.stale)
  )
  const stepProfileStatus = $derived.by(() => {
    if (!profileVersion) return 'pending'
    if (compatibility === 'migration_required' || migrationRequired) return 'degraded'
    if (compatibility === 'compatible') return 'completed'
    return 'in_progress'
  })
  const stepSidecarStatus = $derived.by(() => {
    if (sidecars.length === 0) return 'pending'
    if (credentialsStatus === 'blocked') return 'blocked'
    if (credentialsStatus === 'degraded') return 'degraded'
    return allSidecarsReady ? 'completed' : 'in_progress'
  })
  const stepTopologyStatus = $derived.by(() => {
    if (topologyEdges.length === 0) return 'pending'
    if (readinessStatus === 'blocked') return 'blocked'
    if (readinessStatus === 'degraded') return 'degraded'
    return 'completed'
  })
  const sidecarsReadyCount = $derived(readySidecars.length)
  const sidecarsTotalCount = $derived(sidecars.length)
  const degradationReasons = $derived(operationalState?.deploymentReadiness.reasons ?? [])
</script>

<div class="progress-feed-card">
  <div class="feed-header">
    <div class="feed-title-block">
      <h4>实时运行状态与部署进度</h4>
      {#if operationalState}
        <StateSourceBadge source={operationalState.stateSource.sourceType} />
      {/if}
    </div>
    {#if onRefresh}
      <button class="refresh-btn" onclick={onRefresh} disabled={refreshing} data-testid="op-state-refresh-btn">
        {refreshing ? '刷新中...' : '刷新 / 重试'}
      </button>
    {/if}
  </div>

  {#if !operationalState}
    <div class="empty-state">
      <p>未加载到实时运行快照，请点击刷新重试。</p>
    </div>
  {:else}
    <div class="steps-timeline">
      <div class="step-item" class:completed={stepProfileStatus === 'completed'} class:degraded={stepProfileStatus === 'degraded'} data-testid="step-profile">
        <div class="step-marker">
          {#if stepProfileStatus === 'completed'}<span class="marker-icon">✓</span>{:else if stepProfileStatus === 'degraded'}<span class="marker-icon">⚠</span>{:else}<span class="marker-icon">1</span>{/if}
        </div>
        <div class="step-content">
          <div class="step-title">
            <h5>配置文件选择与兼容性</h5>
            <span class="status-tag {stepProfileStatus}">{stepProfileStatus === 'completed' ? '已完成' : stepProfileStatus === 'degraded' ? '需要迁移' : '进行中'}</span>
          </div>
          <p class="step-desc">当前应用配置: <span class="mono">{profileVersion || '未指定'}</span> ({operationalState.profileSelection.displayName})</p>
          {#if stepProfileStatus === 'degraded'}
            <div class="guidance-alert">
              <InlineOperationalAlert severity="warn" message="当前配置文件需要进行迁移，请在 [Profile 迁移] 页面执行迁移命令。" />
            </div>
          {/if}
        </div>
      </div>

      <div class="step-item" class:completed={stepSidecarStatus === 'completed'} class:degraded={stepSidecarStatus === 'degraded' || stepSidecarStatus === 'blocked'} data-testid="step-sidecar">
        <div class="step-marker">
          {#if stepSidecarStatus === 'completed'}<span class="marker-icon">✓</span>{:else if stepSidecarStatus === 'blocked' || stepSidecarStatus === 'degraded'}<span class="marker-icon">⚠</span>{:else}<span class="marker-icon">2</span>{/if}
        </div>
        <div class="step-content">
          <div class="step-title">
            <h5>Sidecar 凭证配置与代理启动</h5>
            <span class="status-tag {stepSidecarStatus}">{#if stepSidecarStatus === 'completed'}已完成{:else if stepSidecarStatus === 'blocked'}已阻断{:else if stepSidecarStatus === 'degraded'}已降级{:else}进行中{/if}</span>
          </div>
          <p class="step-desc">Sidecar 代理就绪状态: <span class="mono">{sidecarsReadyCount} / {sidecarsTotalCount}</span> 节点已启动</p>
          {#each sidecars as sidecar}
            {#if sidecar.credentialStatus === 'expired'}
              <div class="guidance-alert" data-testid="sidecar-expiry-warning-{sidecar.nodeId}">
                <InlineOperationalAlert severity="block" message="节点 {sidecar.nodeId} 的 Sidecar 凭证已过期！请转至 [节点凭证] 页面进行凭证轮换。" />
              </div>
            {/if}
            {#if sidecar.credentialStatus === 'missing'}
              <div class="guidance-alert" data-testid="sidecar-missing-warning-{sidecar.nodeId}">
                <InlineOperationalAlert severity="block" message="节点 {sidecar.nodeId} 缺失 Sidecar 凭证！" />
              </div>
            {/if}
          {/each}
        </div>
      </div>

      <div class="step-item" class:completed={stepTopologyStatus === 'completed'} class:degraded={stepTopologyStatus === 'degraded' || stepTopologyStatus === 'blocked'} data-testid="step-topology">
        <div class="step-marker">
          {#if stepTopologyStatus === 'completed'}<span class="marker-icon">✓</span>{:else if stepTopologyStatus === 'blocked' || stepTopologyStatus === 'degraded'}<span class="marker-icon">⚠</span>{:else}<span class="marker-icon">3</span>{/if}
        </div>
        <div class="step-content">
          <div class="step-title">
            <h5>网络拓扑与隧道构建</h5>
            <span class="status-tag {stepTopologyStatus}">{stepTopologyStatus === 'completed' ? '已就绪' : stepTopologyStatus === 'blocked' ? '已阻断' : '等待中'}</span>
          </div>
          <p class="step-desc">拓扑版本: <span class="mono">{operationalState.topology.topologyRevision || '无'}</span> | 活动边数量: <span class="mono">{topologyEdges.length}</span> 条连接</p>
          {#if topologyEdges.length === 0 && stepProfileStatus === 'completed'}
            <div class="guidance-alert">
              <InlineOperationalAlert severity="warn" message="等待中... 拓扑网络正等待第一个中继节点或对等节点状态更新。" />
            </div>
          {/if}
        </div>
      </div>
    </div>

    {#if degradationReasons.length > 0}
      <div class="degradation-guidance-panel" data-testid="degradation-guidance-panel">
        <h6>当前异常与修复指导</h6>
        <div class="reasons-list">
          {#each degradationReasons as reason}
            <div class="reason-card" data-testid="degradation-reason-card">
              <div class="reason-badge">{reason.code}</div>
              <div class="reason-body">
                <p class="reason-msg">{reason.message}</p>
                <p class="reason-guide">
                  {#if reason.code === 'credential_expired'}指导建议: 该节点的凭证已过期。请在下方 [凭证生命周期] 栏目中查看凭证引用，并进入 [节点凭证] 进行 [Rotate / Issue] 重试。{:else if reason.code === 'credential_missing'}指导建议: 该节点尚未颁发凭证。请在下方 [凭证生命周期] 栏目中查看凭证引用，并进入 [节点凭证] 进行 [Issue] 颁发。{:else if reason.code === 'eventbus_unavailable'}指导建议: 事件总线不可用。这代表 NATS 服务未正常连接或消息被阻断。请检查微服务容器状态。{:else if reason.code === 'sidecar_report_stale'}指导建议: 节点 {reason.nodeId || ''} 的 Sidecar 上报超时 (已超 60 秒)。请确保该节点 Agent 仍在正常运行且网络可达。{:else if reason.code === 'sidecar_unhealthy'}指导建议: 节点 {reason.nodeId || ''} 的 Sidecar 运行状况不佳。请检查该节点的连接环境。{:else if reason.code === 'migration_required'}指导建议: 配置文件存在不兼容变更，需要进行 Profile 迁移。请在 [Profile 迁移] 页面中执行迁移任务。{:else}指导建议: 请检查网络状态、中继可达性及密钥提供者状态。{/if}
                </p>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>
