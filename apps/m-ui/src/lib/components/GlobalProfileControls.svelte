<script lang="ts">
  import { onMount } from 'svelte'
  import { fetchGlobalDefaults, fetchMigrationStatus, formatBffError } from '$lib/bff.ts'
  import { appState as muiStores } from '$lib/stores.svelte.ts'
  import type { GlobalDefaultsResponseData, MigrationStatusResponseData } from '$lib/types.ts'
  import InlineOperationalAlert from './InlineOperationalAlert.svelte'

  const controlPlaneOnlyWarning = '配置变更仅影响控制平面，运行时数据面不受影响'

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

  /** 全局控制状态只通过 M-UI BFF 读取，页面不直接命中 Core 或 M-Net。 */
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

<section class="global-controls-panel" aria-labelledby="global-profile-controls-title">
  <div class="command-header-block">
    <div>
      <p class="eyebrow">全局控制</p>
      <h3 id="global-profile-controls-title">Profile 全局默认与迁移控制</h3>
    </div>
    <span class="source-chip">source: authoritative</span>
  </div>

  <InlineOperationalAlert message={controlPlaneOnlyWarning} severity="warn" />

  {#if error}
    <InlineOperationalAlert message={error} severity="block" />
  {:else if loading}
    <p class="command-copy">正在加载全局控制状态。</p>
  {/if}

  <dl class="global-control-meta" aria-label="全局 Profile 状态">
    <div>
      <dt>当前全局默认</dt>
      <dd>{defaults?.defaultProfileVersion ?? 'unknown'}</dd>
    </div>
    <div>
      <dt>迁移状态</dt>
      <dd>{migrationStatus?.globalSwitchState ?? defaults?.globalSwitchState ?? 'unknown'}</dd>
    </div>
    <div>
      <dt>迁移 operationId</dt>
      <dd>{switchOperationId ?? 'none'}</dd>
    </div>
    <div>
      <dt>目标 Profile</dt>
      <dd>{profileVersion}</dd>
    </div>
  </dl>

  {#if statusError}
    <InlineOperationalAlert message={statusError} severity="risk" />
  {/if}

  <section class="disabled-command-group" aria-labelledby="global-default-command-title">
    <div>
      <p class="eyebrow">CommandWell</p>
      <h4 id="global-default-command-title">全局默认设置</h4>
    </div>
    <p class="control-plane-warning">{controlPlaneOnlyWarning}</p>
    <button type="button" class="btn-command" disabled>
      设置 {profileVersion} 为全局默认（演示中禁用）
    </button>
    <p class="disabled-reason">演示界面只展示控制命令，未启用前端执行。</p>
  </section>

  <section class="disabled-command-group" aria-labelledby="global-switch-command-title">
    <div>
      <p class="eyebrow">CommandWell</p>
      <h4 id="global-switch-command-title">批量迁移计划 / 应用</h4>
    </div>
    <p class="control-plane-warning">{controlPlaneOnlyWarning}</p>
    <div class="global-command-actions">
      <button type="button" class="btn-command" disabled>
        规划迁移到 {profileVersion}
      </button>
      <button type="button" class="btn-command" disabled>
        应用迁移 {switchOperationId ?? 'none'}
      </button>
    </div>
    <p class="disabled-reason">演示中不触发全局切换，避免暗示运行时数据面已接入。</p>
  </section>

  <section class="disabled-command-group" aria-labelledby="break-glass-command-title">
    <div>
      <p class="eyebrow">security-admin</p>
      <h4 id="break-glass-command-title">Break-glass 禁用</h4>
    </div>
    <p class="control-plane-warning">{controlPlaneOnlyWarning}</p>
    <button type="button" class="btn-command btn-risk" disabled>
      security-admin break-glass disable（演示中禁用）
    </button>
    <p class="disabled-reason">仅作为受控恢复入口展示；实际授权、策略降级检测和审计由 Core/M-Net 处理。</p>
  </section>
</section>

<style>
  .global-controls-panel,
  .disabled-command-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    border: 1px solid var(--line-soft);
    background: var(--surface-root);
    padding: var(--space-4);
  }

  .disabled-command-group {
    background: var(--surface-sunken);
  }

  .command-header-block {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .global-control-meta,
  .global-command-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .global-control-meta {
    margin: 0;
  }

  .global-control-meta div {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  h3,
  h4,
  .command-copy,
  .control-plane-warning,
  .global-control-meta dd {
    color: var(--text-100);
  }

  h3,
  h4 {
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
    margin: 0;
  }

  h3 {
    font-size: var(--text-lg);
  }

  h4,
  .command-copy,
  .control-plane-warning {
    font-size: var(--text-sm);
  }

  .eyebrow,
  .source-chip,
  .disabled-reason,
  .global-control-meta dt,
  .global-control-meta dd {
    font-size: var(--text-xs);
  }

  .eyebrow,
  .global-control-meta dt {
    color: var(--text-60);
  }

  .source-chip {
    border: 1px solid var(--line-strong);
    color: var(--text-80);
    padding: 0 var(--space-2);
    white-space: nowrap;
  }

  .control-plane-warning {
    border-left: 1px solid var(--signal-warn);
    line-height: var(--lh-log);
    padding-left: var(--space-3);
  }

  .global-control-meta dd {
    font-family: var(--font-mono);
    line-height: var(--lh-log);
    margin: 0;
    word-break: break-word;
  }

  .disabled-reason {
    color: var(--signal-warn);
    line-height: var(--lh-log);
  }

  .btn-command {
    border: 1px solid var(--line-soft);
    border-radius: var(--space-1);
    background: var(--surface-raised);
    color: var(--text-40);
    cursor: not-allowed;
    font-size: var(--text-sm);
    padding: var(--space-2) var(--space-3);
  }

  .btn-risk {
    border-color: var(--signal-risk);
  }

  @media (max-width: 760px) {
    .command-header-block {
      flex-direction: column;
    }

    .global-control-meta,
    .global-command-actions {
      grid-template-columns: 1fr;
    }
  }
</style>
