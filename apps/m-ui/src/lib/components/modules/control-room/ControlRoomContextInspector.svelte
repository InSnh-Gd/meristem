<script lang="ts">
  import type { OverviewData, PolicyDecisionSummary } from '$lib/types.ts'
  import { formatTime, truncateId } from './control-room-display-format.ts'

  /**
   * Zone 边界：已选上下文检查器，服务「Investigation」与「Traceability」体验层。
   *
   * 归属：M-UI 拥有检查器结构与分段顺序。节点身份、可达性、能力由 M-Net
   * 拥有；权限与 actor 由认证边界拥有；策略决策由 M-Policy 拥有；
   * 任务与 correlation 事实由 M-Task 与 M-Log 拥有。全部经 M-UI BFF 适配后
   * 作为显式 props 传入，本组件不做最终授权判断，也不产生任何事实。
   */
  type Props = {
    selectedNode: OverviewData['nodes'][number] | null
    selectedNodeId: string | null
    actor: string | null
    permissions: OverviewData['session']['permissions']
    policySummary: PolicyDecisionSummary | null
    taskCorrelationId: string | undefined
    taskId: string
    taskStatus: string
  }

  let {
    selectedNode,
    selectedNodeId,
    actor,
    permissions,
    policySummary,
    taskCorrelationId,
    taskId,
    taskStatus
  }: Props = $props()
</script>

<aside class="inspector-panel zone-panel" aria-label="已选上下文">
  <div class="inspector-header">
    <div class="zone-titles">
      <span class="zone-eyebrow">Selected Context</span>
      <h2>{selectedNode?.name ?? '未选择节点'}</h2>
    </div>
    {#if selectedNodeId}
      <span class="status-badge">{selectedNode?.status ?? '—'}</span>
    {/if}
  </div>

  {#if !selectedNode}
    <div class="empty-copy inspector-empty">选择上方节点以查看上下文、策略与跟踪信息。</div>
  {:else}
    {@const node = selectedNode}
    <div class="inspector-section">
      <span class="inspector-section-title">身份与权限</span>
      <div class="inspector-row">
        <span class="inspector-key">nodeKind</span>
        <span class="inspector-value">{node.kind}</span>
      </div>
      <div class="inspector-row">
        <span class="inspector-key">reachability</span>
        <span class="inspector-value">{node.reachability}</span>
      </div>
      <div class="inspector-row">
        <span class="inspector-key">actor</span>
        <span class="inspector-value">{actor ?? '—'}</span>
      </div>
      <div class="inspector-row">
        <span class="inspector-key">permissions</span>
        <span class="inspector-value">{permissions.join(' ') || '—'}</span>
      </div>
      <div class="inspector-row">
        <span class="inspector-key">stateSource</span>
        <span class="inspector-value">read-model</span>
      </div>
      <div class="inspector-row">
        <span class="inspector-key">lastRefresh</span>
        <span class="inspector-value">{formatTime(new Date().toISOString())}</span>
      </div>
    </div>

    <div class="inspector-section">
      <span class="inspector-section-title">节点信息</span>
      <div class="inspector-row">
        <span class="inspector-key">nodeId</span>
        <span class="inspector-value">{truncateId(node.id, 22)}</span>
      </div>
      <div class="inspector-row">
        <span class="inspector-key">name</span>
        <span class="inspector-value">{node.name}</span>
      </div>
      <div class="inspector-row">
        <span class="inspector-key">mode</span>
        <span class="inspector-value">{node.mode}</span>
      </div>
      <div class="inspector-row">
        <span class="inspector-key">status</span>
        <span class="inspector-value">{node.status}</span>
      </div>
      <div class="inspector-row">
        <span class="inspector-key">lastSeenAt</span>
        <span class="inspector-value">{formatTime(node.lastSeenAt)}</span>
      </div>
      <div class="inspector-row">
        <span class="inspector-key">version</span>
        <span class="inspector-value">{node.agentVersion ?? '—'}</span>
      </div>
      <div class="inspector-row">
        <span class="inspector-key">capabilities</span>
        <span class="inspector-value">{node.capabilities.join(', ') || '—'}</span>
      </div>
    </div>

    <div class="inspector-section">
      <span class="inspector-section-title">策略上下文</span>
      <div class="inspector-row">
        <span class="inspector-key">lastDecision</span>
        <span class="inspector-value">{policySummary?.result ?? '—'}</span>
      </div>
      <div class="inspector-row">
        <span class="inspector-key">policyDecisionId</span>
        <span class="inspector-value">{truncateId(policySummary?.id, 22)}</span>
      </div>
      <div class="inspector-row">
        <span class="inspector-key">actor</span>
        <span class="inspector-value">{policySummary?.actor ?? '—'}</span>
      </div>
      <div class="inspector-row">
        <span class="inspector-key">action</span>
        <span class="inspector-value">{policySummary?.action ?? '—'}</span>
      </div>
      <div class="inspector-row">
        <span class="inspector-key">decisionAt</span>
        <span class="inspector-value">{formatTime(policySummary?.createdAt)}</span>
      </div>
    </div>

    <div class="inspector-section">
      <span class="inspector-section-title">跟踪上下文</span>
      <div class="inspector-row">
        <span class="inspector-key">correlationId</span>
        <span class="inspector-value">{truncateId(taskCorrelationId, 22)}</span>
      </div>
      <div class="inspector-row">
        <span class="inspector-key">task.id</span>
        <span class="inspector-value">{taskId}</span>
      </div>
      <div class="inspector-row">
        <span class="inspector-key">task.status</span>
        <span class="inspector-value">{taskStatus}</span>
      </div>
    </div>
  {/if}
</aside>

<style>
  /* 检查器在宽视口保持吸顶并独立滚动，窄视口回落为普通块级流。 */
  .inspector-panel {
    position: sticky;
    top: var(--space-4);
    align-self: start;
    max-height: calc(100vh - var(--app-bar-height) - var(--space-6));
    min-width: 0;
    overflow-y: auto;
    padding: var(--space-3);
  }

  .inspector-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-2);
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--line-soft);
    margin-bottom: var(--space-2);
  }

  .zone-titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .inspector-empty {
    padding: var(--space-4) 0;
  }

  .empty-copy {
    color: var(--text-40);
    font-size: var(--text-sm);
  }

  @media (max-width: 1200px) {
    .inspector-panel {
      position: static;
      max-height: none;
    }
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
