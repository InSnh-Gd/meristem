<script lang="ts">
  import type { NetworkProfileListResponseData } from '$lib/types.ts'
  import StateSourceBadge from '$lib/components/ui/StateSourceBadge.svelte'

  const PROFILE_ICON =
    '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5z" fill="currentColor" fill-opacity="0.12"/><path d="M4 13a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2z" fill="currentColor" fill-opacity="0.12"/><path d="M8 8h8"/><path d="M8 16h8"/></svg>'

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
  <div class="profile-list" role="list" aria-label="网络 Profile gated preview">
    {#each [
      {
        title: 'CN profile',
        value: 'm-net-cn@0.3.0',
        chips: ['region: cn', 'status: gated', 'netbird-sidecar'],
        footer: '需要操作令牌加载权威 Profile 列表'
      },
      {
        title: 'Default profile',
        value: 'm-net@0.3.0',
        chips: ['region: default', 'status: gated'],
        footer: '通过 M-UI BFF 读取 Core public facade'
      },
      {
        title: 'Migration readiness',
        value: 'pending auth',
        chips: ['switch: gated', 'audit: required'],
        footer: '启停与迁移命令必须进入确认流'
      }
    ] as preview}
      <article class="profile-card preview-card">
        <div class="profile-card-glow-icon" aria-hidden="true">{@html PROFILE_ICON}</div>
        <div class="profile-card-main">
          <div class="profile-card-title">{preview.title}</div>
          <div class="profile-card-value">{preview.value}</div>
          <div class="profile-card-chips">
            {#each preview.chips as chip}
              <span class="meta-chip" class:state-attention={chip.includes('required')}>{chip}</span>
            {/each}
          </div>
        </div>
        <div class="profile-card-footer">
          <span class="profile-card-footer-left">{preview.footer}</span>
        </div>
      </article>
    {/each}
  </div>
{:else}
  <div class="profile-list" role="list" aria-label="网络 Profile 列表">
    {#each profiles as profile}
      <a
        class:selected={selectedProfileVersion === profile.profileVersion}
        class="profile-card"
        href={`${detailBasePath}/${encodeURIComponent(profile.profileVersion)}`}
      >
        <div class="profile-card-glow-icon" aria-hidden="true">{@html PROFILE_ICON}</div>
        <div class="profile-card-main">
          <div class="profile-card-title">{profile.displayName}</div>
          <div class="profile-card-value">{profile.profileVersion}</div>
          <div class="profile-card-chips">
            <span class="meta-chip">region: {profile.region}</span>
            <span class="meta-chip">schema: {profile.schemaVersion}</span>
            <span class="meta-chip">status: {profile.status}</span>
            {#if profile.capabilities.controlPlaneOnly}
              <span class="meta-chip state-attention">control-plane-only</span>
            {/if}
          </div>
        </div>
        <div class="profile-card-footer">
          <span class="profile-card-footer-left">sourceId: {profile.stateSource.sourceId}</span>
          <StateSourceBadge source={profile.stateSource.sourceType} />
        </div>
      </a>
    {/each}
  </div>
{/if}

<style>
  .profile-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 10px;
  }

  .profile-card {
    --card-accent: var(--accent-blue);

    position: relative;
    display: grid;
    grid-template-columns: 48px minmax(0, 1fr);
    grid-template-rows: 1fr auto;
    gap: 0 10px;
    min-width: 0;
    padding: 14px 16px 12px;
    border: 1px solid color-mix(in srgb, var(--line-soft) 72%, transparent);
    border-radius: var(--operational-card-radius);
    background:
      linear-gradient(
        160deg,
        color-mix(in srgb, var(--surface-raised) 68%, var(--surface-panel)),
        color-mix(in srgb, var(--surface-panel) 92%, black)
      );
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--glass-panel-highlight) 18%, transparent),
      0 10px 24px color-mix(in srgb, black 34%, transparent);
    color: var(--text-100);
    text-decoration: none;
    transition:
      border-color var(--duration-fast) var(--easing-ui),
      box-shadow var(--duration-fast) var(--easing-ui),
      transform var(--duration-fast) var(--easing-ui);
  }

  .profile-card:hover,
  .profile-card:focus-visible,
  .profile-card.selected {
    border-color: color-mix(in srgb, var(--card-accent) 50%, var(--line-soft));
    outline: 1px solid color-mix(in srgb, var(--card-accent) 50%, var(--line-soft));
    outline-offset: 0;
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--card-accent) 24%, transparent),
      0 0 18px color-mix(in srgb, var(--card-accent) 30%, transparent);
    transform: translateY(-1px);
  }

  .profile-card.preview-card {
    border-style: dashed;
    color: var(--text-80);
  }

  .profile-card.preview-card:hover,
  .profile-card.preview-card:focus-visible {
    border-color: color-mix(in srgb, var(--line-soft) 72%, transparent);
    outline: none;
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--glass-panel-highlight) 18%, transparent),
      0 10px 24px color-mix(in srgb, black 34%, transparent);
    transform: none;
  }

  .profile-card-glow-icon {
    grid-row: 1;
    grid-column: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border: 1px solid color-mix(in srgb, var(--card-accent) 32%, transparent);
    border-radius: var(--radius-pill);
    background: radial-gradient(circle at 45% 42%, color-mix(in srgb, var(--card-accent) 18%, transparent), color-mix(in srgb, var(--card-accent) 8%, var(--surface-raised)) 72%);
    color: var(--card-accent);
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--card-accent) 24%, transparent),
      0 0 18px color-mix(in srgb, var(--card-accent) 30%, transparent);
  }

  .profile-card-main {
    grid-row: 1;
    grid-column: 2;
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }

  .profile-card-title {
    color: var(--text-100);
    font-size: var(--text-lg);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
  }

  .profile-card-value {
    color: var(--card-accent);
    font-size: var(--text-sm);
    font-family: var(--font-mono);
    line-height: var(--lh-tight);
    word-break: break-word;
  }

  .profile-card-chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-width: 0;
    max-width: 100%;
  }

  .profile-card-footer {
    grid-row: 2;
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    margin-top: 12px;
    padding-top: 9px;
    border-top: 1px solid color-mix(in srgb, var(--line-soft) 82%, transparent);
    color: var(--text-50);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    line-height: var(--lh-tight);
  }

  .profile-card-footer-left {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta-chip.state-attention {
    color: var(--signal-attention);
    background: color-mix(in srgb, var(--signal-attention) 20%, var(--surface-chrome-raised));
    border-color: color-mix(in srgb, var(--signal-attention) 28%, transparent);
  }

  @media (max-width: 760px) {
    .profile-list {
      grid-template-columns: 1fr;
    }

    .profile-card {
      grid-template-columns: 40px minmax(0, 1fr);
    }

    .profile-card-glow-icon {
      width: 36px;
      height: 36px;
    }

    .profile-card-footer {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
