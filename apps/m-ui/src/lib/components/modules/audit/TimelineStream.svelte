<script lang="ts">
  import type { OverviewData } from '$lib/types.ts'

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
  .timeline { display: flex; flex-direction: column; gap: 1px; max-height: 40vh; overflow-y: auto; border: 1px solid var(--line-soft); border-radius: var(--operational-card-radius); background: color-mix(in srgb, var(--surface-root) 60%, var(--surface-panel)); }
  .empty { color: var(--text-40); font-size: var(--text-sm); padding: var(--space-3); }
  .timeline-entry { display: flex; align-items: baseline; gap: var(--space-2); padding: var(--space-2) var(--space-3); font-size: var(--text-sm); background: transparent; border-bottom: 1px solid color-mix(in srgb, var(--line-soft) 64%, transparent); }
  .timeline-entry:last-child { border-bottom: 0; }
  .timeline-entry:hover { background: color-mix(in srgb, var(--surface-raised) 50%, transparent); }
  .entry-time { color: var(--text-60); font-size: var(--text-xs); flex-shrink: 0; }
  .entry-summary { color: var(--text-80); flex: 1; }
  .entry-subject { color: var(--text-40); font-size: var(--text-xs); }
  .mono { font-family: var(--font-mono); }
</style>
