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

<div class="dataplane-status-page">
  <div class="network-input-row">
    <input
      type="text"
      placeholder="输入网络 ID"
      bind:value={networkId}
      onkeydown={(e) => e.key === 'Enter' && loadStatus()}
    />
    <button onclick={loadStatus} disabled={!networkId || loading}>
      {loading ? '加载中...' : '查询'}
    </button>
  </div>

  {#if error}
    <InlineOperationalAlert message={error} severity="block" />
  {/if}

  {#if status && mapSummary}
    <DataplaneStatusPanel statusData={status} mapSummary={mapSummary} />
  {:else if status && !mapSummary}
    <div class="status-only">
      <p>数据面状态已加载，但网络地图摘要不可用。</p>
      <pre>{JSON.stringify(status, null, 2)}</pre>
    </div>
  {:else if !loading && !error}
    <div class="empty-hint">输入网络 ID 并点击查询以查看数据面状态</div>
  {/if}
</div>

<style>
  .dataplane-status-page {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
  }

  .network-input-row {
    display: flex;
    gap: 0.5rem;
  }

  .network-input-row input {
    flex: 1;
    padding: 0.5rem;
    border: 1px solid var(--border-color, #ccc);
    border-radius: 4px;
  }

  .network-input-row button {
    padding: 0.5rem 1rem;
    border: 1px solid var(--border-color, #ccc);
    border-radius: 4px;
    cursor: pointer;
    background: var(--accent-bg, #f0f0f0);
  }

  .network-input-row button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .empty-hint {
    color: var(--text-muted, #888);
    padding: 2rem;
    text-align: center;
  }
</style>
