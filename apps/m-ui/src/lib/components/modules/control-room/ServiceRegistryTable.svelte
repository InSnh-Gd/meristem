<script lang="ts">
  import type { OverviewData } from '$lib/types.ts'

  type Props = { services: OverviewData['services'] }

  let { services }: Props = $props()
</script>

<div class="service-table">
  {#if services.length === 0}
    <div class="empty">暂无服务</div>
  {:else}
    <table>
      <thead>
        <tr><th>ID</th><th>版本</th><th>域</th><th>类型</th><th>运行态</th></tr>
      </thead>
      <tbody>
        {#each services as svc}
          <tr>
            <td class="mono">{svc.id}</td>
            <td class="mono">{svc.version}</td>
            <td>{svc.domain}</td>
            <td>{svc.kind}</td>
            <td>{svc.runtime?.mode === 'normal' ? '正常' : svc.runtime?.mode === 'degraded' ? '降级' : '未知'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .service-table { overflow-x: auto; }
  .empty { color: var(--text-40); font-size: var(--text-sm); }
  table { width: 100%; min-width: var(--service-table-min-width); border-collapse: collapse; font-size: var(--text-sm); }
  th { text-align: left; padding: var(--space-1) var(--space-2); color: var(--text-60); font-weight: var(--fw-medium); border-bottom: 1px solid var(--line-soft); }
  td { padding: var(--space-1) var(--space-2); color: var(--text-80); border-bottom: 1px solid var(--line-soft); }
  .mono { font-family: var(--font-mono); font-size: var(--text-xs); }
</style>
