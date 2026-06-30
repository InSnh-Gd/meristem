<script lang="ts">
  import type { OverviewData } from '$lib/types.ts'

  type Props = { services: OverviewData['services'] }

  let { services }: Props = $props()
</script>

<div class="service-table">
  {#if services.length === 0}
    <div class="workbench-empty">暂无功能域服务</div>
  {:else}
    <div class="table-wrap">
      <table class="workbench-table">
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
              <td>
                <span class="status-dot" style="background: {svc.runtime?.mode === 'normal' ? 'var(--signal-ok)' : svc.runtime?.mode === 'degraded' ? 'var(--signal-warn)' : 'var(--text-40)'}"></span>
                {svc.runtime?.mode === 'normal' ? '正常' : svc.runtime?.mode === 'degraded' ? '降级' : '未知'}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .service-table { display: flex; flex-direction: column; gap: var(--space-2); }
  .table-wrap { overflow-x: auto; border: 1px solid var(--line-soft); border-radius: var(--operational-card-radius); background: color-mix(in srgb, var(--surface-root) 60%, var(--surface-panel)); }
  .status-dot { display: inline-block; width: var(--space-2); height: var(--space-2); border-radius: var(--radius-pill); margin-right: var(--space-1); vertical-align: middle; }
</style>
