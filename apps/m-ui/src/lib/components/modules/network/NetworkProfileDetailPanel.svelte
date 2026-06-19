<script lang="ts">
  import type { NetworkProfileDetailResponseData } from '$lib/types.ts'
  import StateSourceBadge from '$lib/components/ui/StateSourceBadge.svelte'

  let { profile } = $props<{ profile: NetworkProfileDetailResponseData }>()

  const formattedRules = $derived(JSON.stringify(profile.rules, null, 2))
</script>

<section class="profile-detail-panel" aria-label="网络 Profile 详情面板">
  <div class="profile-header">
    <div>
      <p class="eyebrow">Profile 详情</p>
      <h3>{profile.displayName}</h3>
      <p class="profile-version">{profile.profileVersion}</p>
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
      <dt>Schema</dt>
      <dd>{profile.schemaVersion}</dd>
    </div>
    <div>
      <dt>控制面限定</dt>
      <dd>{profile.capabilities.controlPlaneOnly ? '是' : '否'}</dd>
    </div>
    <div>
      <dt>Wstunnel 中继</dt>
      <dd>{profile.capabilities.realWstunnelRelay ? '是' : '否'}</dd>
    </div>
    <div>
      <dt>TCP 互联</dt>
      <dd>{profile.capabilities.realTcpInterconnect ? '是' : '否'}</dd>
    </div>
    <div>
      <dt>UDP 切换</dt>
      <dd>{profile.capabilities.realUdpPathSwitching ? '是' : '否'}</dd>
    </div>
    <div>
      <dt>来源 ID</dt>
      <dd>{profile.stateSource.sourceId}</dd>
    </div>
  </dl>

  <section class="rules-section" aria-labelledby="profile-rules-title">
    <h4 id="profile-rules-title">规则摘要</h4>
    <pre>{formattedRules}</pre>
  </section>
</section>

<style>
  .profile-detail-panel,
  .rules-section {
    border: 1px solid var(--line-soft);
    background: var(--surface-root);
  }

  .profile-detail-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
  }

  .profile-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .eyebrow,
  .profile-version,
  .profile-meta dt,
  .profile-meta dd {
    font-size: var(--text-xs);
  }

  .eyebrow,
  .profile-version,
  .profile-meta dt {
    color: var(--text-60);
  }

  h3,
  h4 {
    color: var(--text-100);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
    margin: 0;
  }

  h3 {
    font-size: var(--text-lg);
  }

  h4 {
    font-size: var(--text-sm);
    padding: var(--space-3) var(--space-3) 0;
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

  .profile-meta dd {
    color: var(--text-100);
    font-family: var(--font-mono);
    line-height: var(--lh-log);
    margin: 0;
    word-break: break-word;
  }

  .rules-section {
    background: var(--surface-sunken);
  }

  pre {
    overflow-x: auto;
    color: var(--text-80);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: var(--lh-log);
    margin: 0;
    padding: var(--space-3);
    white-space: pre-wrap;
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
