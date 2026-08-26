<script lang="ts">
  import InlineOperationalAlert from '$lib/components/ui/InlineOperationalAlert.svelte'
  import RawEnvelopeView from '$lib/components/ui/RawEnvelopeView.svelte'
  import { PROFILE_ICONS } from './network-profile-icons.ts'
  import type { ProfileCommandResult } from '$lib/types.ts'

  export type ProfileCommandKind = 'enable' | 'disable'

  /**
   * Zone 边界：Profile CommandWell 受控操作井（Conservative Action / Fail-Closed Gate）。
   *
   * 归属：M-UI 拥有确认门禁交互与命令结果展示。
   * 安全不变量：
   * 1. 目标网络缺失时，完全阻止执行并展示禁用原因。
   * 2. 首次点击「执行」只进入待确认态，绝不直接派发网络请求。
   * 3. 只有点击「确认执行」后才向 BFF CommandWell 端点发起真实操作。
   * 4. 点击「取消」立即重置确认态且不产生审计副作用。
   */
  let {
    selectedNetworkId = '',
    selectedNetworkName = null,
    pendingProfileCommand = null,
    commandRunning = false,
    commandError = null,
    commandResult = null,
    onRequestCommand,
    onConfirmCommand,
    onCancelCommand
  } = $props<{
    selectedNetworkId?: string
    selectedNetworkName?: string | null
    pendingProfileCommand?: ProfileCommandKind | null
    commandRunning?: boolean
    commandError?: string | null
    commandResult?: ProfileCommandResult | null
    onRequestCommand: (kind: ProfileCommandKind) => void
    onConfirmCommand: () => void
    onCancelCommand: () => void
  }>()

  const missingNetworkReason = '请先选择目标网络'
  const displayTarget = $derived(
    selectedNetworkId ? (selectedNetworkName ?? selectedNetworkId) : missingNetworkReason
  )

  const commands = [
    {
      kind: 'enable' as const,
      title: '启用 m-net-cn@0.3.0',
      permission: 'network:profile-enable'
    },
    {
      kind: 'disable' as const,
      title: '停用并恢复 m-net@0.3.0',
      permission: 'network:profile-disable'
    }
  ]
</script>

<section class="zone-panel command-zone" aria-label="Profile CommandWell">
  <div class="zone-header">
    <div class="zone-titles">
      <span class="zone-eyebrow">CommandWell</span>
      <h3>Profile 启停命令</h3>
    </div>
    <span class="status-badge ready">high risk</span>
  </div>

  {#if !selectedNetworkId}
    <p class="disabled-reason" data-testid="profile-command-disabled-reason">
      {missingNetworkReason}
    </p>
  {:else}
    <p class="command-copy">
      当前目标：<span class="mono">{selectedNetworkName ?? selectedNetworkId}</span>
    </p>
  {/if}

  <div class="command-deck">
    {#each commands as cmd}
      <article class="command-card primary" class:confirming={pendingProfileCommand === cmd.kind}>
        <div class="command-card-title">
          <span class="command-card-icon" aria-hidden="true">{@html PROFILE_ICONS.profile}</span>
          {cmd.title}
        </div>
        <div class="command-card-target">target: {displayTarget}</div>
        <div class="command-card-requirements">
          <span>requires: {cmd.permission}</span>
          <span>policy: required</span>
          <span>audit: required</span>
        </div>
        {#if pendingProfileCommand === cmd.kind}
          <div class="command-card-status attention">
            <span class="confirm-label">状态: 需要确认</span>
            <div class="confirm-actions">
              <button
                type="button"
                class="btn-execute primary"
                disabled={commandRunning}
                onclick={onConfirmCommand}
              >
                确认执行
              </button>
              <button
                type="button"
                class="btn-execute"
                disabled={commandRunning}
                onclick={onCancelCommand}
              >
                取消
              </button>
            </div>
          </div>
        {:else}
          <div class="command-card-status {selectedNetworkId ? 'ready' : 'block'}">
            状态: {selectedNetworkId ? '就绪' : '禁用'}
            {#if selectedNetworkId}
              <button
                type="button"
                class="btn-execute primary"
                onclick={() => onRequestCommand(cmd.kind)}
              >
                执行
              </button>
            {:else}
              <span class="command-reason">{missingNetworkReason}</span>
            {/if}
          </div>
        {/if}
      </article>
    {/each}
  </div>

  {#if commandError}
    <InlineOperationalAlert message={commandError} severity="block" />
  {/if}

  {#if commandResult}
    <dl class="command-result" aria-label="Profile 命令结果">
      <div>
        <dt>status</dt>
        <dd>{commandResult.status}</dd>
      </div>
      <div>
        <dt>correlationId</dt>
        <dd>{commandResult.correlationId}</dd>
      </div>
      {#if commandResult.operationId}
        <div>
          <dt>operationId</dt>
          <dd>{commandResult.operationId}</dd>
        </div>
      {/if}
      {#if commandResult.approvalId}
        <div>
          <dt>approvalId</dt>
          <dd>{commandResult.approvalId}</dd>
        </div>
      {/if}
      {#if commandResult.profileVersion}
        <div>
          <dt>profileVersion</dt>
          <dd>{commandResult.profileVersion}</dd>
        </div>
      {/if}
    </dl>
    <RawEnvelopeView title="Profile 命令原始结果" data={commandResult} />
  {/if}
</section>

<style>
  .command-zone {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
    border-color: color-mix(in srgb, var(--signal-info) 24%, var(--line-soft));
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
  }

  .status-badge.ready {
    color: var(--signal-ok);
    background: color-mix(in srgb, var(--signal-ok) 12%, var(--surface-raised));
  }

  .status-badge.ready::before {
    content: '';
    width: var(--space-1);
    height: var(--space-1);
    border-radius: var(--radius-pill);
    background: currentColor;
  }

  .command-copy,
  .disabled-reason {
    font-size: var(--text-sm);
    line-height: var(--lh-log);
  }

  .command-copy {
    color: var(--text-100);
  }

  .disabled-reason {
    color: var(--signal-warn);
    margin: 0;
  }

  .mono {
    font-family: var(--font-mono);
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
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--surface-panel) 94%, var(--surface-raised)),
      color-mix(in srgb, var(--surface-root) 96%, black)
    );
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--glass-panel-highlight) 24%, transparent);
  }

  .command-card.primary {
    border-color: color-mix(in srgb, var(--line-soft) 86%, transparent);
    background: linear-gradient(
      160deg,
      color-mix(in srgb, var(--surface-panel) 94%, var(--surface-raised)),
      var(--surface-panel)
    );
  }

  .command-card.confirming {
    border-color: color-mix(in srgb, var(--signal-attention) 82%, var(--line-soft));
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--signal-attention) 24%, transparent),
      inset 0 1px 0 color-mix(in srgb, var(--signal-attention) 28%, transparent);
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

  .command-card.confirming .command-card-status.attention {
    margin-right: -14px;
    margin-bottom: -14px;
    margin-left: -14px;
    padding: var(--space-2) 14px;
    border-top: 1px solid color-mix(in srgb, var(--signal-attention) 34%, var(--line-soft));
    border-radius: 0 0 var(--operational-card-radius) var(--operational-card-radius);
    background: linear-gradient(
      90deg,
      color-mix(in srgb, var(--signal-attention) 20%, transparent),
      color-mix(in srgb, var(--signal-attention) 7%, transparent)
    );
  }

  .command-card-status.ready {
    color: var(--signal-ok);
  }

  .command-card-status.block {
    color: var(--signal-block);
  }

  .command-card-status.attention {
    color: var(--signal-attention);
  }

  .command-reason {
    margin-left: auto;
    border: 1px solid color-mix(in srgb, var(--signal-block) 40%, var(--line-soft));
    border-radius: var(--control-radius);
    color: var(--signal-block);
    font-size: var(--text-xs);
    padding: 1px var(--space-1);
  }

  .confirm-label {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: var(--signal-warn);
    font-weight: var(--fw-medium);
    letter-spacing: 0.04em;
  }

  .confirm-actions {
    display: flex;
    gap: var(--space-2);
    margin-left: auto;
  }

  .btn-execute {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    margin-left: auto;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--line-chrome-strong);
    border-radius: var(--control-radius);
    background: var(--surface-chrome-raised);
    color: var(--text-80);
    font-size: var(--text-xs);
    font-weight: var(--fw-medium);
    cursor: pointer;
    transition:
      border-color var(--duration-fast) var(--easing-ui),
      background var(--duration-fast) var(--easing-ui),
      color var(--duration-fast) var(--easing-ui);
  }

  .btn-execute:hover:not(:disabled) {
    border-color: var(--signal-info);
    background: var(--surface-raised);
    color: var(--text-100);
  }

  .btn-execute:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-execute.primary {
    border-color: var(--signal-ok);
    background: var(--signal-ok);
    color: var(--surface-root);
  }

  .btn-execute.primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--signal-ok) 90%, white);
  }

  .command-result {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: var(--space-2);
    width: 100%;
    margin: 0;
  }

  .command-result > div {
    border: 1px solid color-mix(in srgb, var(--signal-info) 28%, var(--line-soft));
    border-radius: var(--control-radius);
    background: color-mix(in srgb, var(--surface-raised) 60%, var(--surface-root));
    padding: var(--space-2) var(--space-3);
  }

  .command-result dt {
    color: var(--text-60);
    font-size: var(--text-xs);
    letter-spacing: 0.06em;
    margin: 0;
    text-transform: uppercase;
  }

  .command-result dd {
    color: var(--text-100);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: var(--lh-tight);
    margin: var(--space-1) 0 0;
    word-break: break-all;
  }

  @media (max-width: 760px) {
    .command-card-status {
      flex-direction: column;
      align-items: flex-start;
    }

    .command-reason,
    .btn-execute {
      margin-left: 0;
    }

    .confirm-actions {
      margin-left: 0;
      width: 100%;
    }

    .command-result {
      grid-template-columns: 1fr;
    }
  }
</style>
