<script lang="ts">
  import { SUMMARY_ICONS } from './control-room-summary-icons.ts'

  /**
   * Zone 边界：未授权控制室预览，服务「失败与不可用可见性」体验层。
   *
   * 归属：M-UI 拥有这一分支的完整结构。它不请求任何数据、不持有事实、
   * 不推导命令资格；所有卡片显示 gated 占位，命令卡片一律禁用且标注
   * 未授权原因。真正的授权判断仍由 Core 与 M-Policy 完成，此处只可视化
   * 「尚未提供操作者令牌」这一前端可见状态。
   */
  const previewSummaryCards = [
    { title: 'Core Health', icon: SUMMARY_ICONS.core, cardClass: 'core-health' },
    { title: 'EventBus', icon: SUMMARY_ICONS.event, cardClass: 'event-bus' },
    { title: 'Leaf Nodes', icon: SUMMARY_ICONS.node, cardClass: 'leaf-nodes' },
    { title: 'Policy Gate', icon: SUMMARY_ICONS.policy, cardClass: 'policy-gate' },
    { title: 'Audit Visibility', icon: SUMMARY_ICONS.audit, cardClass: 'audit-visibility' }
  ]

  const previewCommandCards = [
    { title: '运行 noop 任务', icon: SUMMARY_ICONS.core },
    { title: '刷新 Leaf 状态', icon: SUMMARY_ICONS.node },
    { title: '查看 EventBus publish summary', icon: SUMMARY_ICONS.event },
    { title: '运行 重启任务', icon: SUMMARY_ICONS.policy }
  ]
</script>

<div class="control-room-layout empty-workbench" aria-label="未授权控制室预览">
  <div class="workspace-zones">
    <header class="page-title-block">
      <div class="page-titles">
        <h2 class="page-eyebrow">控制室概览</h2>
        <h1 class="page-title">控制室总览</h1>
        <p class="page-subtitle">输入操作者令牌后加载 Core、功能域服务、Leaf 节点、策略与审计状态。</p>
      </div>
      <div class="page-meta">
        <span class="status-badge">actor: 未授权</span>
        <span class="status-badge">core: gated</span>
      </div>
    </header>

    <section class="zone-panel summary-zone" aria-labelledby="empty-summary-title">
      <h2 id="empty-summary-title" class="zone-title">系统状态</h2>
      <div class="summary-card-grid">
        {#each previewSummaryCards as card}
          <article class="summary-card preview-card {card.cardClass}">
            <div class="summary-card-glow-icon" aria-hidden="true">{@html card.icon}</div>
            <div class="summary-card-main">
              <div class="summary-card-title">{card.title}</div>
              <div class="summary-card-value preview-value">待加载</div>
              <div class="summary-card-chips">
                <span class="meta-chip">stateSource: gated</span>
                <span class="meta-chip">需要令牌</span>
              </div>
            </div>
            <div class="summary-card-footer">
              <span class="summary-card-footer-left">更新: —</span>
              <span class="summary-card-footer-right">gated</span>
            </div>
          </article>
        {/each}
      </div>
    </section>

    <section class="zone-panel command-zone" aria-labelledby="empty-command-title">
      <div class="zone-header">
        <div class="zone-titles">
          <h2 class="zone-eyebrow">命令中心</h2>
          <h2 id="empty-command-title">CommandWell · 受控操作井</h2>
        </div>
        <div class="command-context">执行上下文: gated</div>
      </div>
      <div class="command-deck preview-deck" aria-hidden="true">
        {#each previewCommandCards as card}
          <article class="command-card disabled preview-card">
            <div class="command-card-title">
              <span class="command-card-icon">{@html card.icon}</span>
              {card.title}
            </div>
            <div class="command-card-target">target: 需要令牌</div>
            <div class="command-card-requirements">
              <span>requires: gated</span>
              <span>policy: pending</span>
              <span>audit: pending</span>
            </div>
            <div class="command-card-status block">状态: 未授权</div>
          </article>
        {/each}
      </div>
    </section>

    <div class="metrics-stack">
      <section class="zone-panel ledger-zone" aria-labelledby="empty-ledger-title">
        <div class="zone-header">
          <div class="zone-titles">
            <span class="zone-eyebrow">Event &amp; Audit stream</span>
            <h2 id="empty-ledger-title">事件与审计账本</h2>
          </div>
          <span class="zone-count">0</span>
        </div>
        <div class="table-wrap preview-table">
          {#each Array(6) as _}
            <div class="preview-row"></div>
          {/each}
        </div>
      </section>

      <section class="zone-panel service-zone" aria-labelledby="empty-services-title">
        <div class="zone-header">
          <div class="zone-titles">
            <span class="zone-eyebrow">Service map</span>
            <h2 id="empty-services-title">功能域服务状态</h2>
          </div>
          <span class="zone-count">0</span>
        </div>
        <div class="table-wrap preview-table compact">
          {#each Array(5) as _}
            <div class="preview-row"></div>
          {/each}
        </div>
      </section>
    </div>
  </div>

  <aside class="inspector-panel zone-panel" aria-label="未授权上下文">
    <div class="inspector-header">
      <div class="zone-titles">
        <span class="zone-eyebrow">Selected Context</span>
        <h2>未选择节点</h2>
      </div>
    </div>
    <div class="empty-copy inspector-empty">请输入操作者令牌以加载控制室概览。</div>
    <div class="inspector-section">
      <span class="inspector-section-title">访问边界</span>
      <div class="inspector-row">
        <span class="inspector-key">stateSource</span>
        <span class="inspector-value">gated</span>
      </div>
      <div class="inspector-row">
        <span class="inspector-key">required</span>
        <span class="inspector-value">Bearer JWT</span>
      </div>
    </div>
  </aside>
</div>

<style>
  /* 预览分支自带完整两栏布局，与已授权分支保持相同的骨架比例。 */
  .control-room-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--inspector-width);
    gap: var(--panel-gap);
    align-items: start;
  }

  .workspace-zones {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
    min-width: 0;
  }

  .empty-workbench {
    opacity: 0.92;
  }

  .page-title-block {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-3);
    padding-bottom: var(--space-1);
  }

  .page-title {
    color: var(--text-100);
    font-size: var(--text-2xl);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
    letter-spacing: -0.01em;
  }

  .page-eyebrow {
    color: var(--text-60);
    font-size: var(--text-xs);
    font-weight: var(--fw-medium);
    letter-spacing: 0.06em;
    margin: 0;
  }

  .page-subtitle {
    color: var(--text-60);
    font-size: var(--text-sm);
    margin-top: var(--space-1);
  }

  .page-meta {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .summary-zone {
    padding: var(--space-3);
  }

  .command-zone {
    border-color: color-mix(in srgb, var(--signal-info) 24%, var(--line-soft));
  }

  .command-context {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-pill);
    color: var(--text-60);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
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

  .metrics-stack {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
    min-width: 0;
  }

  .table-wrap {
    overflow-x: auto;
    border: 1px solid var(--line-soft);
    border-radius: var(--operational-card-radius);
    background: color-mix(in srgb, var(--surface-root) 60%, var(--surface-panel));
  }

  .preview-card {
    color: var(--text-60);
  }

  .preview-value {
    color: var(--text-40);
  }

  /* 骨架占位行：仅表达「等待授权后填充」，不代表任何真实条目。 */
  .preview-table {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: var(--space-2);
    min-height: 132px;
  }

  .preview-table.compact {
    min-height: 112px;
  }

  .preview-row {
    height: 18px;
    border-bottom: 1px solid var(--line-soft);
    background: linear-gradient(
      90deg,
      color-mix(in srgb, var(--surface-raised) 45%, transparent),
      transparent 78%
    );
  }

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

  .inspector-empty {
    padding: var(--space-4) 0;
  }

  .empty-copy {
    color: var(--text-40);
    font-size: var(--text-sm);
  }

  @media (max-width: 1200px) {
    .control-room-layout {
      grid-template-columns: 1fr;
    }

    .inspector-panel {
      position: static;
      max-height: none;
    }
  }

  @media (max-width: 960px) {
    .page-title-block {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
