<script lang="ts">
  import { onMount } from 'svelte'
  import { appState } from '$lib/stores.svelte.ts'
  import CommandWell from '$lib/components/CommandWell.svelte'
  import InlineOperationalAlert from '$lib/components/InlineOperationalAlert.svelte'
  import KeyValueInspector from '$lib/components/KeyValueInspector.svelte'
  import NodeMap from '$lib/components/NodeMap.svelte'
  import RouteHeader from '$lib/components/RouteHeader.svelte'
  import ServiceRegistryTable from '$lib/components/ServiceRegistryTable.svelte'
  import TimelineStream from '$lib/components/TimelineStream.svelte'

  const stateSources = ['authoritative', 'event', 'log', 'audit']

  const degradedState = $derived.by(() => {
    const overview = appState.overview
    if (!overview) return null
    if (overview.core.mode !== 'normal') return `Core 当前处于 ${overview.core.mode} 模式`
    const unavailable = Object.entries(overview.dependencies)
      .filter(([, state]) => state !== 'ready')
      .map(([name]) => name)
    if (unavailable.length > 0) return `依赖不可用：${unavailable.join('、')}`
    return null
  })

  onMount(() => {
    void appState.fetchRoutes()
    void appState.refresh()
  })
</script>

<svelte:head>
  <title>控制室概览 | Meristem</title>
</svelte:head>

<div class="control-room-page">
  <RouteHeader routeName="控制室概览" {stateSources} />

  {#if degradedState}
    <InlineOperationalAlert message={degradedState} severity="warn" />
  {/if}

  {#if appState.overview}
    <div class="control-room-layout">
      <div class="primary-stack">
        <section class="panel" aria-labelledby="nodes-title">
          <h2 id="nodes-title">节点</h2>
          <NodeMap
            nodes={appState.overview.nodes}
            selectedNodeId={appState.selectedNodeId}
            onSelect={(id: string) => appState.selectNode(id)}
          />
        </section>

        <section class="panel" aria-labelledby="services-title">
          <h2 id="services-title">服务</h2>
          <ServiceRegistryTable services={appState.overview.services} />
        </section>

        <section class="panel" aria-labelledby="timeline-title">
          <h2 id="timeline-title">时间线</h2>
          <TimelineStream entries={appState.overview.timeline} />
        </section>
      </div>

      <aside class="inspector-panel" aria-label="节点检查器">
        <KeyValueInspector item={appState.selectedNode} />
      </aside>
    </div>
  {:else if !appState.loading}
    <section class="empty-panel">
      <p>请输入操作者令牌以加载控制室概览。</p>
    </section>
  {/if}
</div>

<div class="command-region">
  <CommandWell
    commandState={appState.commandState}
    selectedNode={appState.selectedNode}
    confirming={appState.commandConfirming}
    onRequestConfirm={() => appState.commandConfirming = true}
    onCancel={() => appState.commandConfirming = false}
    onConfirm={() => appState.confirmNoop()}
  />
</div>

<style>
  .control-room-page {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
  }

  .control-room-layout {
    display: grid;
    grid-template-columns: 1fr var(--inspector-width);
    gap: var(--panel-gap);
  }

  .primary-stack {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
    min-width: 0;
  }

  .panel,
  .empty-panel,
  .inspector-panel {
    border: 1px solid var(--line-soft);
    background: var(--surface-root);
    padding: var(--space-4);
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }

  .inspector-panel {
    min-width: 0;
    overflow-y: auto;
  }

  h2 {
    color: var(--text-100);
    font-size: var(--text-lg);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
  }

  .empty-panel {
    color: var(--text-100);
    font-size: var(--text-sm);
  }

  .command-region {
    position: fixed;
    right: 0;
    bottom: 0;
    left: var(--nav-rail-width);
    z-index: 10;
    border-top: 1px solid var(--line-strong);
    background: var(--surface-root);
    padding: var(--space-3) var(--shell-padding-x);
  }

  @media (max-width: 960px) {
    .control-room-layout {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 760px) {
    .command-region {
      left: 0;
    }
  }
</style>
