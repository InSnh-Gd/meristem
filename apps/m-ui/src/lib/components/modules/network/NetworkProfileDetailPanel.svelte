<script lang="ts">
  import type { NetworkProfileDetailResponseData } from '$lib/types.ts'
  import StateSourceBadge from '$lib/components/ui/StateSourceBadge.svelte'

  let { profile } = $props<{ profile: NetworkProfileDetailResponseData }>()

  const formattedRules = $derived(JSON.stringify(profile.rules, null, 2))

  const capabilityRows = $derived([
    { key: 'controlPlaneOnly', label: '控制面限定', value: profile.capabilities.controlPlaneOnly },
    { key: 'realWstunnelRelay', label: 'Wstunnel 中继', value: profile.capabilities.realWstunnelRelay },
    { key: 'realTcpInterconnect', label: 'TCP 互联', value: profile.capabilities.realTcpInterconnect },
    { key: 'realUdpPathSwitching', label: 'UDP 切换', value: profile.capabilities.realUdpPathSwitching }
  ])
</script>

<section class="profile-detail-panel zone-panel" aria-label="网络 Profile 详情面板">
  <div class="panel-header">
    <div class="zone-titles">
      <span class="zone-eyebrow">Network profile</span>
      <h2>{profile.displayName}</h2>
    </div>
    <StateSourceBadge source={profile.stateSource.sourceType} />
  </div>

  <div class="inspector-section">
    <span class="inspector-section-title">身份与版本</span>
    <div class="inspector-row">
      <span class="inspector-key">profileVersion</span>
      <span class="inspector-value">{profile.profileVersion}</span>
    </div>
    <div class="inspector-row">
      <span class="inspector-key">schemaVersion</span>
      <span class="inspector-value">{profile.schemaVersion}</span>
    </div>
    <div class="inspector-row">
      <span class="inspector-key">region</span>
      <span class="inspector-value">{profile.region}</span>
    </div>
    <div class="inspector-row">
      <span class="inspector-key">status</span>
      <span class="inspector-value">{profile.status}</span>
    </div>
    <div class="inspector-row">
      <span class="inspector-key">sourceId</span>
      <span class="inspector-value">{profile.stateSource.sourceId}</span>
    </div>
  </div>

  <div class="inspector-section">
    <span class="inspector-section-title">运行时能力</span>
    {#each capabilityRows as row}
      <div class="inspector-row">
        <span class="inspector-key">{row.label}</span>
        <span class="inspector-value">
          {#if row.value}
            <span class="status-badge ready">已启用</span>
          {:else}
            <span class="status-badge">未启用</span>
          {/if}
        </span>
      </div>
    {/each}
  </div>

  <div class="inspector-section rules-section">
    <span class="inspector-section-title">规则摘要</span>
    <pre>{formattedRules}</pre>
  </div>
</section>

<style>
  .profile-detail-panel {
    padding: var(--space-3);
    gap: 0;
  }

  .panel-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-2);
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--line-soft);
    margin-bottom: var(--space-2);
  }

  .zone-titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  h2 {
    color: var(--text-100);
    font-size: var(--text-lg);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
    margin: 0;
  }

  .inspector-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 14px 0;
    border-bottom: 1px solid color-mix(in srgb, var(--line-soft) 82%, transparent);
  }

  .inspector-section:first-of-type {
    padding-top: 0;
  }

  .inspector-section:last-of-type {
    padding-bottom: 0;
    border-bottom: none;
  }

  .inspector-section-title {
    color: var(--text-60);
    font-size: var(--text-xs);
    font-weight: var(--fw-medium);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .inspector-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    font-size: var(--text-xs);
  }

  .inspector-key {
    color: var(--text-60);
    flex-shrink: 0;
    min-width: 84px;
  }

  .inspector-value {
    color: var(--text-80);
    font-family: var(--font-mono);
    word-break: break-all;
    text-align: right;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 1px var(--space-1);
    border-radius: var(--radius-xs);
    font-size: var(--text-xs);
    font-weight: var(--fw-medium);
    line-height: var(--lh-tight);
  }

  .status-badge::before {
    content: '';
    width: var(--space-1);
    height: var(--space-1);
    border-radius: var(--radius-pill);
    background: currentColor;
  }

  .status-badge.ready {
    color: var(--signal-ok);
    background: color-mix(in srgb, var(--signal-ok) 12%, var(--surface-raised));
  }

  .status-badge:not(.ready) {
    color: var(--text-60);
    background: color-mix(in srgb, var(--text-60) 12%, var(--surface-raised));
  }

  .rules-section pre {
    overflow-x: auto;
    border: 1px solid var(--line-soft);
    border-radius: var(--control-radius);
    background: color-mix(in srgb, var(--surface-sunken) 80%, var(--surface-panel));
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
    .panel-header {
      flex-direction: column;
    }

    .inspector-row {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-1);
    }

    .inspector-value {
      text-align: left;
    }
  }
</style>
