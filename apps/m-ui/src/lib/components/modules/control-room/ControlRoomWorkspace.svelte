<script lang="ts">
  import { onMount } from 'svelte'
  import { appState } from '$lib/stores.svelte.ts'
  import CommandWell from '$lib/components/modules/command/CommandWell.svelte'
  import InlineOperationalAlert from '$lib/components/ui/InlineOperationalAlert.svelte'
  import type { AuditEntry } from '$lib/types.ts'
  import ControlRoomContextInspector from './ControlRoomContextInspector.svelte'
  import ControlRoomGatedPreview from './ControlRoomGatedPreview.svelte'
  import ControlRoomMetricsStack from './ControlRoomMetricsStack.svelte'
  import ControlRoomNodeSelectorZone from './ControlRoomNodeSelectorZone.svelte'
  import ControlRoomSystemStatusZone from './ControlRoomSystemStatusZone.svelte'

  /**
   * 控制室工作台外壳。
   *
   * 结构职责划分（M-UI Transitional Workbench）：本组件只保留页面骨架、
   * 标题块、降级提示、CommandWell 宿主区域，以及各 zone 子组件的数据装配。
   * 每个 zone 的具体渲染下沉到共址子组件，通过显式 typed props 传值：
   *
   * - ControlRoomSystemStatusZone   系统状态摘要卡片（Orientation）
   * - ControlRoomNodeSelectorZone   节点清单选择条（Orientation/Investigation）
   * - ControlRoomMetricsStack       事件审计账本与功能域服务表格（Traceability）
   * - ControlRoomContextInspector   已选上下文检查器（Investigation/Traceability）
   * - ControlRoomGatedPreview       未授权预览分支（失败与不可用可见性）
   *
   * 归属边界：M-UI 只拥有 UI 结构。事实、能力、策略决策与审计事实仍归
   * M-* 功能域服务所有，经 Core public facade 与 M-UI BFF 适配后进入本组件。
   * CommandWell 由本工作台承载但不被吸收：命令资格、确认流程与执行结果
   * 仍由 CommandWell 组件与上游策略/审计边界负责。
   */
  const overview = $derived(appState.overview)
  const eventBusMetrics = $derived(appState.overview?.eventBusMetrics ?? null)
  const auditEntries: AuditEntry[] | null = $derived(appState.auditEntries)

  const dependencySummary = $derived.by(() => {
    if (!overview) return { ready: 0, total: 0 }
    const entries = Object.entries(overview.dependencies)
    return {
      ready: entries.filter(([, state]) => state === 'ready').length,
      total: entries.length
    }
  })

  const degradedState = $derived.by(() => {
    if (!overview) return null
    if (overview.core.mode !== 'normal') return `Core 当前处于 ${overview.core.mode} 模式`
    const unavailable = Object.entries(overview.dependencies)
      .filter(([, state]) => state !== 'ready')
      .map(([name]) => name)
    if (unavailable.length > 0) return `依赖不可用：${unavailable.join('、')}`
    return null
  })

  const nodeCounts = $derived.by(() => {
    if (!overview) return { total: 0, reachable: 0, leaf: 0 }
    const leaf = overview.nodes.filter(n => n.kind === 'leaf').length
    const reachable = overview.nodes.filter(
      n => n.reachability === 'reachable' || n.reachability === 'public'
    ).length
    return { total: overview.nodes.length, reachable, leaf }
  })

  const selectedNodeName = $derived(appState.selectedNode?.name ?? null)
  const forcedRelaySummary = $derived.by(() => {
    const state = appState.operationalState?.forcedRelay
    if (!state) return 'forced relay 状态未加载'
    if (!state.active) return 'Forced relay 未激活'
    return `${state.routeClass ?? 'forced-tcp-relay'} · ${state.affectedNodeIds.length} nodes`
  })
  const taskResultTaskId = $derived.by(() => {
    const result = appState.taskResult
    return result && 'task' in result ? result.task.id : '—'
  })
  const taskResultTaskStatus = $derived.by(() => {
    const result = appState.taskResult
    return result && 'task' in result ? result.task.status : '—'
  })

  function selectNode(nodeId: string) {
    void appState.selectNode(nodeId)
  }

  onMount(() => {
    void appState.fetchRoutes()
    void appState.refresh()
  })
</script>

<svelte:head>
  <title>控制室概览 | Meristem</title>
</svelte:head>

<div class="control-room-page">
  {#if degradedState}
    <InlineOperationalAlert message={degradedState} severity="warn" />
  {/if}

  {#if overview}
    <div class="control-room-layout">
      <div class="workspace-zones">
        <!-- Title block -->
        <header class="page-title-block">
          <div class="page-titles">
            <h2 class="page-eyebrow">控制室概览</h2>
            <h1 class="page-title">控制室总览</h1>
            <p class="page-subtitle">观察 Core、功能域服务、Leaf 节点、策略、任务与审计状态。</p>
          </div>
          <div class="page-meta">
            <span class="status-badge">actor: {appState.actor ?? '—'}</span>
            <span class="status-badge">core: {overview.core.mode}</span>
            <span class="status-badge ready">控制面就绪</span>
          </div>
        </header>

        <!-- Summary cards -->
        <ControlRoomSystemStatusZone
          coreMode={overview.core.mode}
          coreVersion={overview.core.version}
          {eventBusMetrics}
          reachableNodeCount={nodeCounts.reachable}
          totalNodeCount={nodeCounts.total}
          {selectedNodeName}
          policySummary={appState.policySummary}
          auditAccessible={overview.auditAccessible}
          {forcedRelaySummary}
          eventStreamLastEventAt={appState.operationalState?.eventStream.lastEventAt}
        />

        <!-- CommandWell -->
        <section
          class="zone-panel command-zone"
          aria-labelledby="command-title"
          data-testid="control-room-quick-actions"
        >
          <div class="zone-header">
            <div class="zone-titles">
              <h2 class="zone-eyebrow">命令中心</h2>
              <h2 id="command-title">CommandWell · 受控操作井</h2>
            </div>
            <div class="command-context">
              执行上下文: {selectedNodeName ?? '—'}
            </div>
          </div>
          <CommandWell
            commandState={appState.commandState}
            commandStateError={appState.commandStateError}
            commandExecutionError={appState.commandExecutionError}
            selectedNode={appState.selectedNode}
            taskResult={appState.taskResult}
            confirming={appState.commandConfirming}
            onRequestConfirm={() => (appState.commandConfirming = true)}
            onCancel={() => (appState.commandConfirming = false)}
            onConfirm={async () => {
              if (appState.commandState?.command?.id === 'network.forced-relay.change.execute') {
                appState.commandParams = {
                  nodeId: appState.selectedNodeId,
                  reason: 'Control Room forced relay change'
                }
              } else {
                appState.commandParams = { leafNodeId: appState.selectedNodeId }
              }
              await appState.executeGenericCommand()
              void appState.refresh()
              if (appState.operationalState?.networkId) {
                void appState.fetchOperationalState(appState.operationalState.networkId)
              }
            }}
          />
        </section>

        <!-- Node selector strip -->
        <ControlRoomNodeSelectorZone
          nodes={overview.nodes}
          selectedNodeId={appState.selectedNodeId}
          onSelectNode={selectNode}
        />

        <!-- Dense ledger and service tables -->
        <ControlRoomMetricsStack
          timeline={overview.timeline}
          {auditEntries}
          services={overview.services}
        />
      </div>

      <ControlRoomContextInspector
        selectedNode={appState.selectedNode}
        selectedNodeId={appState.selectedNodeId}
        actor={appState.actor}
        permissions={appState.permissions}
        policySummary={appState.policySummary}
        taskCorrelationId={appState.taskResult?.correlationId}
        taskId={taskResultTaskId}
        taskStatus={taskResultTaskStatus}
      />
    </div>
  {:else if !appState.loading}
    <ControlRoomGatedPreview />
  {/if}
</div>

<style>
  .control-room-page {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
  }

  /* 主工作区与右侧检查器的两栏骨架；窄视口回落为单栏。 */
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

  /* CommandWell 宿主区域使用信息色描边，区分受控操作入口与只读区域。 */
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

  @media (max-width: 1200px) {
    .control-room-layout {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 960px) {
    .page-title-block {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
