<script lang="ts">
  import { page } from '$app/state'
  import { onMount } from 'svelte'
  import { appState } from '$lib/stores.svelte.ts'
  import RouteHeader from '$lib/components/layout/RouteHeader.svelte'
  import NetworkDetailPanel from '$lib/components/modules/network/NetworkDetailPanel.svelte'
  import DataplaneStatusPanel from '$lib/components/modules/network/DataplaneStatusPanel.svelte'
  import JoinTicketPanel from '$lib/components/modules/network/JoinTicketPanel.svelte'
  import OperationalProgressFeed from '$lib/components/modules/network/OperationalProgressFeed.svelte'
  import CommandWell from '$lib/components/modules/command/CommandWell.svelte'
  import CredentialLifecyclePanel from '$lib/components/modules/network/CredentialLifecyclePanel.svelte'
  import InlineOperationalAlert from '$lib/components/ui/InlineOperationalAlert.svelte'

  const stateSources = ['authoritative', 'event', 'log']
  const networkId = $derived(page.params.id)

  async function refreshAll() {
    if (networkId) {
      await Promise.all([
        appState.fetchNetworkDetail(networkId),
        appState.fetchJoinTickets(networkId),
        appState.fetchOperationalState(networkId)
      ])
    }
  }

  onMount(() => {
    if (networkId) {
      void appState.fetchNetworkDetail(networkId)
      void appState.fetchJoinTickets(networkId)
      void appState.fetchOperationalState(networkId)
    }
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
    <div class="panel workbench-panel">
      <NetworkDetailPanel networkData={appState.selectedNetwork} />
    </div>

    <div class="panel workbench-panel">
      <h3>数据面状态</h3>
      <DataplaneStatusPanel 
        statusData={appState.selectedNetwork.dataPlaneStatus} 
        mapSummary={appState.selectedNetwork.networkMapSummary} 
      />
    </div>

    <div class="panel workbench-panel" id="network-operational-progress">
      <h3>运营与部署进度</h3>
      {#if appState.operationalStateLoading && !appState.operationalState}
        <p>正在加载运营状态...</p>
      {:else if appState.operationalStateError}
        <InlineOperationalAlert severity="block" message={appState.operationalStateError} />
        <button class="refresh-btn" style="margin-top: var(--space-2); padding: var(--space-1) var(--space-3); background: var(--surface-root); border: 1px solid var(--line-strong); border-radius: var(--control-radius); color: var(--text-100); cursor: pointer; font-size: var(--text-xs);" onclick={refreshAll}>重试</button>
      {:else}
        <OperationalProgressFeed 
          operationalState={appState.operationalState} 
          onRefresh={refreshAll}
          refreshing={appState.operationalStateLoading}
        />
      {/if}
    </div>

    <div class="panel workbench-panel" id="network-credential-lifecycle">
      <h3>凭证生命周期</h3>
      <CredentialLifecyclePanel operationalState={appState.operationalState} />
    </div>

    <div class="panel workbench-panel">
      <h3>Join Tickets</h3>
      <JoinTicketPanel networkId={networkId} ticketsData={appState.joinTickets} />
    </div>

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
</style>
