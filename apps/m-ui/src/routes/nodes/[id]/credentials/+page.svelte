<script lang="ts">
  import { page } from '$app/state'
  import { onMount } from 'svelte'
  import { appState } from '$lib/stores.svelte.ts'
  import RouteHeader from '$lib/components/layout/RouteHeader.svelte'
  import NodeCredentialPanel from '$lib/components/modules/nodes/NodeCredentialPanel.svelte'
  import CommandWell from '$lib/components/modules/command/CommandWell.svelte'
  import { executeCommand } from '$lib/bff'

  const stateSources = ['authoritative', 'audit']
  const nodeId = $derived(page.params.id)

  onMount(() => {
    // We could pre-fill the nodeId in the panel by selecting the node
    void appState.selectNode(nodeId)
  })

  async function handleConfirm() {
    if (!appState.commandState?.command || !appState.token || !nodeId) return
    appState.commandConfirming = false
    appState.loading = true
    appState.error = null
    
    // We get the params from the panel using a dirty hack or we pass the params through state.
    // Wait, NodeCredentialPanel executes fetchCommandEligibility but we don't store the parameters.
    // Let's modify NodeCredentialPanel to expose the params or just have the credentials page pass them.
    // Actually, it's better if NodeCredentialPanel handles the eligibility and executes it? No, CommandWell handles execution.
    // CommandWell takes `onConfirm`. We need the parameters. Let's make `appState.commandParams` to hold the current parameters!
  }
</script>

<svelte:head>
  <title>节点凭证 | Meristem</title>
</svelte:head>

<section class="credentials-page">
  <RouteHeader routeName="节点凭证" {stateSources} />

  <div class="panel workbench-panel">
    <NodeCredentialPanel initialNodeId={nodeId} />
  </div>
</section>

<div class="command-region">
  <CommandWell
    commandState={appState.commandState}
    commandStateError={appState.commandStateError}
    selectedNode={appState.selectedNode}
    confirming={appState.commandConfirming}
    emptyStateText="请在面板中验证操作资格"
    targetLabel="节点 ID"
    targetName={nodeId}
    onRequestConfirm={() => appState.commandConfirming = true}
    onCancel={() => appState.commandConfirming = false}
    onConfirm={async () => {
      await appState.executeGenericCommand()
    }}
  />
</div>

<style>
  .credentials-page {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
    margin-bottom: 120px; /* Space for CommandWell */
  }

  .panel {
    min-width: 0;
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
