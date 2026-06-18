<script lang="ts">
  import { appState } from '$lib/stores.svelte.ts'
  import RouteHeader from '$lib/components/RouteHeader.svelte'
  import CommandWell from '$lib/components/CommandWell.svelte'
  import type { GenericCommandParams } from '$lib/types.ts'

  const stateSources = ['authoritative', 'audit']

  let networkId = $state('')
  let confirmation = $state('')
  let emergencyReason = $state('')

  const commandId = 'network.break-glass.execute'

  async function checkEligibility() {
    if (!networkId || !confirmation) return
    const params: Record<string, string> = { networkId, confirmation }
    if (emergencyReason) params.emergencyReason = emergencyReason
    
    appState.commandState = null
    appState.commandParams = params
    try {
      const { fetchCommandEligibility } = await import('$lib/bff')
      appState.commandState = await fetchCommandEligibility(appState.token, commandId, params as GenericCommandParams)
    } catch {
      appState.commandState = null
      appState.commandParams = null
    }
  }

  $effect(() => {
    networkId
    confirmation
    emergencyReason
    appState.commandState = null
  })
</script>

<svelte:head>
  <title>紧急预案 (Break-glass) | Meristem</title>
</svelte:head>

<section class="break-glass-page">
  <RouteHeader routeName="紧急预案 (Break-glass)" {stateSources} />

  <div class="panel alert-panel">
    <h3>⚠ 警告：破坏性操作</h3>
    <p>此操作将绕过正常的策略检查强制执行控制面下发。仅在 Core 异常、网络不可用或正常策略阻断了紧急恢复流程时使用。此操作会被强制审计记录。</p>
  </div>

  <div class="panel form-panel">
    <h3>参数配置</h3>
    <div class="form-group">
      <label for="network-id">网络 ID</label>
      <input id="network-id" type="text" bind:value={networkId} class="mono" placeholder="输入网络 ID..." />
    </div>

    <div class="form-group">
      <label for="confirmation">操作确认指令</label>
      <input id="confirmation" type="text" bind:value={confirmation} class="mono" placeholder="输入确认短语以继续..." />
    </div>

    <div class="form-group">
      <label for="emergency-reason">紧急原因 (强烈建议)</label>
      <input id="emergency-reason" type="text" bind:value={emergencyReason} placeholder="描述为何需要动用紧急预案..." />
    </div>

    <div class="action-row">
      <button class="check-btn" onclick={checkEligibility} disabled={!networkId || !confirmation}>
        验证紧急操作资格
      </button>
    </div>
  </div>
</section>

<div class="command-region">
  <CommandWell
    commandState={appState.commandState}
    selectedNode={appState.selectedNode}
    confirming={appState.commandConfirming}
    emptyStateText="请在面板中验证紧急操作"
    targetLabel="目标网络"
    targetName={networkId}
    onRequestConfirm={() => appState.commandConfirming = true}
    onCancel={() => appState.commandConfirming = false}
    onConfirm={async () => {
      await appState.executeGenericCommand()
    }}
  />
</div>

<style>
  .break-glass-page {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
    margin-bottom: 120px;
  }

  .panel {
    border: 1px solid var(--line-soft);
    background: var(--surface-root);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .alert-panel {
    border-color: var(--signal-error);
    background: color-mix(in srgb, var(--signal-error) 10%, var(--surface-root));
  }

  .alert-panel h3 {
    color: var(--signal-error);
  }

  .alert-panel p {
    color: var(--text-80);
    font-size: var(--text-sm);
    line-height: var(--lh-log);
    margin: 0;
  }

  h3 {
    font-size: var(--text-base);
    font-weight: var(--fw-semibold);
    color: var(--text-100);
    margin: 0;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  label {
    font-size: var(--text-xs);
    color: var(--text-60);
    font-weight: var(--fw-semibold);
  }

  input {
    padding: var(--space-2);
    border: 1px solid var(--line-soft);
    background: var(--surface-root);
    color: var(--text-100);
    font-size: var(--text-sm);
  }

  input:focus {
    outline: 1px solid var(--signal-error);
    border-color: var(--signal-error);
  }

  .mono {
    font-family: var(--font-mono);
  }

  .action-row {
    margin-top: var(--space-2);
  }

  .check-btn {
    padding: var(--space-2) var(--space-4);
    background: var(--surface-root);
    border: 1px solid var(--signal-error);
    color: var(--signal-error);
    cursor: pointer;
    font-size: var(--text-sm);
    font-weight: var(--fw-medium);
  }

  .check-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    border-color: var(--line-strong);
    color: var(--text-60);
  }

  .check-btn:not(:disabled):hover {
    background: var(--signal-error);
    color: var(--surface-root);
  }

  .command-region {
    position: fixed;
    right: 0;
    bottom: 0;
    left: var(--nav-rail-width);
    z-index: 10;
    border-top: 1px solid var(--signal-error);
    background: var(--surface-root);
    padding: var(--space-3) var(--shell-padding-x);
  }
</style>
