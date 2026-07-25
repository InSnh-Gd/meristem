<script lang="ts">
  import type { MDeployHistoryData } from '$lib/types.ts'
  import StateSourceBadge from '$lib/components/ui/StateSourceBadge.svelte'

  let { data }: { data: MDeployHistoryData } = $props()
</script>

<section class="workbench-panel" aria-labelledby="deploy-history-title">
  <div class="panel-header">
    <div>
      <p class="workbench-eyebrow">可追溯性</p>
      <h2 id="deploy-history-title" class="workbench-section-title">部署证据历史</h2>
    </div>
    <StateSourceBadge source={data.stateSource.sourceType} />
  </div>

  <div class="table-wrap">
    <table class="workbench-table">
      <thead>
        <tr><th>时间</th><th>operationId</th><th>类型</th><th>auditId</th><th>correlationId</th></tr>
      </thead>
      <tbody>
        {#if data.evidence.length === 0}
          <tr><td colspan="5" class="workbench-empty">暂无部署证据。</td></tr>
        {:else}
          {#each data.evidence as item}
            <tr>
              <td class="mono">{item.timestamp}</td>
              <td class="mono">{item.operationId}</td>
              <td>{item.evidenceType}</td>
              <td class="mono">{item.auditId}</td>
              <td class="mono">{item.correlationId}</td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</section>

<style>
  .table-wrap { overflow-x: auto; }
  .workbench-empty { padding: var(--space-3); text-align: center; }
</style>
