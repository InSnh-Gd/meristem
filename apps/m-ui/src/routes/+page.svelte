<script lang="ts">
  import { appState } from '$lib/stores.svelte.ts'
  import NodeMap from '$lib/components/NodeMap.svelte'
  import ServiceRegistryTable from '$lib/components/ServiceRegistryTable.svelte'
  import TimelineStream from '$lib/components/TimelineStream.svelte'
  import KeyValueInspector from '$lib/components/KeyValueInspector.svelte'
  import CommandWell from '$lib/components/CommandWell.svelte'

  let showPolicySummary = $state(false)

  function formatTimestamp(ts: string): string {
    return new Date(ts).toLocaleString('zh-CN')
  }

  function togglePolicySummary() {
    if (!appState.policySummary) {
      showPolicySummary = !showPolicySummary
    } else {
      showPolicySummary = !showPolicySummary
    }
  }
</script>

<div class="overview">
  <div class="overview-main">
    <button
      class="refresh-btn"
      data-testid="refresh-btn"
      onclick={() => appState.refresh()}
      disabled={appState.loading}
    >
      刷新
    </button>

    {#if appState.overview}
      <section class="region">
        <h2 class="region-title">节点</h2>
        <NodeMap
          nodes={appState.overview.nodes}
          selectedNodeId={appState.selectedNodeId}
          onSelect={(id: string) => appState.selectNode(id)}
        />
      </section>

      <section class="region">
        <h2 class="region-title">服务</h2>
        <ServiceRegistryTable services={appState.overview.services} />
      </section>

      <section class="region">
        <h2 class="region-title">时间线</h2>
        <TimelineStream entries={appState.overview.timeline} />
      </section>

      {#if appState.overview.audit}
        <section class="region" data-testid="audit-section">
          <h2 class="region-title">审计</h2>
          <div class="audit-table">
            <div class="audit-header">
              <span class="audit-col">时间</span>
              <span class="audit-col">操作者</span>
              <span class="audit-col">操作</span>
              <span class="audit-col">资源</span>
              <span class="audit-col">结果</span>
            </div>
            {#each appState.auditEntries as entry}
              <div class="audit-row">
                <span class="audit-col mono">{formatTimestamp(entry.timestamp)}</span>
                <span class="audit-col">{entry.actor}</span>
                <span class="audit-col mono">{entry.action}</span>
                <span class="audit-col mono">{entry.resource}</span>
                <span class="audit-col">{entry.result}</span>
              </div>
            {/each}
            {#if appState.auditEntries.length === 0}
              <div class="audit-empty">暂无审计记录</div>
            {/if}
          </div>
        </section>
      {/if}
    {:else if !appState.loading}
      <div class="empty-state">请输入操作者令牌以加载控制室数据</div>
    {/if}
  </div>

  <aside class="overview-inspector">
    <KeyValueInspector item={appState.selectedNode} />
    {#if appState.taskResult}
      <div class="task-result" data-testid="task-result">
        <h3>任务结果</h3>
        <div class="kv-row">
          <span class="kv-key">task.id</span>
          <span class="kv-value mono">{appState.taskResult.task.id}</span>
        </div>
        <div class="kv-row">
          <span class="kv-key">policyDecisionId</span>
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span
            class="kv-value mono kv-link"
            onclick={() => { togglePolicySummary() }}
            role="button"
            tabindex="0"
          >
            {appState.taskResult.policyDecisionId}
          </span>
        </div>
        <div class="kv-row">
          <span class="kv-key">correlationId</span>
          <span class="kv-value mono">{appState.taskResult.correlationId}</span>
        </div>

        {#if showPolicySummary}
          <div class="policy-summary" data-testid="policy-summary">
            <h4>策略决策摘要</h4>
            {#if appState.policySummary}
              <div class="kv-row">
                <span class="kv-key">ID</span>
                <span class="kv-value mono">{appState.policySummary.id}</span>
              </div>
              <div class="kv-row">
                <span class="kv-key">操作者</span>
                <span class="kv-value">{appState.policySummary.actor}</span>
              </div>
              <div class="kv-row">
                <span class="kv-key">操作</span>
                <span class="kv-value mono">{appState.policySummary.action}</span>
              </div>
              <div class="kv-row">
                <span class="kv-key">资源</span>
                <span class="kv-value mono">{appState.policySummary.resource}</span>
              </div>
              <div class="kv-row">
                <span class="kv-key">结果</span>
                <span class="kv-value">{appState.policySummary.result}</span>
              </div>
              <div class="kv-row">
                <span class="kv-key">创建时间</span>
                <span class="kv-value">{formatTimestamp(appState.policySummary.createdAt)}</span>
              </div>
            {:else}
              <div class="policy-loading">加载策略摘要中...</div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </aside>
</div>

<div class="overview-command">
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
  .overview {
    display: grid;
    grid-template-columns: 1fr var(--inspector-width);
    gap: var(--panel-gap);
    height: 100%;
  }
  .overview-main {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .overview-inspector {
    background: var(--surface-panel);
    border: 1px solid var(--line-soft);
    border-radius: 4px;
    padding: var(--space-4);
    overflow-y: auto;
  }
  .overview-command {
    position: fixed;
    bottom: 0;
    left: var(--nav-rail-width);
    right: 0;
    background: var(--surface-panel);
    border-top: 1px solid var(--line-strong);
    padding: var(--space-3) var(--shell-padding-x);
    z-index: 10;
  }
  .refresh-btn {
    background: var(--surface-raised);
    color: var(--text-80);
    border: 1px solid var(--line-soft);
    padding: var(--space-1) var(--space-3);
    border-radius: 4px;
    cursor: pointer;
    font-size: var(--text-sm);
    align-self: flex-start;
  }
  .refresh-btn:hover { background: var(--line-strong); }
  .refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .region { display: flex; flex-direction: column; gap: var(--space-2); }
  .region-title {
    font-size: var(--text-sm);
    font-weight: var(--fw-medium);
    color: var(--text-60);
  }
  .empty-state { color: var(--text-40); padding: var(--space-12) 0; text-align: center; }
  .task-result {
    margin-top: var(--space-4);
    padding-top: var(--space-4);
    border-top: 1px solid var(--line-soft);
  }
  .task-result h3 {
    font-size: var(--text-sm);
    font-weight: var(--fw-medium);
    color: var(--signal-ok);
    margin-bottom: var(--space-2);
  }
  .kv-row { display: flex; gap: var(--space-2); margin-bottom: var(--space-1); font-size: var(--text-xs); }
  .kv-key { color: var(--text-60); min-width: 120px; }
  .kv-value { color: var(--text-80); }
  .mono { font-family: var(--font-mono); }
  .kv-link { color: var(--signal-info); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
  .kv-link:hover { color: var(--text-100); }

  .policy-summary {
    margin-top: var(--space-3);
    padding: var(--space-3);
    background: var(--surface-sunken);
    border: 1px solid var(--line-soft);
    border-radius: 4px;
  }
  .policy-summary h4 {
    font-size: var(--text-xs);
    font-weight: var(--fw-medium);
    color: var(--signal-info);
    margin-bottom: var(--space-2);
  }
  .policy-loading {
    font-size: var(--text-xs);
    color: var(--text-40);
  }

  .audit-table {
    font-size: var(--text-xs);
  }
  .audit-header {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 2fr 1fr;
    gap: var(--space-2);
    padding: var(--space-1) 0;
    border-bottom: 1px solid var(--line-strong);
    color: var(--text-60);
    font-weight: var(--fw-medium);
  }
  .audit-row {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 2fr 1fr;
    gap: var(--space-2);
    padding: var(--space-1) 0;
    border-bottom: 1px solid var(--line-soft);
    color: var(--text-80);
  }
  .audit-row:last-child { border-bottom: none; }
  .audit-col {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .audit-empty {
    padding: var(--space-3) 0;
    color: var(--text-40);
    text-align: center;
  }

  @media (max-width: 960px) {
    .overview {
      grid-template-columns: 1fr;
      height: auto;
    }
    .overview-inspector {
      max-height: var(--inspector-mobile-max-height);
    }
  }

  @media (max-width: 760px) {
    .overview-command {
      left: 0;
    }
    .kv-row {
      flex-direction: column;
      gap: 0;
    }
    .kv-key {
      min-width: 0;
    }
    .audit-header,
    .audit-row {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
