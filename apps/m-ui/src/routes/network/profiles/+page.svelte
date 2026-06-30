<script lang="ts">
  import { onMount } from 'svelte'
  import InlineOperationalAlert from '$lib/components/ui/InlineOperationalAlert.svelte'
  import NetworkProfileListPanel from '$lib/components/modules/network/NetworkProfileListPanel.svelte'
  import RouteHeader from '$lib/components/layout/RouteHeader.svelte'
  import { appState as muiStores } from '$lib/stores.svelte.ts'

  const stateSources = ['authoritative', 'policy', 'audit']

  onMount(() => {
    void muiStores.fetchNetworkProfiles()
  })
</script>

<svelte:head>
  <title>网络 Profile | Meristem</title>
</svelte:head>

<section class="route-page" aria-labelledby="network-profile-list-title">
  <RouteHeader routeName="网络 Profile" {stateSources} />

  <div>
    <h2 id="network-profile-list-title" class="section-title">网络 Profile</h2>
    <p class="section-copy">展示控制面限定 Profile、版本与权威来源，不在此页面执行切换。</p>
  </div>

  <InlineOperationalAlert
    message="当前列表仅展示控制面 Profile。启用或停用动作保留为详情页中的禁用展示态。"
    severity="warn"
  />

  {#if muiStores.networkProfilesError}
    <InlineOperationalAlert message={muiStores.networkProfilesError} severity="block" />
  {/if}

  <section class="panel workbench-panel" aria-label="网络 Profile 列表">
    {#if muiStores.networkProfilesLoading}
      <p class="empty-state">正在加载网络 Profile。</p>
    {:else}
      <NetworkProfileListPanel profiles={muiStores.networkProfiles?.profiles ?? []} />
    {/if}
  </section>
</section>

<style>
  .route-page {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .section-title,
  .section-copy,
  .empty-state {
    color: var(--text-100);
  }

  .section-title {
    font-size: var(--text-lg);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
    margin: 0;
  }

  .section-copy,
  .empty-state {
    font-size: var(--text-sm);
    line-height: var(--lh-log);
  }

  .empty-state {
    margin: 0;
  }
</style>
