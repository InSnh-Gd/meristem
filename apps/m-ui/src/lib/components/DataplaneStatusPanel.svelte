<script lang="ts">
  import type { DataPlaneStatusResponseData, BffNetworkMapSummary } from '$lib/types.ts'
  import StateSourceBadge from './StateSourceBadge.svelte'

  let { statusData, mapSummary } = $props<{
    statusData: DataPlaneStatusResponseData
    mapSummary: BffNetworkMapSummary
  }>()

  let nodes = $derived(statusData.nodes)
</script>

<div class="dataplane-status-stack">
  <div class="summary-cards">
    <div class="card">
      <div class="card-header">
        <dt>网络拓扑版本 (Map Version)</dt>
        <StateSourceBadge source={mapSummary.stateSource.sourceType} />
      </div>
      <dd class="mono">{mapSummary.mapVersion}</dd>
    </div>
    <div class="card">
      <div class="card-header">
        <dt>中继分配 (Relay Assignment)</dt>
        <StateSourceBadge source={mapSummary.stateSource.sourceType} />
      </div>
      <dd class="mono">
        {mapSummary.relayAssignment.relayType} ({mapSummary.relayAssignment.relayEndpoint})
      </dd>
    </div>
  </div>

  <div class="table-container">
    <table class="status-table">
      <thead>
        <tr>
          <th>节点 ID</th>
          <th>隧道状态</th>
          <th>分区状态</th>
          <th>最新 Map 版本</th>
          <th>来源</th>
        </tr>
      </thead>
      <tbody>
        {#if nodes.length === 0}
          <tr>
            <td colspan="5" class="empty-cell">无数据面状态数据</td>
          </tr>
        {:else}
          {#each nodes as node}
            <tr>
              <td class="mono">{node.nodeId}</td>
              <td class="mono">{node.tunnelStatus}</td>
              <td class="mono">{node.partitionState}</td>
              <td class="mono">{node.lastMapVersion}</td>
              <td><StateSourceBadge source={node.stateSource.sourceType} /></td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</div>

<style>
  .dataplane-status-stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .summary-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: var(--space-3);
  }

  .card {
    border: 1px solid var(--line-soft);
    background: var(--surface-float);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }

  dt {
    font-size: var(--text-xs);
    color: var(--text-60);
  }

  dd {
    font-size: var(--text-sm);
    color: var(--text-100);
    margin: 0;
  }

  .mono {
    font-family: var(--font-mono);
  }

  .table-container {
    overflow-x: auto;
    border: 1px solid var(--line-soft);
  }

  .status-table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    font-size: var(--text-xs);
  }

  .status-table th,
  .status-table td {
    padding: var(--space-2);
    border-bottom: 1px solid var(--line-soft);
  }

  .status-table th {
    font-weight: var(--fw-semibold);
    color: var(--text-60);
    background: var(--surface-float);
  }

  .status-table tbody tr:last-child td {
    border-bottom: none;
  }

  .empty-cell {
    text-align: center;
    padding: var(--space-4);
    color: var(--text-60);
  }
</style>
