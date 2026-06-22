<script lang="ts">
  import { onMount } from 'svelte'
  import { appState } from '$lib/stores.svelte.ts'
  import CommandWell from '$lib/components/modules/command/CommandWell.svelte'
  import EventBusSubjectHealthChart from '$lib/components/modules/control-room/EventBusSubjectHealthChart.svelte'
  import InlineOperationalAlert from '$lib/components/ui/InlineOperationalAlert.svelte'
  import KeyValueInspector from '$lib/components/ui/KeyValueInspector.svelte'
  import NodeMap from '$lib/components/modules/control-room/NodeMap.svelte'
  import RouteHeader from '$lib/components/layout/RouteHeader.svelte'
  import ServiceRegistryTable from '$lib/components/modules/control-room/ServiceRegistryTable.svelte'
  import TimelineStream from '$lib/components/modules/audit/TimelineStream.svelte'

  const stateSources = ['authoritative', 'event', 'log', 'audit', 'read-model']
  const eventBusMetrics = $derived(appState.overview?.eventBusMetrics ?? null)

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

        <section class="panel" aria-labelledby="eventbus-title">
          <div class="panel-heading">
            <h2 id="eventbus-title">EventBus 发布健康</h2>
            <span class="eyebrow">read-model</span>
          </div>

          {#if eventBusMetrics}
            <div class="metrics-grid" aria-label="EventBus 发布指标总览">
              <article class="metric-card">
                <span class="metric-label">成功</span>
                <strong>{eventBusMetrics.totals.success}</strong>
              </article>
              <article class="metric-card warn">
                <span class="metric-label">拒绝</span>
                <strong>{eventBusMetrics.totals.rejected}</strong>
              </article>
              <article class="metric-card danger">
                <span class="metric-label">失败</span>
                <strong>{eventBusMetrics.totals.failed}</strong>
              </article>
              <article class="metric-card info">
                <span class="metric-label">重试</span>
                <strong>{eventBusMetrics.totals.retryAttempts}</strong>
              </article>
            </div>

            {#if eventBusMetrics.lastFailed || eventBusMetrics.lastRejected}
              <div class="operational-strip">
                {#if eventBusMetrics.lastFailed}
                  <div>
                    <span class="operational-label">最近失败</span>
                    <p>
                      <span class="mono">{eventBusMetrics.lastFailed.failedSubject}</span>
                      {#if eventBusMetrics.lastFailed.callerService}
                        <span> · {eventBusMetrics.lastFailed.callerService}</span>
                      {/if}
                      {#if eventBusMetrics.lastFailed.actor}
                        <span> · {eventBusMetrics.lastFailed.actor}</span>
                      {/if}
                      <span> · {eventBusMetrics.lastFailed.attempts} 次尝试</span>
                    </p>
                  </div>
                {/if}

                {#if eventBusMetrics.lastRejected}
                  <div>
                    <span class="operational-label">最近拒绝</span>
                    <p>
                      <span class="mono">{eventBusMetrics.lastRejected.failedSubject}</span>
                      <span> · {eventBusMetrics.lastRejected.reason}</span>
                      {#if eventBusMetrics.lastRejected.callerService}
                        <span> · {eventBusMetrics.lastRejected.callerService}</span>
                      {/if}
                    </p>
                  </div>
                {/if}
              </div>
            {/if}

            <div class="subject-chart-wrap">
              <EventBusSubjectHealthChart subjects={eventBusMetrics.subjects} />
            </div>
          {:else}
            <p class="empty-copy">当前未返回 EventBus 指标快照。</p>
          {/if}
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
    commandStateError={appState.commandStateError}
    selectedNode={appState.selectedNode}
    confirming={appState.commandConfirming}
    onRequestConfirm={() => appState.commandConfirming = true}
    onCancel={() => appState.commandConfirming = false}
    onConfirm={async () => {
      appState.commandParams = { leafNodeId: appState.selectedNodeId }
      await appState.executeGenericCommand()
      void appState.refresh()
    }}
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

  .panel-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
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

  .eyebrow,
  .metric-label,
  .operational-label,
  .empty-copy {
    color: var(--text-60);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .metric-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    border: 1px solid var(--line-soft);
    padding: var(--space-3);
    background: var(--surface-panel);
  }

  .metric-card strong {
    color: var(--text-100);
    font-size: var(--text-2xl);
    line-height: 1;
  }

  .metric-card.warn {
    border-color: var(--signal-warn);
  }

  .metric-card.danger {
    border-color: var(--signal-block);
  }

  .metric-card.info {
    border-color: var(--signal-info);
  }

  .operational-strip {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .operational-strip p {
    color: var(--text-100);
    font-size: var(--text-sm);
    line-height: var(--lh-prose);
  }

  .subject-chart-wrap {
    min-width: 0;
  }

  .empty-panel {
    color: var(--text-100);
    font-size: var(--text-sm);
  }

  .mono {
    font-family: var(--font-mono);
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

    .metrics-grid,
    .operational-strip {
      grid-template-columns: 1fr 1fr;
    }
  }

  @media (max-width: 760px) {
    .command-region {
      left: 0;
    }

    .metrics-grid,
    .operational-strip {
      grid-template-columns: 1fr;
    }
  }
</style>
