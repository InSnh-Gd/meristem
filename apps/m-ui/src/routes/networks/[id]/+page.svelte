<script lang="ts">
  import { page } from '$app/state'
  import { onMount, onDestroy } from 'svelte'
  import { appState } from '$lib/stores.svelte.ts'
  import RouteHeader from '$lib/components/layout/RouteHeader.svelte'
  import NetworkDetailPanel from '$lib/components/modules/network/NetworkDetailPanel.svelte'
  import DataplaneStatusPanel from '$lib/components/modules/network/DataplaneStatusPanel.svelte'
  import JoinTicketPanel from '$lib/components/modules/network/JoinTicketPanel.svelte'
  import OperationalProgressFeed from '$lib/components/modules/network/OperationalProgressFeed.svelte'
  import CommandWell from '$lib/components/modules/command/CommandWell.svelte'
  import CredentialLifecyclePanel from '$lib/components/modules/network/CredentialLifecyclePanel.svelte'
  import NetworkEnableStageView from '$lib/components/modules/network/NetworkEnableStageView.svelte'
  import NetworkRepairStageView from '$lib/components/modules/network/NetworkRepairStageView.svelte'
  import NetworkRuntimeObservationView from '$lib/components/modules/network/NetworkRuntimeObservationView.svelte'
  import InlineOperationalAlert from '$lib/components/ui/InlineOperationalAlert.svelte'
  import type { NetworkRuntimeTruth } from '$lib/types.ts'

  const stateSources = ['authoritative', 'event', 'log', 'read-model', 'policy']
  const networkId = $derived(page.params.id)

  const runtimeTruth = $derived<NetworkRuntimeTruth | null>(
    appState.networkRuntimeState?.runtimeTruth ?? null
  )
  const profileState = $derived(runtimeTruth?.profile ?? null)
  const netbirdProcess = $derived(runtimeTruth?.netbirdProcess ?? null)
  const packetProof = $derived(runtimeTruth?.packetProof ?? null)
  const secretProvider = $derived(runtimeTruth?.secretProvider ?? null)
  const repairActions = $derived(runtimeTruth?.repairActions ?? [])
  const policyEligibility = $derived(appState.networkRuntimeState?.policyEligibility ?? null)

  const profileEnableCommand = $derived(
    policyEligibility?.commands.find((c) => c.commandId === 'network.profile.enable.execute') ?? null
  )

  async function refreshAll() {
    if (networkId) {
      await Promise.all([
        appState.fetchNetworkDetail(networkId),
        appState.fetchJoinTickets(networkId),
        appState.fetchOperationalState(networkId),
        appState.fetchNetworkRuntimeState(networkId)
      ])
    }
  }

  let stopPolling: (() => void) | null = null

  onMount(() => {
    if (networkId) {
      void appState.fetchNetworkDetail(networkId)
      void appState.fetchJoinTickets(networkId)
      void appState.fetchOperationalState(networkId)
      stopPolling = appState.startNetworkRuntimeStatePolling(networkId)
    }
  })

  onDestroy(() => {
    stopPolling?.()
    appState.stopNetworkRuntimeStatePolling()
  })
</script>

<svelte:head>
  <title>网络详情 | Meristem</title>
</svelte:head>

<section class="network-detail-page">
  <RouteHeader routeName="网络详情" {stateSources} />

  {#if appState.selectedNetworkLoading}
    <section class="empty-panel">
      <p>正在加载网络详情...</p>
    </section>
  {:else if appState.selectedNetworkError}
    <section class="empty-panel error">
      <p>{appState.selectedNetworkError}</p>
    </section>
  {:else if appState.selectedNetwork}
    <!-- 阶段 1：创建 / 选择 -->
    <section class="panel workbench-panel stage" id="stage-create-select" data-testid="stage-create-select">
      <div class="stage-header">
        <span class="stage-marker">1</span>
        <div class="stage-title-block">
          <h3>创建 / 选择网络</h3>
          <p class="stage-hint">选择或创建目标网络，作为管理循环的起点。</p>
        </div>
      </div>
      <NetworkDetailPanel networkData={appState.selectedNetwork} />
    </section>

    <!-- 阶段 2：配置 -->
    <section class="panel workbench-panel stage" id="stage-configure" data-testid="stage-configure">
      <div class="stage-header">
        <span class="stage-marker">2</span>
        <div class="stage-title-block">
          <h3>配置网络</h3>
          <p class="stage-hint">查看数据面配置、网络地图与成员拓扑。</p>
        </div>
      </div>
      <DataplaneStatusPanel
        statusData={appState.selectedNetwork.dataPlaneStatus}
        mapSummary={appState.selectedNetwork.networkMapSummary}
      />
    </section>

    <!-- 阶段 3：启用 -->
    <section class="panel workbench-panel stage" id="stage-enable" data-testid="stage-enable">
      <div class="stage-header">
        <span class="stage-marker">3</span>
        <div class="stage-title-block">
          <h3>启用 Profile</h3>
          <p class="stage-hint">通过 CommandWell 启用 v0.3 Profile；BFF 仅展示策略资格，最终授权由 M-Policy 决定。</p>
        </div>
      </div>

      <NetworkEnableStageView
        {profileState}
        enableCommand={profileEnableCommand}
        loading={appState.networkRuntimeStateLoading}
        errorMessage={appState.networkRuntimeStateError}
        onRetry={refreshAll}
      />
    </section>

    <!-- 阶段 4：观察 -->
    <section class="panel workbench-panel stage" id="stage-observe" data-testid="stage-observe">
      <div class="stage-header">
        <span class="stage-marker">4</span>
        <div class="stage-title-block">
          <h3>观察运行态</h3>
          <p class="stage-hint">对照 desired / observed NetBird 状态、凭证生命周期与部署进度。</p>
        </div>
      </div>

      {#if runtimeTruth}
        <NetworkRuntimeObservationView {netbirdProcess} {packetProof} {secretProvider} />
      {:else if !appState.networkRuntimeStateError}
        <p class="loading-line">正在加载运行态...</p>
      {/if}

      <div class="observe-subsection" id="network-credential-lifecycle">
        <h4>凭证生命周期</h4>
        <CredentialLifecyclePanel operationalState={appState.operationalState} />
      </div>

      <div class="observe-subsection" id="network-operational-progress">
        <h4>运营与部署进度</h4>
        {#if appState.operationalStateLoading && !appState.operationalState}
          <p class="loading-line">正在加载运营状态...</p>
        {:else if appState.operationalStateError}
          <InlineOperationalAlert severity="block" message={appState.operationalStateError} />
          <button class="refresh-btn" style="margin-top: var(--space-2);" onclick={refreshAll}>重试</button>
        {:else}
          <OperationalProgressFeed
            operationalState={appState.operationalState}
            onRefresh={refreshAll}
            refreshing={appState.operationalStateLoading}
          />
        {/if}
      </div>
    </section>

    <!-- 阶段 5：修复 -->
    <section class="panel workbench-panel stage" id="stage-repair" data-testid="stage-repair">
      <div class="stage-header">
        <span class="stage-marker">5</span>
        <div class="stage-title-block">
          <h3>修复</h3>
          <p class="stage-hint">通过 CommandWell 触发受支持的修复命令；禁用态会展示具体修复指导。</p>
        </div>
      </div>

      <NetworkRepairStageView {repairActions} />

      <div class="observe-subsection">
        <h4>Join Tickets</h4>
        <JoinTicketPanel networkId={networkId} ticketsData={appState.joinTickets} />
      </div>
    </section>

  {:else}
    <section class="empty-panel workbench-panel">
      <p>未找到网络：<span class="mono">{networkId}</span></p>
    </section>
  {/if}
</section>

<div class="command-region">
  <CommandWell
    commandState={appState.commandState}
    commandStateError={appState.commandStateError}
    selectedNode={appState.selectedNode}
    confirming={appState.commandConfirming}
    emptyStateText="请在面板中验证操作资格"
    targetLabel="网络 ID"
    targetName={networkId}
    onRequestConfirm={() => appState.commandConfirming = true}
    onCancel={() => appState.commandConfirming = false}
    onConfirm={async () => {
      if (appState.commandState?.command?.id === 'network.forced-relay.change.execute' && appState.selectedNodeId) {
        appState.commandParams = {
          nodeId: appState.selectedNodeId,
          reason: 'network detail forced relay change'
        }
      }
      await appState.executeGenericCommand()
      if (networkId) {
        void appState.fetchJoinTickets(networkId)
        void appState.fetchNetworkDetail(networkId)
        void appState.fetchOperationalState(networkId)
        void appState.fetchNetworkRuntimeState(networkId)
      }
    }}
  />
</div>

<style>
  .network-detail-page {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
    margin-bottom: 120px;
  }

  .panel,
  .empty-panel {
    min-width: 0;
  }

  .panel {
    gap: var(--space-4);
  }

  h3 {
    color: var(--text-100);
    font-size: var(--text-base);
    font-weight: var(--fw-semibold);
    margin: 0;
  }

  h4 {
    color: var(--text-100);
    font-size: var(--text-sm);
    font-weight: var(--fw-semibold);
    margin: 0;
  }

  .empty-panel {
    color: var(--text-100);
    font-size: var(--text-sm);
  }

  .empty-panel.error {
    color: var(--signal-warn);
    border-color: var(--signal-warn);
  }

  .mono {
    font-family: var(--font-mono);
  }

  .loading-line {
    color: var(--text-60);
    font-size: var(--text-sm);
  }

  .stage {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .stage-header {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
  }

  .stage-marker {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-pill);
    border: 1px solid color-mix(in srgb, var(--signal-info) 40%, var(--line-soft));
    background: color-mix(in srgb, var(--signal-info) 12%, transparent);
    color: var(--signal-info);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: var(--fw-semibold);
  }

  .stage-title-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .stage-hint {
    color: var(--text-60);
    font-size: var(--text-xs);
    margin: 0;
  }

  .observe-subsection {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .refresh-btn {
    margin-top: var(--space-2);
    padding: var(--space-1) var(--space-3);
    background: var(--surface-root);
    border: 1px solid var(--line-strong);
    border-radius: var(--control-radius);
    color: var(--text-100);
    cursor: pointer;
    font-size: var(--text-xs);
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

  @media (max-width: 760px) {
    .command-region {
      left: 0;
    }
  }
</style>