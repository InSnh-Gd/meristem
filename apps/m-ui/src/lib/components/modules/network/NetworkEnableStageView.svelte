<script lang="ts">
  /**
   * 阶段 3「启用 Profile」子视图。
   *
   * 所有权边界：本组件只渲染 M-UI BFF 已派生的 Profile 启用展示态与命令资格展示态，
   * 不做任何最终授权判断。最终授权与策略决策由 M-Policy 拥有，事实由 M-Net 拥有；
   * 这里出现的「可执行 / 已禁用」只是展示层资格提示。
   *
   * 数据全部通过显式 typed props 由路由传入，组件内不订阅任何全局 store。
   */
  import InlineOperationalAlert from '$lib/components/ui/InlineOperationalAlert.svelte'
  import StateSourceBadge from '$lib/components/ui/StateSourceBadge.svelte'
  import type { NetworkRuntimeStateData, NetworkRuntimeTruth } from '$lib/types.ts'

  type ProfileState = NetworkRuntimeTruth['profile']
  type CommandEligibility = NetworkRuntimeStateData['policyEligibility']['commands'][number]

  type Props = {
    /** BFF runtimeTruth 中的 Profile 启用展示态；为 null 时不渲染启用网格。 */
    profileState: ProfileState | null
    /** 启用命令的策略资格展示态；为 null 时隐藏资格行。 */
    enableCommand: CommandEligibility | null
    /** 运行态聚合是否仍在首次加载中。 */
    loading: boolean
    /** 运行态聚合的降级错误文案；非空时优先展示阻断提示与重试入口。 */
    errorMessage: string | null
    /** 重试回调，由路由持有真实的数据刷新编排。 */
    onRetry: () => void
  }

  let { profileState, enableCommand, loading, errorMessage, onRetry }: Props = $props()

  function profileStateLabel(state: string): string {
    if (state === 'enabled') return '已启用'
    if (state === 'disabled') return '已禁用'
    if (state === 'degraded') return '已降级'
    return state
  }

  function profileStateTone(state: string): string {
    if (state === 'enabled') return 'var(--signal-ok)'
    if (state === 'disabled') return 'var(--signal-block)'
    return 'var(--signal-warn)'
  }
</script>

{#if loading && !profileState}
  <p class="loading-line">正在加载运行态...</p>
{:else if errorMessage}
  <InlineOperationalAlert severity="block" message={errorMessage} />
  <button class="refresh-btn" onclick={onRetry}>重试</button>
{:else if profileState}
  <div class="enable-grid" data-testid="enable-grid">
    <div class="enable-row">
      <span class="enable-key">Profile 启用状态</span>
      <span
        class="enable-value"
        style:--tone={profileStateTone(profileState.state)}
        data-testid="profile-enable-state"
      >
        {profileStateLabel(profileState.state)}
      </span>
      {#if profileState.reason}
        <span class="enable-reason" data-testid="profile-enable-reason">{profileState.reason}</span>
      {/if}
      <StateSourceBadge source={profileState.stateSource.sourceType} />
    </div>
    {#if enableCommand}
      <div class="enable-row" data-testid="profile-enable-eligibility">
        <span class="enable-key">启用命令资格</span>
        <span
          class="enable-value"
          style:--tone={enableCommand.state === 'enabled' ? 'var(--signal-ok)' : 'var(--signal-block)'}
        >
          {enableCommand.state === 'enabled' ? '可执行' : '已禁用'}
        </span>
        {#if enableCommand.state === 'disabled' && enableCommand.disabledReason}
          <span class="enable-reason" data-testid="profile-enable-disabled-reason">
            {enableCommand.disabledReason.message}
          </span>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .loading-line {
    color: var(--text-60);
    font-size: var(--text-sm);
  }

  .enable-grid {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .enable-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--line-soft);
    border-radius: var(--operational-card-radius);
    background: color-mix(in srgb, var(--surface-root) 60%, var(--surface-panel));
  }

  .enable-key {
    color: var(--text-60);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .enable-value {
    color: var(--tone, var(--text-100));
    font-weight: var(--fw-semibold);
    font-size: var(--text-sm);
  }

  .enable-reason {
    color: var(--signal-block);
    font-size: var(--text-xs);
    border: 1px solid color-mix(in srgb, var(--signal-block) 40%, var(--line-soft));
    border-radius: var(--control-radius);
    padding: 1px var(--space-2);
  }

  .refresh-btn {
    margin-top: var(--space-2);
    padding: var(--space-1) var(--space-3);
    background: var(--surface-root);
    border: 1px solid var(--line-strong);
    border-radius: var(--control-radius);
    color: var(--text-100);
    cursor: pointer;
    font-size: var(--text-xs);
  }
</style>
