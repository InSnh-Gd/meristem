<script lang="ts">
  import { onMount } from 'svelte'
  import { appState } from '$lib/stores.svelte.ts'
  import RouteHeader from '$lib/components/RouteHeader.svelte'
  import NetworkListPanel from '$lib/components/NetworkListPanel.svelte'

  const stateSources = ['authoritative', 'event']

  onMount(() => {
    void appState.fetchNetworks()
  })
</script>

<svelte:head>
  <title>数据面网络 | Meristem</title>
</svelte:head>

<section class="networks-page">
  <RouteHeader routeName="数据面网络" {stateSources} />

  {#if appState.networksLoading}
    <section class="empty-panel">
      <p>正在加载网络列表...</p>
    </section>
  {:else if appState.networksError}
    <section class="empty-panel error">
      <p>{appState.networksError}</p>
    </section>
  {:else if appState.networks}
    <NetworkListPanel networks={appState.networks.networks} detailBasePath="/networks" />
  {:else}
    <section class="empty-panel">
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

  .empty-panel {
    border: 1px solid var(--line-soft);
    background: var(--surface-root);
    padding: var(--space-4);
    color: var(--text-100);
    font-size: var(--text-sm);
  }

  .empty-panel.error {
    color: var(--signal-warn);
    border-color: var(--signal-warn);
  }
</style>
