<script lang="ts">
  import type { OverviewData } from '$lib/types.ts'

  type Props = {
    nodes: OverviewData['nodes']
    selectedNodeId: string | null
    onSelect: (id: string) => void
  }

  let { nodes, selectedNodeId, onSelect }: Props = $props()

  function statusColor(s: string): string {
    if (s === 'healthy') return 'var(--signal-ok)'
    if (s === 'degraded') return 'var(--signal-warn)'
    if (s === 'offline') return 'var(--signal-block)'
    if (s === 'joining') return 'var(--signal-info)'
    if (s === 'revoked') return 'var(--signal-risk)'
    return 'var(--text-40)'
  }
</script>

<div class="node-map">
  {#if nodes.length === 0}
    <div class="empty">暂无节点</div>
  {:else}
    {#each nodes as node}
      <button class="node-chip" data-testid="node-chip-{node.name}" class:selected={node.id === selectedNodeId} onclick={() => onSelect(node.id)}>
        <span class="node-status" style="background: {statusColor(node.status)}"></span>
        <span class="node-name">{node.name}</span>
        <span class="node-kind">{node.kind === 'stem' ? 'Stem' : 'Leaf'}</span>
        <span class="node-mode">{node.mode === 'agent' ? 'agent' : 'sim'}</span>
      </button>
    {/each}
  {/if}
</div>

<style>
  .node-map { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .empty { color: var(--text-40); font-size: var(--text-sm); }
  .node-chip { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); border: 1px solid var(--line-soft); border-radius: 4px; background: var(--surface-panel); color: var(--text-80); font-size: var(--text-sm); cursor: pointer; }
  .node-chip:hover { background: var(--surface-raised); }
  .node-chip.selected { border-color: var(--signal-info); background: var(--surface-raised); }
  .node-status { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .node-name { font-weight: var(--fw-medium); }
  .node-kind, .node-mode { font-size: var(--text-xs); color: var(--text-60); }
</style>
