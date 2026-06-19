<script lang="ts">
  import { onMount } from 'svelte'
  import RouteHeader from '$lib/components/layout/RouteHeader.svelte'
  import FilterBar from '$lib/components/layout/FilterBar.svelte'
  import TimelineStream from '$lib/components/modules/audit/TimelineStream.svelte'
  import TraceLink from '$lib/components/modules/audit/TraceLink.svelte'
  import { appState } from '$lib/stores.svelte.ts'

  let query = $state('')

  const timelineEntries = $derived(appState.timeline?.entries ?? [])
  const filteredEntries = $derived.by(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return timelineEntries
    return timelineEntries.filter((entry) => [
      entry.id,
      entry.summary,
      entry.subject,
      entry.correlationId,
      entry.stateSource.correlationId,
      entry.stateSource.traceId
    ].some((value) => value?.toLowerCase().includes(normalized)))
  })
  const traceableEntries = $derived(filteredEntries.filter((entry) => entry.correlationId))

  onMount(() => {
    void appState.fetchTimeline()
  })
</script>

<section class="route-page" aria-labelledby="timeline-title">
  <RouteHeader routeName="时间线" stateSources={['event', 'log']} />
  <h2 id="timeline-title" class="section-title">事件与日志流</h2>
  <p class="section-copy">按事件、日志摘要或 correlationId 过滤运行事实。</p>

  <div class="panel">
    <FilterBar placeholder="过滤时间线事件" onFilter={(value) => query = value} />
    <TimelineStream entries={filteredEntries} />
  </div>

  <section class="panel trace-panel" aria-label="关联追踪">
    <h3>关联追踪</h3>
    {#if traceableEntries.length === 0}
      <p class="empty-state">当前筛选结果暂无 correlationId</p>
    {:else}
      <div class="trace-list">
        {#each traceableEntries as entry}
          {#if entry.correlationId}
            <div class="trace-row">
              <span class="trace-summary">{entry.summary}</span>
              <TraceLink correlationId={entry.correlationId} />
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </section>
</section>

<style>
  .route-page {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
    color: var(--text-100);
  }

  .section-title {
    color: var(--text-100);
    font-size: var(--text-lg);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
  }

  .section-copy,
  .empty-state {
    color: var(--text-100);
    font-size: var(--text-sm);
    line-height: var(--lh-log);
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    border: 1px solid var(--line-soft);
    background: var(--surface-root);
    padding: var(--space-4);
  }

  .trace-panel h3 {
    color: var(--signal-info);
    font-size: var(--text-sm);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
  }

  .trace-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .trace-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    border-bottom: 1px solid var(--line-soft);
    padding: var(--space-2) 0;
  }

  .trace-summary {
    color: var(--text-100);
    font-size: var(--text-sm);
    line-height: var(--lh-log);
  }

  @media (max-width: 760px) {
    .trace-row {
      align-items: flex-start;
      flex-direction: column;
      gap: var(--space-1);
    }
  }
</style>
