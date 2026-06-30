<script lang="ts">
  import { onMount } from 'svelte'
  import { fetchGlobalDefaults, fetchMigrationStatus, formatBffError } from '$lib/bff.ts'
  import { appState as muiStores } from '$lib/stores.svelte.ts'
  import type { GlobalDefaultsResponseData, MigrationStatusResponseData } from '$lib/types.ts'
  import InlineOperationalAlert from '$lib/components/ui/InlineOperationalAlert.svelte'
  import StateSourceBadge from '$lib/components/ui/StateSourceBadge.svelte'

  const controlPlaneOnlyWarning = '配置变更仅影响控制平面，运行时数据面不受影响'

  const GLOBAL_ICONS: Record<string, string> = {
    default:
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5l8.5 4v6.5c0 5.5-3.5 8.5-8.5 10.5-5-2-8.5-5-8.5-10.5V6.5l8.5-4z" fill="currentColor" fill-opacity="0.18"/><circle cx="12" cy="11" r="2.5" fill="currentColor" stroke="none"/></svg>',
    migration:
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v20" fill="currentColor" fill-opacity="0.1"/><path d="M17 7l-5-5-5 5"/><path d="M17 17l-5 5-5-5"/></svg>',
    breakglass:
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.3 3.5 20.5l17.2-6.8" fill="currentColor" fill-opacity="0.12"/><path d="m12 12 5.5 5.5"/><path d="M12 12V7"/></svg>'
  }

  let { profileVersion } = $props<{ profileVersion: string }>()

  let defaults = $state<GlobalDefaultsResponseData | null>(null)
  let migrationStatus = $state<MigrationStatusResponseData | null>(null)
  let loading = $state(false)
  let error = $state<string | null>(null)
  let statusError = $state<string | null>(null)

  const switchOperationId = $derived(defaults?.switchOperationId ?? null)

  onMount(() => {
    void refreshGlobalControls()
  })

  /** 全局控制状态只通过 M-UI BFF 读取，页面不直接命中 Core public facade 或功能域服务。 */
  async function refreshGlobalControls() {
    if (!muiStores.token) return
    loading = true
    error = null
    statusError = null
    try {
      defaults = await fetchGlobalDefaults(muiStores.token)
      if (defaults.switchOperationId) {
        try {
          migrationStatus = await fetchMigrationStatus(muiStores.token, defaults.switchOperationId)
        } catch (e: unknown) {
          migrationStatus = null
          statusError = formatBffError(e, '迁移状态加载失败')
        }
      } else {
        migrationStatus = null
      }
    } catch (e: unknown) {
      defaults = null
      migrationStatus = null
      error = formatBffError(e, '全局 Profile 控制状态加载失败')
    } finally {
      loading = false
    }
  }
</script>

<section class="global-controls-panel zone-panel" aria-labelledby="global-profile-controls-title">
  <div class="zone-header">
    <div class="zone-titles">
      <p class="zone-eyebrow">Global control</p>
      <h3 id="global-profile-controls-title">Profile 全局默认与迁移控制</h3>
    </div>
    <span class="meta-chip">authoritative</span>
  </div>

  <InlineOperationalAlert message={controlPlaneOnlyWarning} severity="warn" />

  {#if error}
    <InlineOperationalAlert message={error} severity="block" />
  {:else if loading}
    <p class="workbench-empty">正在加载全局控制状态。</p>
  {/if}

  <div class="summary-card-grid">
    <article class="summary-card core-health">
      <div class="summary-card-glow-icon" aria-hidden="true">{@html GLOBAL_ICONS.default}</div>
      <div class="summary-card-main">
        <div class="summary-card-title">当前全局默认</div>
        <div class="summary-card-value">{defaults?.defaultProfileVersion ?? 'unknown'}</div>
        <div class="summary-card-chips">
          <span class="meta-chip">defaultProfileVersion</span>
        </div>
      </div>
      <div class="summary-card-footer">
        <span class="summary-card-footer-left">stateSource: authoritative</span>
      </div>
    </article>

    <article class="summary-card event-bus">
      <div class="summary-card-glow-icon" aria-hidden="true">{@html GLOBAL_ICONS.migration}</div>
      <div class="summary-card-main">
        <div class="summary-card-title">迁移状态</div>
        <div class="summary-card-value">
          {migrationStatus?.globalSwitchState ?? defaults?.globalSwitchState ?? 'unknown'}
        </div>
        <div class="summary-card-chips">
          <span class="meta-chip">globalSwitchState</span>
        </div>
      </div>
      <div class="summary-card-footer">
        <span class="summary-card-footer-left">operationId: {switchOperationId ?? 'none'}</span>
      </div>
    </article>

    <article class="summary-card audit-visibility">
      <div class="summary-card-glow-icon" aria-hidden="true">{@html GLOBAL_ICONS.default}</div>
      <div class="summary-card-main">
        <div class="summary-card-title">目标 Profile</div>
        <div class="summary-card-value">{profileVersion}</div>
        <div class="summary-card-chips">
          <span class="meta-chip">profileVersion</span>
        </div>
      </div>
      <div class="summary-card-footer">
        <span class="summary-card-footer-left">控制面限定</span>
      </div>
    </article>
  </div>

  {#if statusError}
    <InlineOperationalAlert message={statusError} severity="risk" />
  {/if}

  <div class="command-deck">
    <article class="command-card disabled">
      <div class="command-card-title">
        <span class="command-card-icon" aria-hidden="true">{@html GLOBAL_ICONS.default}</span>
        设置 {profileVersion} 为全局默认
      </div>
      <div class="command-card-target">target: global-default</div>
      <div class="command-card-requirements">
        <span>requires: network:profile-admin</span>
        <span>policy: required</span>
        <span>audit: required</span>
      </div>
      <div class="command-card-status block">
        状态: 禁用
        <span class="command-reason">演示界面只展示控制命令，未启用前端执行。</span>
      </div>
    </article>

    <article class="command-card disabled">
      <div class="command-card-title">
        <span class="command-card-icon" aria-hidden="true">{@html GLOBAL_ICONS.migration}</span>
        规划 / 应用迁移
      </div>
      <div class="command-card-target">target: {profileVersion}</div>
      <div class="command-card-requirements">
        <span>requires: network:migration-execute</span>
        <span>policy: required</span>
        <span>audit: required</span>
      </div>
      <div class="command-card-status block">
        状态: 禁用
        <span class="command-reason">演示中不触发全局切换，避免暗示运行时数据面已接入。</span>
      </div>
    </article>

    <article class="command-card disabled">
      <div class="command-card-title">
        <span class="command-card-icon" aria-hidden="true">{@html GLOBAL_ICONS.breakglass}</span>
        security-admin break-glass disable（演示中禁用）
      </div>
      <div class="command-card-target">target: global-profile</div>
      <div class="command-card-requirements">
        <span>requires: security-admin</span>
        <span>policy: required</span>
        <span>audit: required</span>
      </div>
      <div class="command-card-status block">
        状态: 禁用
        <span class="command-reason">仅作为受控恢复入口展示；实际授权、策略降级检测和审计由 Core public facade 与功能域服务承担。</span>
      </div>
    </article>
  </div>
</section>

<style>
  .global-controls-panel {
    padding: var(--space-3);
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

  .meta-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    min-width: 0;
    padding: 3px 7px;
    border: 1px solid color-mix(in srgb, var(--line-soft) 38%, transparent);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--surface-chrome-raised) 74%, black);
    color: var(--text-90);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    line-height: var(--lh-tight);
    white-space: nowrap;
  }

  .summary-card-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }

  .summary-card {
    --card-accent: var(--text-80);

    position: relative;
    display: grid;
    grid-template-columns: 54px minmax(0, 1fr);
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
  }

  .summary-card.core-health { --card-accent: var(--signal-ok); }
  .summary-card.event-bus { --card-accent: var(--accent-purple); }
  .summary-card.audit-visibility { --card-accent: var(--signal-info); }

  .summary-card-glow-icon {
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

  .summary-card-main {
    grid-row: 1;
    grid-column: 2;
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }

  .summary-card-title {
    color: var(--text-100);
    font-size: var(--text-base);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
  }

  .summary-card-value {
    color: var(--card-accent);
    font-size: var(--text-sm);
    font-family: var(--font-mono);
    line-height: var(--lh-tight);
    word-break: break-word;
  }

  .summary-card-chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-width: 0;
    max-width: 100%;
  }

  .summary-card-footer {
    grid-row: 2;
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
    row-gap: var(--space-1);
    margin-top: 12px;
    padding-top: 9px;
    border-top: 1px solid color-mix(in srgb, var(--line-soft) 82%, transparent);
    color: var(--text-50);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    line-height: var(--lh-tight);
  }

  .summary-card-footer-left {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .command-deck {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
  }

  .command-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    padding: 14px;
    border: 1px solid color-mix(in srgb, var(--line-soft) 86%, transparent);
    border-radius: var(--operational-card-radius);
    background: linear-gradient(180deg, color-mix(in srgb, var(--surface-panel) 94%, var(--surface-raised)), color-mix(in srgb, var(--surface-root) 96%, black));
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--glass-panel-highlight) 24%, transparent);
  }

  .command-card.disabled {
    opacity: 0.72;
  }

  .command-card-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-100);
    font-size: var(--text-base);
    font-weight: var(--fw-semibold);
  }

  .command-card-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-xs);
    background: var(--surface-chrome-raised);
    color: var(--text-80);
  }

  .command-card-target {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--text-60);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
  }

  .command-card-requirements {
    display: flex;
    flex-direction: column;
    gap: 2px;
    color: var(--text-60);
    font-size: var(--text-xs);
  }

  .command-card-status {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-top: auto;
    padding-top: var(--space-2);
    border-top: 1px solid var(--line-soft);
    color: var(--text-60);
    font-size: var(--text-xs);
  }

  .command-card-status.block {
    color: var(--signal-block);
  }

  .command-reason {
    margin-left: auto;
    border: 1px solid color-mix(in srgb, var(--signal-block) 40%, var(--line-soft));
    border-radius: var(--control-radius);
    color: var(--signal-block);
    font-size: var(--text-xs);
    padding: 1px var(--space-1);
  }

  @media (max-width: 1200px) {
    .summary-card-grid {
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    }
  }

  @media (max-width: 760px) {
    .zone-header {
      flex-direction: column;
    }

    .summary-card-grid {
      grid-template-columns: 1fr;
    }

    .command-card-status {
      flex-direction: column;
      align-items: flex-start;
    }

    .command-reason {
      margin-left: 0;
      margin-top: var(--space-1);
    }
  }
</style>
