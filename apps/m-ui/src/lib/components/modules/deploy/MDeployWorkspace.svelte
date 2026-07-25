<script lang="ts">
  import { onMount } from 'svelte'
  import RouteHeader from '$lib/components/layout/RouteHeader.svelte'
  import MDeployTopologyPanel from '$lib/components/modules/deploy/MDeployTopologyPanel.svelte'
  import InlineOperationalAlert from '$lib/components/ui/InlineOperationalAlert.svelte'
  import StateSourceBadge from '$lib/components/ui/StateSourceBadge.svelte'
  import {
    fetchMDeployStatus,
    fetchMDeployTopology,
    formatBffError,
    startMDeployApply,
    startMDeployRollback
  } from '$lib/bff.ts'
  import { appState } from '$lib/stores.svelte.ts'
  import type { MDeployOperationResult, MDeployStatusData, MDeployTopologyData } from '$lib/types.ts'

  const stateSources = ['authoritative', 'policy', 'audit']
  type PendingAction = 'apply' | 'rollback'

  let topology = $state<MDeployTopologyData | null>(null)
  let status = $state<MDeployStatusData | null>(null)
  let loadError = $state<string | null>(null)
  let proposalId = $state('')
  let agentId = $state('')
  let targetDigest = $state('')
  let pendingAction = $state<PendingAction | null>(null)
  let actionError = $state<string | null>(null)
  let actionResult = $state<MDeployOperationResult | null>(null)
  let running = $state(false)

  const canApply = $derived(proposalId.trim().length > 0 && agentId.trim().length > 0 && !running)
  const canRollback = $derived(agentId.trim().length > 0 && /^[a-f0-9]{64}$/.test(targetDigest) && !running)

  onMount(() => { void refresh() })

  /** 拓扑和状态均由 BFF 提供；任一上游降级必须显式呈现而非使用旧缓存替代。 */
  async function refresh() {
    if (!appState.token) return
    loadError = null
    try {
      const [nextTopology, nextStatus] = await Promise.all([
        fetchMDeployTopology(appState.token),
        fetchMDeployStatus(appState.token)
      ])
      topology = nextTopology
      status = nextStatus
    } catch (error: unknown) {
      loadError = formatBffError(error, 'M-Deploy 状态加载失败')
    }
  }

  function requestAction(action: PendingAction) {
    if ((action === 'apply' && !canApply) || (action === 'rollback' && !canRollback)) return
    pendingAction = action
    actionError = null
    actionResult = null
  }

  async function confirmAction() {
    if (!pendingAction || !appState.token) return
    running = true
    actionError = null
    try {
      actionResult = pendingAction === 'apply'
        ? await startMDeployApply(appState.token, proposalId.trim(), agentId.trim())
        : await startMDeployRollback(appState.token, agentId.trim(), {
            algorithm: 'sha256',
            value: targetDigest
          })
      pendingAction = null
      await refresh()
    } catch (error: unknown) {
      actionError = formatBffError(error, 'M-Deploy 操作失败')
    } finally {
      running = false
    }
  }
</script>

<svelte:head><title>M-Deploy 操作 | Meristem</title></svelte:head>

<section class="route-page" aria-labelledby="deploy-operations-title">
  <RouteHeader routeName="M-Deploy 操作" {stateSources} />

  {#if loadError}<InlineOperationalAlert message={loadError} severity="block" />{/if}

  {#if status}
    <section class="workbench-panel" aria-labelledby="deploy-operations-title">
      <div class="panel-header">
        <div><p class="workbench-eyebrow">部署状态</p><h2 id="deploy-operations-title" class="workbench-section-title">Desired-state 控制器</h2></div>
        <StateSourceBadge source={status.stateSource.sourceType} />
      </div>
      <dl class="workbench-meta-grid">
        <div><dt>controllerAvailable</dt><dd>{status.status.controllerAvailable ? '可用' : '不可用'}</dd></div>
        <div><dt>stale</dt><dd>{status.status.stale ? '是' : '否'}</dd></div>
        <div><dt>latestDigest</dt><dd>{status.status.latestDigest ? `${status.status.latestDigest.algorithm}:${status.status.latestDigest.value}` : '无'}</dd></div>
        <div><dt>syncedAt</dt><dd>{status.status.syncedAt ?? '无'}</dd></div>
      </dl>
    </section>
  {/if}

  {#if topology}<MDeployTopologyPanel data={topology} />{/if}

  <section class="workbench-panel command-well" aria-labelledby="deploy-command-title">
    <div><p class="workbench-eyebrow">CommandWell</p><h2 id="deploy-command-title" class="workbench-section-title">部署与回滚</h2></div>
    <p class="command-copy">高风险操作由下游 M-Policy 决策并写入 Audit；此页面只显示资格并通过 BFF 提交。</p>
    <label>proposalId<input bind:value={proposalId} class="mono" placeholder="待执行 proposal ID" /></label>
    <label>agentId<input bind:value={agentId} class="mono" placeholder="目标 agent ID" /></label>
    <label>回滚 SHA-256 digest（不含 sha256: 前缀）<input bind:value={targetDigest} class="mono" placeholder="64 位小写十六进制摘要" /></label>
    <div class="actions">
      <button class="workbench-btn workbench-btn-primary" type="button" disabled={!canApply} onclick={() => requestAction('apply')}>触发部署</button>
      <button class="workbench-btn workbench-btn-risk" type="button" disabled={!canRollback} onclick={() => requestAction('rollback')}>请求回滚</button>
    </div>
    {#if !canApply}<p class="disabled-reason">部署不可用：请填写 proposalId 和 agentId。</p>{/if}
    {#if !canRollback}<p class="disabled-reason">回滚不可用：需要 agentId 和 64 位 SHA-256 摘要。</p>{/if}
    {#if pendingAction}
      <div class="confirmation" role="alert">
        <strong>确认{pendingAction === 'apply' ? '触发部署' : '请求回滚'}？</strong>
        <p>目标 agent：<span class="mono">{agentId}</span>；需要 M-Policy 决策和 Audit 记录。</p>
        <button class="workbench-btn workbench-btn-primary" type="button" disabled={running} onclick={confirmAction}>{running ? '提交中…' : '确认提交'}</button>
        <button class="workbench-btn" type="button" disabled={running} onclick={() => pendingAction = null}>取消</button>
      </div>
    {/if}
    {#if actionError}<InlineOperationalAlert message={actionError} severity="block" />{/if}
    {#if actionResult}
      <div class="result"><p>操作已提交：<span class="mono">{actionResult.operation.operationId}</span></p><p>policyDecisionId：<span class="mono">{actionResult.operation.policyDecisionId}</span></p><p>correlationId：<span class="mono">{actionResult.operation.correlationId}</span></p></div>
    {/if}
  </section>
</section>

<style>
  .route-page, .command-well { display: flex; flex-direction: column; gap: var(--space-4); }
  .command-copy, label, .disabled-reason, .result { color: var(--text-80); font-size: var(--text-sm); }
  label { display: flex; flex-direction: column; gap: var(--space-1); }
  input { border: 1px solid var(--line-chrome-strong); border-radius: var(--control-radius); background: var(--surface-sunken); color: var(--text-100); padding: var(--space-2); }
  .actions, .confirmation { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
  .disabled-reason { color: var(--signal-block); }
  .confirmation, .result { border: 1px solid var(--signal-warn); border-radius: var(--control-radius); padding: var(--space-3); background: color-mix(in srgb, var(--signal-warn) 8%, var(--surface-panel)); }
</style>
