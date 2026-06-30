<script lang="ts">
  import { appState } from '$lib/stores.svelte.ts'
  import RouteHeader from '$lib/components/layout/RouteHeader.svelte'
  import InlineOperationalAlert from '$lib/components/ui/InlineOperationalAlert.svelte'
  import type { DataPlaneStatusResponseData, BffNetworkMapSummary } from '$lib/types.ts'
  import DataplaneStatusPanel from '$lib/components/modules/network/DataplaneStatusPanel.svelte'

  const stateSources = ['authoritative', 'read-model']

  let networkId = $state('')
  let status = $state<DataPlaneStatusResponseData | null>(null)
  let mapSummary = $state<BffNetworkMapSummary | null>(null)
  let loading = $state(false)
  let error = $state('')

  async function loadStatus() {
    if (!networkId || !appState.token) return
    loading = true
    error = ''
    status = null
    mapSummary = null
    try {
      const { fetchDataplaneStatus, fetchNetworkMapSummary } = await import('$lib/bff')
      const [statusResult, mapResult] = await Promise.all([
        fetchDataplaneStatus(appState.token, networkId),
        fetchNetworkMapSummary(appState.token, networkId).catch(() => null)
      ])
      status = statusResult
      mapSummary = mapResult
    } catch (e) {
      error = e instanceof Error ? e.message : '加载数据面状态失败'
    } finally {
      loading = false
    }
  }
</script>

<RouteHeader routeName="mnet.dataplane.status" {stateSources} />

<section class="dataplane-status-page">
  <div class="network-input-row workbench-panel">
    <input
      type="text"
      placeholder="输入网络 ID"
      bind:value={networkId}
      onkeydown={(e) => e.key === 'Enter' && loadStatus()}
    />
    <button class="workbench-btn workbench-btn-primary" onclick={loadStatus} disabled={!networkId || loading}>
      {loading ? '加载中...' : '查询'}
    </button>
  </div>

  {#if error}
    <InlineOperationalAlert message={error} severity="block" />
  {/if}

  {#if status && mapSummary}
    <DataplaneStatusPanel statusData={status} mapSummary={mapSummary} />
  {:else if status && !mapSummary}
    <div class="status-only workbench-panel">
      <p>数据面状态已加载，但网络地图摘要不可用。</p>
      <pre>{JSON.stringify(status, null, 2)}</pre>
    </div>
  {:else if !loading && !error}
    <div class="empty-hint">输入网络 ID 并点击查询以查看数据面状态</div>
  {/if}
</section>

<style>
  .dataplane-status-page {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
  }

  .network-input-row {
    display: flex;
    flex-direction: row;
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-3);
  }

  .network-input-row input {
    flex: 1;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--line-soft);
    border-radius: var(--control-radius);
    background: var(--surface-root);
    color: var(--text-100);
    font-size: var(--text-sm);
  }

  .network-input-row input:focus {
    border-color: var(--signal-info);
    outline: 1px solid var(--signal-info);
    outline-offset: 0;
  }

  .status-only,
  .empty-hint {
    color: var(--text-100);
  }

  .status-only pre {
    overflow-x: auto;
    margin: var(--space-3) 0 0;
    padding: var(--space-3);
    border-top: 1px solid var(--line-soft);
    color: var(--text-80);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: var(--lh-log);
    white-space: pre-wrap;
  }

  .empty-hint {
    padding: var(--space-8) var(--space-4);
    text-align: center;
    color: var(--text-60);
    font-size: var(--text-sm);
  }
</style>
