<script lang="ts">
  import type { AuditEntry } from '$lib/types.ts'

  let { entries } = $props<{ entries: AuditEntry[] | null }>()

  const formatter = new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'medium'
  })

  function formatTimestamp(timestamp: string) {
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return timestamp
    return formatter.format(date)
  }
</script>

<section class="audit-ledger" aria-label="审计账本">
  {#if entries === null}
    <p class="empty-state">需要 audit:read 权限</p>
  {:else if entries.length === 0}
    <p class="empty-state">暂无审计记录</p>
  {:else}
    <div class="audit-grid audit-header" role="row">
      <span>时间</span>
      <span>操作者</span>
      <span>动作</span>
      <span>资源</span>
      <span>结果</span>
    </div>
    {#each entries as entry}
      <div class="audit-grid audit-row" role="row">
        <span>{formatTimestamp(entry.timestamp)}</span>
        <span>{entry.actor}</span>
        <span>{entry.action}</span>
        <span>{entry.resource}</span>
        <span>{entry.result}</span>
      </div>
    {/each}
  {/if}
</section>

<style>
  .audit-ledger {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-xs);
  }

  .audit-grid {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 2fr 1fr;
    gap: var(--space-2);
    align-items: center;
  }

  .audit-header {
    border-bottom: 1px solid var(--line-strong);
    color: var(--text-100);
    font-weight: var(--fw-semibold);
    padding: var(--space-2) 0;
  }

  .audit-row {
    border-bottom: 1px solid var(--line-soft);
    color: var(--text-80);
    font-family: var(--font-mono);
    line-height: var(--lh-log);
    padding: var(--space-2) 0;
  }

  .empty-state {
    color: var(--text-60);
    font-size: var(--text-sm);
    padding: var(--space-3) 0;
  }
</style>
