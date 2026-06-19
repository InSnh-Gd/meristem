<script lang="ts">
  import type { NetworkProfileListResponseData } from '$lib/types.ts'
  import StateSourceBadge from '$lib/components/ui/StateSourceBadge.svelte'

  let {
    profiles,
    detailBasePath = '/network/profiles',
    selectedProfileVersion = null
  } = $props<{
    profiles: NetworkProfileListResponseData['profiles']
    detailBasePath?: string
    selectedProfileVersion?: string | null
  }>()
</script>

{#if profiles.length === 0}
  <p class="empty-state">暂无网络 Profile。</p>
{:else}
  <div class="profile-list" role="list" aria-label="网络 Profile 列表">
    {#each profiles as profile}
      <a
        class:selected={selectedProfileVersion === profile.profileVersion}
        class="profile-card"
        href={`${detailBasePath}/${encodeURIComponent(profile.profileVersion)}`}
      >
        <div class="profile-header">
          <div>
            <p class="profile-version">{profile.profileVersion}</p>
            <h3>{profile.displayName}</h3>
          </div>
          <StateSourceBadge source={profile.stateSource.sourceType} />
        </div>

        <dl class="profile-meta">
          <div>
            <dt>区域</dt>
            <dd>{profile.region}</dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd>{profile.status}</dd>
          </div>
          <div>
            <dt>控制面限定</dt>
            <dd>{profile.capabilities.controlPlaneOnly ? '是' : '否'}</dd>
          </div>
          <div>
            <dt>Schema</dt>
            <dd>{profile.schemaVersion}</dd>
          </div>
        </dl>

        <p class="state-source-copy">来源 ID：<span class="mono">{profile.stateSource.sourceId}</span></p>
      </a>
    {/each}
  </div>
{/if}

<style>
  .profile-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .profile-card,
  .empty-state {
    border: 1px solid var(--line-soft);
    background: var(--surface-root);
    padding: var(--space-3);
  }

  .profile-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    color: var(--text-100);
    text-decoration: none;
  }

  .profile-card:hover,
  .profile-card:focus-visible,
  .profile-card.selected {
    border-color: var(--line-strong);
    outline: 1px solid var(--signal-info);
    outline-offset: 0;
  }

  .profile-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }

  h3,
  .profile-version,
  .profile-meta dd,
  .state-source-copy,
  .mono,
  .empty-state {
    font-family: var(--font-mono);
  }

  h3 {
    color: var(--text-100);
    font-family: var(--font-body);
    font-size: var(--text-lg);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
    margin: 0;
  }

  .profile-version,
  .profile-meta dt,
  .profile-meta dd,
  .state-source-copy,
  .empty-state {
    font-size: var(--text-xs);
  }

  .profile-version,
  .profile-meta dt {
    color: var(--text-60);
  }

  .profile-meta {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
    margin: 0;
  }

  .profile-meta div {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .profile-meta dd,
  .state-source-copy,
  .empty-state {
    color: var(--text-100);
    line-height: var(--lh-log);
    margin: 0;
    word-break: break-word;
  }

  @media (max-width: 760px) {
    .profile-header {
      flex-direction: column;
    }

    .profile-meta {
      grid-template-columns: 1fr;
    }
  }
</style>
