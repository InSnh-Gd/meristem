<script lang="ts">
  import type { OverviewData } from '$lib/types.ts'

  /**
   * Zone 边界：节点清单选择条，服务「Orientation」到「Investigation」的过渡。
   *
   * 归属：M-UI 拥有选择条结构与选中态样式。节点事实由 M-Net 经 Core
   * public facade 与 M-UI BFF 提供；选中动作通过 onSelectNode 回调交回
   * 父组件处理，本组件不直接写 store、不判断可达性、不推导命令资格。
   */
  type Props = {
    nodes: OverviewData['nodes']
    selectedNodeId: string | null
    onSelectNode: (nodeId: string) => void
  }

  let { nodes, selectedNodeId, onSelectNode }: Props = $props()

  /** 把节点状态映射为信号色 token；纯展示映射，不改变上游状态语义。 */
  function nodeStatusColor(status: OverviewData['nodes'][number]['status']): string {
    if (status === 'healthy' || status === 'ready') return 'var(--signal-ok)'
    if (status === 'degraded' || status === 'recovering') return 'var(--signal-warn)'
    if (status === 'offline' || status === 'disabled' || status === 'revoked')
      return 'var(--signal-block)'
    if (status === 'joining') return 'var(--signal-info)'
    if (status === 'isolated') return 'var(--signal-risk)'
    return 'var(--text-40)'
  }
</script>

<section
  class="zone-panel node-selector-zone"
  data-testid="control-room-operations-panel"
  aria-labelledby="nodes-title"
>
  <div class="zone-header">
    <div class="zone-titles">
      <span class="zone-eyebrow">Node inventory</span>
      <h2 id="nodes-title">节点</h2>
    </div>
    <span class="zone-count">{nodes.length}</span>
  </div>
  {#if nodes.length === 0}
    <p class="empty-copy">暂无节点</p>
  {:else}
    <div class="node-selector-strip">
      {#each nodes as node}
        <button
          class="node-chip"
          class:selected={node.id === selectedNodeId}
          onclick={() => onSelectNode(node.id)}
          data-testid="node-chip-{node.name}"
          type="button"
        >
          <span class="status-dot" style="background: {nodeStatusColor(node.status)}"></span>
          <span class="node-chip-name">{node.name}</span>
          <span class="node-chip-kind">{node.kind}</span>
        </button>
      {/each}
    </div>
  {/if}
</section>

<style>
  /* zone 自身的内边距与局部排版；node-chip 视觉由 app.css 共享样式提供。 */
  .node-selector-zone {
    padding: var(--space-3);
  }

  .zone-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .zone-titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .zone-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--space-4);
    padding: 0 var(--space-1);
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-pill);
    color: var(--text-60);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
  }

  .status-dot {
    display: inline-block;
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-pill);
    margin-right: var(--space-1);
    vertical-align: middle;
  }

  .empty-copy {
    color: var(--text-40);
    font-size: var(--text-sm);
  }

  /* 与拆分前一致的 zone eyebrow 样式；app.css 的全局规则使用 --text-40、
     硬编码 12px 且缺少 margin 归零，必须保留 scoped 规则以维持原有渲染。 */
  .zone-eyebrow {
    color: var(--text-60);
    font-size: var(--text-xs);
    font-weight: var(--fw-medium);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin: 0;
  }
</style>
