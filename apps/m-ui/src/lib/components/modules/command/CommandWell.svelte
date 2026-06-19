<script lang="ts">
  import type { CommandState, OverviewData } from '$lib/types.ts'
  import InlineOperationalAlert from '$lib/components/ui/InlineOperationalAlert.svelte'

  type Props = {
    emptyStateText?: string
    targetLabel?: string
    targetName?: string
    commandState: CommandState | null
    commandStateError?: string | null
    selectedNode: OverviewData['nodes'][number] | null
    confirming: boolean
    onRequestConfirm: () => void
    onCancel: () => void
    onConfirm: () => void
  }

  let { commandState, commandStateError, selectedNode, confirming, emptyStateText = '请选择目标以执行命令', targetLabel = '目标', targetName, onRequestConfirm, onCancel, onConfirm }: Props = $props()
</script>

<div class="command-well">
  {#if commandStateError}
    <InlineOperationalAlert message={commandStateError} severity="block" />
  {:else if !commandState}
    <div class="command-empty">{emptyStateText}</div>
  {:else if commandState.state === 'disabled'}
    <div class="command-disabled">
      <span class="command-label">{commandState.command?.label ?? '命令'}</span>
      <span class="command-reason" data-testid="command-disabled-reason">{commandState.disabledReason}</span>
    </div>
  {:else if confirming}
    <div class="command-confirm">
      <div class="confirm-info">
        <span class="confirm-label">确认执行</span>
        <div class="confirm-details">
          <div>{targetLabel}: {targetName ?? selectedNode?.name ?? '未知'}</div>
          <div>类型: {commandState?.command?.action ?? 'unknown'}</div>
          <div>权限: {commandState?.command?.requiredPermissions?.join(', ') ?? 'unknown'}</div>
          <div>策略: 需要</div>
          <div>审计: 需要</div>
        </div>
      </div>
      <div class="confirm-actions">
        <button class="btn-confirm" data-testid="command-confirm-btn" onclick={onConfirm}>确认执行</button>
        <button class="btn-cancel" data-testid="command-cancel-btn" onclick={onCancel}>取消</button>
      </div>
    </div>
  {:else}
    <button class="btn-command" data-testid="command-btn" onclick={onRequestConfirm}>{commandState?.command?.label ?? '执行命令'}</button>
  {/if}
</div>

<style>
  .command-well { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
  .command-empty { color: var(--text-40); font-size: var(--text-sm); }
  .command-disabled { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
  .command-label { font-size: var(--text-sm); color: var(--text-40); }
  .command-reason { font-size: var(--text-xs); color: var(--signal-warn); }
  .command-confirm { display: flex; align-items: center; gap: var(--space-4); width: 100%; }
  .confirm-label { font-weight: var(--fw-medium); color: var(--signal-warn); font-size: var(--text-sm); }
  .confirm-details { font-size: var(--text-xs); color: var(--text-60); display: flex; gap: var(--space-3); flex-wrap: wrap; }
  .confirm-actions { display: flex; gap: var(--space-2); margin-left: auto; }
  .btn-confirm { background: var(--signal-ok); color: var(--surface-root); border: none; padding: var(--space-1) var(--space-3); border-radius: 4px; font-size: var(--text-sm); font-weight: var(--fw-medium); cursor: pointer; }
  .btn-cancel { background: var(--surface-raised); color: var(--text-80); border: 1px solid var(--line-soft); padding: var(--space-1) var(--space-3); border-radius: 4px; font-size: var(--text-sm); cursor: pointer; }
  .btn-command { background: var(--signal-info); color: var(--surface-root); border: none; padding: var(--space-2) var(--space-4); border-radius: 4px; font-size: var(--text-sm); font-weight: var(--fw-medium); cursor: pointer; }
  .btn-command:hover { opacity: 0.9; }

  @media (max-width: 760px) {
    .command-confirm {
      align-items: stretch;
      flex-direction: column;
      gap: var(--space-2);
    }
    .confirm-actions {
      margin-left: 0;
    }
  }
</style>
