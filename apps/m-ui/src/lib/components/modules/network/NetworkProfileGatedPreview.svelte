<script lang="ts">
  import { PROFILE_ICONS } from './network-profile-icons.ts'

  /**
   * Zone 边界：未授权/未加载状态下的 Profile 预览（Orientation / Gated Preview）。
   *
   * 归属：M-UI 拥有此处的未授权占位与访问边界说明。
   * 不直接请求后端，不暴露任何可执行命令入口，明确提示需要操作者令牌。
   */
  let {
    profileVersion
  } = $props<{
    profileVersion: string
  }>()
</script>

<div class="profile-layout gated-profile-layout">
  <div class="workspace-zones">
    <section
      class="zone-panel empty-panel gated-profile-panel"
      aria-label="Profile gated preview"
    >
      <div class="zone-header">
        <div class="zone-titles">
          <span class="zone-eyebrow">Network profile</span>
          <h3>Profile 需要授权加载</h3>
        </div>
        <span class="status-badge">gated</span>
      </div>
      <div class="summary-card-grid compact-preview-grid">
        <article class="summary-card core-health">
          <div class="summary-card-glow-icon" aria-hidden="true">
            {@html PROFILE_ICONS.profile}
          </div>
          <div class="summary-card-main">
            <div class="summary-card-title">目标 Profile</div>
            <div class="summary-card-value">{profileVersion}</div>
            <div class="summary-card-chips">
              <span class="meta-chip">stateSource: gated</span>
            </div>
          </div>
          <div class="summary-card-footer">
            <span class="summary-card-footer-left">需要 Bearer JWT</span>
          </div>
        </article>
        <article class="summary-card event-bus">
          <div class="summary-card-glow-icon" aria-hidden="true">
            {@html PROFILE_ICONS.network}
          </div>
          <div class="summary-card-main">
            <div class="summary-card-title">目标网络</div>
            <div class="summary-card-value">pending auth</div>
            <div class="summary-card-chips">
              <span class="meta-chip">network list gated</span>
            </div>
          </div>
          <div class="summary-card-footer">
            <span class="summary-card-footer-left">Profile 命令必须显式选择网络</span>
          </div>
        </article>
        <article class="summary-card audit-visibility">
          <div class="summary-card-glow-icon" aria-hidden="true">
            {@html PROFILE_ICONS.command}
          </div>
          <div class="summary-card-main">
            <div class="summary-card-title">命令预览</div>
            <div class="summary-card-value">read-only</div>
            <div class="summary-card-chips">
              <span class="meta-chip">confirm required</span>
            </div>
          </div>
          <div class="summary-card-footer">
            <span class="summary-card-footer-left">不会在无授权状态执行切换</span>
          </div>
        </article>
      </div>
    </section>
  </div>
  <aside class="raw-panel zone-panel" aria-label="Profile gated context">
    <div class="zone-header">
      <div class="zone-titles">
        <span class="zone-eyebrow">Selected context</span>
        <h3>未加载 Profile</h3>
      </div>
    </div>
    <div class="inspector-section">
      <span class="inspector-section-title">访问边界</span>
      <div class="inspector-row">
        <span class="inspector-key">profileVersion</span>
        <span class="inspector-value">{profileVersion}</span>
      </div>
      <div class="inspector-row">
        <span class="inspector-key">required</span>
        <span class="inspector-value">Bearer JWT</span>
      </div>
    </div>
  </aside>
</div>

<style>
  .profile-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--inspector-width);
    gap: var(--panel-gap);
    align-items: start;
  }

  .workspace-zones {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
    min-width: 0;
  }

  .zone-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .zone-titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  h3 {
    color: var(--text-100);
    font-size: var(--text-lg);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
    margin: 0;
  }

  .zone-eyebrow {
    color: var(--text-60);
    font-size: var(--text-xs);
    font-weight: var(--fw-medium);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin: 0;
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
    color: var(--text-60);
    background: color-mix(in srgb, var(--text-60) 12%, var(--surface-raised));
  }

  .status-badge::before {
    content: '';
    width: var(--space-1);
    height: var(--space-1);
    border-radius: var(--radius-pill);
    background: currentColor;
  }

  .raw-panel,
  .empty-panel {
    min-width: 0;
  }

  .gated-profile-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
  }

  .compact-preview-grid {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }

  .inspector-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-3);
    border-top: 1px solid var(--line-soft);
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
    justify-content: space-between;
    gap: var(--space-3);
    font-size: var(--text-xs);
  }

  .inspector-key {
    color: var(--text-60);
  }

  .inspector-value {
    color: var(--text-80);
    font-family: var(--font-mono);
  }

  .raw-panel {
    position: sticky;
    top: var(--space-4);
    align-self: start;
    max-height: calc(100vh - var(--app-bar-height) - var(--space-6));
    overflow-y: auto;
    padding: var(--space-3);
  }

  @media (max-width: 1200px) {
    .profile-layout {
      grid-template-columns: 1fr;
    }

    .raw-panel {
      position: static;
      max-height: none;
    }
  }
</style>
