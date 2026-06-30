<script lang="ts">
  let { item } = $props<{ item: Record<string, unknown> | null }>()

  function entries(obj: Record<string, unknown> | null): [string, unknown][] {
    if (!obj) return []
    return Object.entries(obj).filter(
      ([, v]) => typeof v !== 'object' || v === null || Array.isArray(v)
    )
  }
</script>

<div class="inspector">
  {#if !item}
    <div class="empty">选择节点以查看详情</div>
  {:else}
    <h3 class="inspector-title">节点详情</h3>
    {#each entries(item) as [key, value]}
      <div class="kv-row">
        <span class="kv-key">{key}</span>
        <span class="kv-value mono">{String(value ?? '—')}</span>
      </div>
    {/each}
  {/if}
</div>

<style>
  .inspector {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .empty {
    color: var(--text-40);
    font-size: var(--text-sm);
  }
  .inspector-title {
    font-size: var(--text-sm);
    font-weight: var(--fw-medium);
    color: var(--text-60);
    margin: 0 0 var(--space-2) 0;
  }
  .kv-row {
    display: flex;
    gap: var(--space-2);
    font-size: var(--text-xs);
    padding: var(--space-2) 0;
    border-bottom: 1px solid color-mix(in srgb, var(--line-soft) 64%, transparent);
  }
  .kv-row:last-child {
    border-bottom: 0;
  }
  .kv-key {
    color: var(--text-60);
    min-width: 120px;
    flex-shrink: 0;
    font-weight: var(--fw-medium);
  }
  .kv-value {
    color: var(--text-80);
    word-break: break-all;
  }
  .mono {
    font-family: var(--font-mono);
  }
</style>
