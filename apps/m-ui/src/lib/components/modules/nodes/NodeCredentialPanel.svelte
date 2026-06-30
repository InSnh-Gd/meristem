<script lang="ts">
  import { appState } from '$lib/stores.svelte.ts'
  import type { GenericCommandParams } from '$lib/types.ts'

  let { initialNodeId = '' } = $props<{ initialNodeId?: string }>()

  let networkId = $state('')
  let nodeId = $state(initialNodeId)
  let reason = $state('')
  let commandId = $state('mnet.node.credential.issue.execute')

  const commands = [
    { id: 'mnet.node.credential.issue.execute', label: '颁发凭证 (Issue)' },
    { id: 'mnet.node.credential.rotate.execute', label: '轮换凭证 (Rotate)' },
    { id: 'mnet.node.credential.revoke.execute', label: '吊销凭证 (Revoke)' }
  ]

  async function checkEligibility() {
    if (!networkId || !nodeId) return
    const params: Record<string, string> = { networkId, nodeId }
    if (commandId === 'mnet.node.credential.revoke.execute') {
      params.reason = reason
    }
    
    appState.commandState = null
    appState.commandParams = params
    try {
      const { fetchCommandEligibility } = await import('$lib/bff')
      appState.commandState = await fetchCommandEligibility(appState.token, commandId, params as GenericCommandParams)
    } catch (e: unknown) {
      const { formatBffError } = await import('$lib/bff')
      appState.commandState = null
      appState.commandParams = null
      appState.commandStateError = formatBffError(e, '验证操作资格失败')
    }
  }

  // Use an effect to reset commandState if inputs change, requiring a manual eligibility check
  $effect(() => {
    networkId
    nodeId
    reason
    commandId
    appState.commandState = null
  })
</script>

<div class="credential-panel">
  <div class="form-group">
    <label for="network-id">网络 ID</label>
    <input id="network-id" type="text" bind:value={networkId} class="mono-input" placeholder="输入网络 ID..." />
  </div>

  <div class="form-group">
    <label for="node-id">节点 ID</label>
    <input id="node-id" type="text" bind:value={nodeId} class="mono-input" placeholder="输入节点 ID..." />
  </div>

  <div class="form-group">
    <label for="command-select">操作类型</label>
    <select id="command-select" bind:value={commandId}>
      {#each commands as cmd}
        <option value={cmd.id}>{cmd.label}</option>
      {/each}
    </select>
  </div>

  {#if commandId === 'mnet.node.credential.revoke.execute'}
    <div class="form-group">
      <label for="revoke-reason">吊销原因</label>
      <input id="revoke-reason" type="text" bind:value={reason} placeholder="输入吊销原因..." />
    </div>
  {/if}

  <div class="action-row">
    <button class="check-btn" onclick={checkEligibility} disabled={!networkId || !nodeId}>
      验证操作资格
    </button>
  </div>
</div>

<style>
  .credential-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    border: 1px solid color-mix(in srgb, var(--line-soft) 84%, transparent);
    border-radius: var(--glass-panel-radius);
    background:
      linear-gradient(
        145deg,
        color-mix(in srgb, var(--surface-panel) 96%, var(--surface-chrome)),
        color-mix(in srgb, var(--surface-root) 96%, black)
      );
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--glass-panel-highlight) 32%, transparent),
      0 var(--space-2) var(--space-4) color-mix(in srgb, var(--surface-root) 78%, var(--surface-panel));
    padding: var(--space-4);
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  label {
    font-size: var(--text-sm);
    color: var(--text-60);
    font-weight: var(--fw-semibold);
  }

  input,
  select {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--line-soft);
    border-radius: var(--control-radius);
    background: var(--surface-root);
    color: var(--text-100);
    font-size: var(--text-sm);
  }

  input:focus,
  select:focus {
    outline: 1px solid var(--signal-info);
    border-color: var(--line-strong);
  }

  .mono-input {
    font-family: var(--font-mono);
  }

  .action-row {
    margin-top: var(--space-2);
  }

  .check-btn {
    padding: var(--space-2) var(--space-4);
    background: var(--surface-root);
    border: 1px solid var(--line-strong);
    border-radius: var(--control-radius);
    color: var(--text-100);
    cursor: pointer;
    font-size: var(--text-sm);
    transition:
      border-color var(--duration-fast) var(--easing-ui),
      background var(--duration-fast) var(--easing-ui);
  }

  .check-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .check-btn:not(:disabled):hover {
    border-color: var(--signal-info);
    background: var(--surface-raised);
  }
</style>
