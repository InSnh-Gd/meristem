<script lang="ts">
  import type { NetworkListResponseData } from '$lib/types.ts'

  let {
    networks,
    detailBasePath = '/networks',
    selectedNetworkId = null
  } = $props<{
    networks: NetworkListResponseData['networks']
    detailBasePath?: string
    selectedNetworkId?: string | null
  }>()
</script>

{#if networks.length === 0}
  <p class="empty-state">暂无网络。</p>
{:else}
  <div class="network-list" role="list" aria-label="数据面网络列表">
    {#each networks as network}
      <a
        class:selected={selectedNetworkId === network.id}
        class="network-card"
        href={`${detailBasePath}/${encodeURIComponent(network.id)}`}
      >
        <div class="network-header">
          <div>
            <h3 class="mono">{network.name}</h3>
            <p class="network-id">ID: {network.id}</p>
          </div>
        </div>

        <dl class="network-meta">
          <div>
            <dt>状态</dt>
            <dd>{network.status}</dd>
          </div>
          <div>
            <dt>Profile 版本</dt>
            <dd>{network.profileVersion}</dd>
          </div>
          <div>
            <dt>成员数</dt>
            <dd>{network.memberCount ?? 0}</dd>
          </div>
          <div>
            <dt>创建时间</dt>
            <dd>{network.createdAt}</dd>
          </div>
        </dl>
      </a>
    {/each}
  </div>
{/if}

<style>
  .network-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .network-card,
  .empty-state {
    border: 1px solid var(--line-soft);
    background: var(--surface-root);
    padding: var(--space-3);
  }

  .network-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    color: var(--text-100);
    text-decoration: none;
  }

  .network-card:hover,
  .network-card:focus-visible,
  .network-card.selected {
    border-color: var(--line-strong);
    outline: 1px solid var(--signal-info);
    outline-offset: 0;
  }

  .network-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }

  h3 {
    color: var(--text-100);
    font-size: var(--text-lg);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
    margin: 0;
  }

  .network-id,
  .network-meta dd,
  .mono,
  .empty-state {
    font-family: var(--font-mono);
  }

  .network-id,
  .network-meta dt,
  .network-meta dd,
  .empty-state {
    font-size: var(--text-xs);
  }

  .network-id,
  .network-meta dt {
    color: var(--text-60);
  }

  .network-meta {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
    margin: 0;
  }

  .network-meta div {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .network-meta dd,
  .empty-state {
    color: var(--text-100);
    line-height: var(--lh-log);
    margin: 0;
    word-break: break-word;
  }

  @media (max-width: 760px) {
    .network-meta {
      grid-template-columns: 1fr;
    }
  }
</style>
