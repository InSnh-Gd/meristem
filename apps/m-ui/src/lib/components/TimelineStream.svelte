<script lang="ts">
  import type { OverviewData } from '../types.ts'

  type Props = { entries: OverviewData['timeline'] }

  let { entries }: Props = $props()
</script>

<div class="timeline">
  {#if entries.length === 0}
    <div class="empty">暂无日志条目</div>
  {:else}
    {#each entries as entry}
      <div class="timeline-entry">
        <span class="entry-time mono">{new Date(entry.timestamp).toLocaleTimeString('zh-CN')}</span>
        <span class="entry-summary">{entry.summary}</span>
        {#if entry.subject}
          <span class="entry-subject mono">{entry.subject}</span>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .timeline { display: flex; flex-direction: column; gap: var(--space-1); max-height: 40vh; overflow-y: auto; }
  .empty { color: var(--text-40); font-size: var(--text-sm); }
  .timeline-entry { display: flex; align-items: baseline; gap: var(--space-2); padding: var(--space-1) var(--space-2); font-size: var(--text-sm); background: var(--surface-panel); }
  .timeline-entry:hover { background: var(--surface-raised); }
  .entry-time { color: var(--text-60); font-size: var(--text-xs); flex-shrink: 0; }
  .entry-summary { color: var(--text-80); flex: 1; }
  .entry-subject { color: var(--text-40); font-size: var(--text-xs); }
  .mono { font-family: var(--font-mono); }
</style>
