<script lang="ts">
  import { onMount } from 'svelte'
  import { appState } from '$lib/stores.svelte.ts'
  import FilterBar from '$lib/components/layout/FilterBar.svelte'
  import KeyValueInspector from '$lib/components/ui/KeyValueInspector.svelte'
  import RouteHeader from '$lib/components/layout/RouteHeader.svelte'
  import type { NodeListData } from '$lib/types.ts'

  const stateSources = ['authoritative', 'event']
  let query = $state('')

  const filteredNodes = $derived.by(() => {
    const nodes = appState.nodes?.nodes ?? []
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return nodes
    return nodes.filter((node) => [
      node.id,
      node.name,
      node.kind,
      node.mode,
      node.status,
      node.reachability,
      node.agentVersion ?? '',
      node.capabilities.join(' ')
    ].join(' ').toLowerCase().includes(normalizedQuery))
  })

  const selectedNode = $derived.by(() => {
    if (!appState.selectedNodeId) return filteredNodes[0] ?? null
    return filteredNodes.find((node) => node.id === appState.selectedNodeId)
      ?? appState.nodes?.nodes.find((node: NodeListData['nodes'][number]) => node.id === appState.selectedNodeId)
      ?? null
  })

  function selectNode(nodeId: string) {
    void appState.selectNode(nodeId)
  }

  onMount(() => {
    void appState.fetchNodes()
  })
</script>

<svelte:head>
  <title>节点 | Meristem</title>
</svelte:head>

<section class="nodes-page">
  <RouteHeader routeName="节点" {stateSources} />

  <FilterBar placeholder="按节点名称、状态、可达性或能力筛选" onFilter={(value: string) => query = value} />

  <div class="nodes-layout">
    <section class="nodes-panel" aria-labelledby="node-list-title">
      <h2 id="node-list-title">节点列表</h2>

      {#if filteredNodes.length === 0}
        <p class="empty-state">暂无匹配节点。</p>
      {:else}
        <div class="node-table" role="table" aria-label="节点列表">
          <div class="node-row node-heading" role="row">
            <span role="columnheader">名称</span>
            <span role="columnheader">类型</span>
            <span role="columnheader">状态</span>
            <span role="columnheader">可达性</span>
            <span role="columnheader">模式</span>
          </div>
          {#each filteredNodes as node}
            <button
              type="button"
              class="node-row node-entry"
              class:selected={selectedNode?.id === node.id}
              onclick={() => selectNode(node.id)}
              role="row"
            >
              <span class="mono" role="cell">{node.name}</span>
              <span role="cell">{node.kind === 'stem' ? 'Stem' : 'Leaf'}</span>
              <span class="mono" role="cell" data-testid="node-row-status-{node.id}">{node.status}</span>
              <span role="cell">{node.reachability}</span>
              <span role="cell">{node.mode}</span>
            </button>
          {/each}
        </div>
      {/if}
    </section>

    <aside class="inspector-panel" aria-label="节点检查器">
      <KeyValueInspector item={selectedNode} />
    </aside>
  </div>
</section>

<style>
  .nodes-page {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
  }

  .nodes-layout {
    display: grid;
    grid-template-columns: 1fr var(--inspector-width);
    gap: var(--panel-gap);
  }

  .nodes-panel,
  .inspector-panel {
    min-width: 0;
    border: 1px solid var(--line-soft);
    background: var(--surface-root);
    padding: var(--space-4);
  }

  .nodes-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  h2 {
    color: var(--text-100);
    font-size: var(--text-lg);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
  }

  .node-table {
    display: flex;
    flex-direction: column;
    overflow-x: auto;
    border: 1px solid var(--line-soft);
  }

  .node-row {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 1fr 1fr;
    gap: var(--space-2);
    min-width: var(--service-table-min-width);
    border: 0;
    border-bottom: 1px solid var(--line-soft);
    background: var(--surface-root);
    color: var(--text-100);
    font-family: var(--font-body);
    font-size: var(--text-sm);
    padding: var(--space-2) var(--space-3);
    text-align: left;
  }

  .node-row:last-child {
    border-bottom: 0;
  }

  .node-heading {
    font-size: var(--text-xs);
    font-weight: var(--fw-semibold);
  }

  .node-entry {
    cursor: pointer;
  }

  .node-entry:hover,
  .node-entry:focus-visible,
  .node-entry.selected {
    border-color: var(--line-strong);
    outline: 1px solid var(--signal-info);
    outline-offset: 0;
  }

  .mono {
    font-family: var(--font-mono);
  }

  .empty-state {
    color: var(--text-100);
    font-size: var(--text-sm);
  }

  @media (max-width: 960px) {
    .nodes-layout {
      grid-template-columns: 1fr;
    }
  }
</style>
