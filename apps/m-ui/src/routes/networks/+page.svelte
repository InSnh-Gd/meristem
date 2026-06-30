<script lang="ts">
  import { onMount } from 'svelte'
  import { appState } from '$lib/stores.svelte.ts'
  import RouteHeader from '$lib/components/layout/RouteHeader.svelte'
  import NetworkListPanel from '$lib/components/modules/network/NetworkListPanel.svelte'
  import InlineOperationalAlert from '$lib/components/ui/InlineOperationalAlert.svelte'

  const stateSources = ['authoritative', 'event']

  let newNetworkName = $state('')
  let newNetworkProfile = $state('')
  let createLoading = $state(false)
  let createError = $state<string | null>(null)

  async function handleCreateNetwork() {
    if (!newNetworkName) return
    createLoading = true
    createError = null
    try {
      await appState.createNetwork(newNetworkName, newNetworkProfile || undefined)
      newNetworkName = ''
      newNetworkProfile = ''
    } catch (e: unknown) {
      const { formatBffError } = await import('$lib/bff')
      createError = formatBffError(e, '创建网络失败')
    } finally {
      createLoading = false
    }
  }

  onMount(() => {
    void appState.fetchNetworks()
  })
</script>

<svelte:head>
  <title>数据面网络 | Meristem</title>
</svelte:head>

<section class="networks-page">
  <RouteHeader routeName="数据面网络" {stateSources} />

  <div class="panel workbench-panel" data-testid="create-network-form">
    <div class="zone-titles">
      <span class="zone-eyebrow">Create Network</span>
      <h3>创建数据面网络</h3>
    </div>
    {#if createError}
      <InlineOperationalAlert message={createError} severity="block" />
    {/if}
    <div class="form-row">
      <div class="form-group">
        <label for="new-network-name">网络名称</label>
        <input
          id="new-network-name"
          type="text"
          placeholder="例如: test-network"
          bind:value={newNetworkName}
          data-testid="network-name-input"
        />
      </div>
      <div class="form-group">
        <label for="new-network-profile">初始 Profile 版本</label>
        <select
          id="new-network-profile"
          bind:value={newNetworkProfile}
          data-testid="network-profile-select"
        >
          <option value="">请选择 Profile (可选)</option>
          <option value="m-net@0.3.0">m-net@0.3.0 (NetBird Default)</option>
          <option value="m-net-cn@0.3.0">m-net-cn@0.3.0 (NetBird CN Relay)</option>
        </select>
      </div>
    </div>
    <div class="action-row">
      <button
        class="workbench-btn workbench-btn-primary"
        onclick={handleCreateNetwork}
        disabled={!newNetworkName || createLoading}
        data-testid="create-network-btn"
      >
        {createLoading ? '正在创建...' : '创建网络'}
      </button>
    </div>
  </div>

  {#if appState.networksLoading}
  <section class="empty-panel workbench-panel">
    <p>正在加载网络列表...</p>
  </section>
  {:else if appState.networksError}
    <section class="empty-panel workbench-panel error">
      <p>{appState.networksError}</p>
    </section>
  {:else if appState.networks}
    <NetworkListPanel networks={appState.networks.networks} detailBasePath="/networks" />
  {:else}
    <section class="empty-panel workbench-panel">
      <p>暂无数据面网络</p>
    </section>
  {/if}
</section>

<style>
  .networks-page {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }

  .zone-titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  h3 {
    font-size: var(--text-base);
    font-weight: var(--fw-semibold);
    color: var(--text-100);
    margin: 0;
  }

  .form-row {
    display: flex;
    gap: var(--space-3);
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    flex: 1;
  }

  label {
    font-size: var(--text-xs);
    color: var(--text-60);
    font-weight: var(--fw-semibold);
  }

  input, select {
    padding: var(--space-2);
    border: 1px solid var(--line-soft);
    border-radius: var(--control-radius);
    background: var(--surface-root);
    color: var(--text-100);
    font-size: var(--text-sm);
  }

  input:focus, select:focus {
    outline: 1px solid var(--signal-info);
    border-color: var(--line-strong);
  }

  .action-row {
    margin-top: var(--space-2);
  }

  .empty-panel {
    color: var(--text-100);
    font-size: var(--text-sm);
  }

  .empty-panel.error {
    color: var(--signal-warn);
    border-color: var(--signal-warn);
  }
</style>
