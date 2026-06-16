<script lang="ts">
  import { page } from '$app/state'
  import { onMount } from 'svelte'
  import InlineOperationalAlert from '$lib/components/InlineOperationalAlert.svelte'
  import NetworkProfileDetailPanel from '$lib/components/NetworkProfileDetailPanel.svelte'
  import OperationalCommandPreview from '$lib/components/OperationalCommandPreview.svelte'
  import RawEnvelopeView from '$lib/components/RawEnvelopeView.svelte'
  import RouteHeader from '$lib/components/RouteHeader.svelte'
  import { appState as muiStores } from '$lib/stores.svelte.ts'

  const stateSources = ['authoritative', 'policy', 'audit', 'log']
  const profileVersion = $derived(page.params.profileVersion)

  onMount(() => {
    if (profileVersion) {
      void muiStores.fetchNetworkProfileDetail(profileVersion)
    }
  })
</script>

<svelte:head>
  <title>Profile 详情 | Meristem</title>
</svelte:head>

<section class="route-page" aria-labelledby="network-profile-detail-title">
  <RouteHeader routeName="Profile 详情" {stateSources} />

  <div>
    <h2 id="network-profile-detail-title" class="section-title">Profile 详情</h2>
    <p class="section-copy">保留 Profile 能力、规则与只读命令预览，避免在前端发起直接切换。</p>
  </div>

  {#if muiStores.selectedProfileError}
    <InlineOperationalAlert message={muiStores.selectedProfileError} severity="block" />
  {/if}

  {#if muiStores.selectedProfileLoading}
    <section class="empty-panel">
      <p>正在加载 Profile 详情。</p>
    </section>
  {:else if muiStores.selectedProfile}
    <div class="detail-layout">
      <div class="detail-stack">
        <NetworkProfileDetailPanel profile={muiStores.selectedProfile} />
        <section class="preview-grid" aria-label="Profile 命令预览">
          <OperationalCommandPreview
            commandId="network.profile.enable.preview"
            disabledReason="当前演示壳仅展示启用资格，启用动作保留给后续 CommandWell。"
            resource={`profile/${muiStores.selectedProfile.profileVersion}`}
          />
          <OperationalCommandPreview
            commandId="network.profile.disable.preview"
            disabledReason="当前演示壳仅展示停用资格，停用动作保留给后续 CommandWell。"
            resource={`profile/${muiStores.selectedProfile.profileVersion}`}
          />
        </section>
      </div>

      <aside class="raw-panel" aria-label="Profile 原始数据">
        <RawEnvelopeView title="原始 Profile 数据" data={muiStores.selectedProfile} />
      </aside>
    </div>
  {:else}
    <section class="empty-panel">
      <p>未找到 Profile：<span class="mono">{profileVersion}</span></p>
    </section>
  {/if}
</section>

<style>
  .route-page,
  .detail-stack {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
  }

  .detail-layout {
    display: grid;
    grid-template-columns: 1fr var(--inspector-width);
    gap: var(--panel-gap);
  }

  .preview-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .raw-panel,
  .empty-panel {
    border: 1px solid var(--line-soft);
    background: var(--surface-root);
    padding: var(--space-4);
  }

  .section-title,
  .section-copy,
  .empty-panel {
    color: var(--text-100);
  }

  .section-title {
    font-size: var(--text-lg);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
  }

  .section-copy,
  .empty-panel {
    font-size: var(--text-sm);
    line-height: var(--lh-log);
  }

  .mono {
    font-family: var(--font-mono);
  }

  @media (max-width: 960px) {
    .detail-layout {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 760px) {
    .preview-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
