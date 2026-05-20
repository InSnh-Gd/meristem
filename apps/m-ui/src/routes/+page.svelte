<script lang="ts">
  import { appState } from '$lib/stores.svelte.ts'
  import NodeMap from '$lib/components/NodeMap.svelte'
  import ServiceRegistryTable from '$lib/components/ServiceRegistryTable.svelte'
  import TimelineStream from '$lib/components/TimelineStream.svelte'
  import KeyValueInspector from '$lib/components/KeyValueInspector.svelte'
  import CommandWell from '$lib/components/CommandWell.svelte'
</script>

<div class="overview">
  <div class="overview-main">
    <button
      class="refresh-btn"
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
    {:else if !appState.loading}
      <div class="empty-state">请输入操作者令牌以加载控制室数据</div>
    {/if}
  </div>

  <aside class="overview-inspector">
    <KeyValueInspector item={appState.selectedNode} />
    {#if appState.taskResult}
      <div class="task-result">
        <h3>任务结果</h3>
        <div class="kv-row">
          <span class="kv-key">task.id</span>
          <span class="kv-value mono">{appState.taskResult.task.id}</span>
        </div>
        <div class="kv-row">
          <span class="kv-key">policyDecisionId</span>
          <span class="kv-value mono">{appState.taskResult.policyDecisionId}</span>
        </div>
        <div class="kv-row">
          <span class="kv-key">correlationId</span>
          <span class="kv-value mono">{appState.taskResult.correlationId}</span>
        </div>
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
  }
</style>
