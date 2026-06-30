<script lang="ts">
  import { page } from '$app/state'
  import { onMount } from 'svelte'
  import { appState } from '$lib/stores.svelte.ts'
  import KeyValueInspector from '$lib/components/ui/KeyValueInspector.svelte'
  import RawEnvelopeView from '$lib/components/ui/RawEnvelopeView.svelte'
  import RouteHeader from '$lib/components/layout/RouteHeader.svelte'
  import TimelineStream from '$lib/components/modules/audit/TimelineStream.svelte'
  import type { TimelineData } from '$lib/types.ts'

  const stateSources = ['authoritative', 'event', 'log']
  const nodeId = $derived(page.params.id)

  const node = $derived.by(() => appState.nodes?.nodes.find((candidate) => candidate.id === nodeId) ?? null)

  const nodeTimeline = $derived.by(() => {
    const entries = appState.timeline?.entries ?? []
    if (!node) return []
    return entries.filter((entry: TimelineData['entries'][number]) => {
      const subject = entry.subject ?? ''
      const summary = entry.summary ?? ''
      return subject.includes(node.id) || subject.includes(node.name) || summary.includes(node.id) || summary.includes(node.name)
    })
  })

  onMount(() => {
    void appState.fetchNodes()
    void appState.fetchTimeline()
    if (nodeId) void appState.selectNode(nodeId)
  })
</script>

<svelte:head>
  <title>节点详情 | Meristem</title>
</svelte:head>

<section class="node-detail-page">
  <RouteHeader routeName="节点详情" {stateSources} />

  {#if node}
    <div class="detail-layout">
      <div class="detail-stack">
        <section class="panel workbench-panel" aria-labelledby="node-state-title">
          <div class="zone-titles">
            <span class="zone-eyebrow">Node state</span>
            <h2 id="node-state-title">节点状态</h2>
          </div>
          <KeyValueInspector item={node} />
        </section>

        <section class="panel workbench-panel" aria-labelledby="node-timeline-title">
          <div class="zone-titles">
            <span class="zone-eyebrow">Timeline stream</span>
            <h2 id="node-timeline-title">节点时间线</h2>
          </div>
          <TimelineStream entries={nodeTimeline} />
        </section>
      </div>

      <aside class="raw-panel" aria-label="原始节点数据">
        <RawEnvelopeView title="原始节点数据" data={node} />
      </aside>
    </div>
  {:else if appState.loading}
    <section class="empty-panel workbench-panel">
      <p>正在加载节点详情。</p>
    </section>
  {:else}
    <section class="empty-panel workbench-panel">
      <p>未找到节点：<span class="mono">{nodeId}</span></p>
    </section>
  {/if}
</section>

<style>
  .node-detail-page {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
  }

  .detail-layout {
    display: grid;
    grid-template-columns: 1fr var(--inspector-width);
    gap: var(--panel-gap);
  }

  .detail-stack {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
    min-width: 0;
  }

  .panel,
  .raw-panel,
  .empty-panel {
    min-width: 0;
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .zone-titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  h2 {
    color: var(--text-100);
    font-size: var(--text-lg);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
    margin: 0;
  }

  .empty-panel {
    color: var(--text-100);
    font-size: var(--text-sm);
  }

  .mono {
    font-family: var(--font-mono);
  }

  @media (max-width: 960px) {
    .detail-layout {
      grid-template-columns: 1fr;
    }
  }
</style>
