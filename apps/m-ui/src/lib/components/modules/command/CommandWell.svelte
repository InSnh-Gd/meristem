<script lang="ts">
  import type { CommandState, OverviewData } from '$lib/types.ts'
  import InlineOperationalAlert from '$lib/components/ui/InlineOperationalAlert.svelte'
  import { slide, fade } from 'svelte/transition'

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

  // ponytail: advanced motion pilot using native Svelte transitions over a motion library.
  // Reads canonical --duration-normal token from app.css at runtime; falls back safely.
  let prefersReducedMotion = $state(false)
  let motionDuration = $state(250)

  $effect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    prefersReducedMotion = mediaQuery.matches
    const listener = (e: MediaQueryListEvent) => { prefersReducedMotion = e.matches }
    mediaQuery.addEventListener('change', listener)
    return () => mediaQuery.removeEventListener('change', listener)
  })

  // ponytail: smallest local helper to read canonical motion token. Parses
  // --duration-normal (250ms in app.css) with a safe numeric fallback so no
  // hardcoded duration value can drift from the canonical token.
  $effect(() => {
    if (prefersReducedMotion) {
      motionDuration = 0
      return
    }
    try {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--duration-normal')
      const ms = parseFloat(raw)
      motionDuration = Number.isFinite(ms) && ms > 0 ? ms : 250
    } catch {
      motionDuration = 250
    }
  })
</script>

<div class="command-well">
  {#if commandStateError}
    <div in:slide={{ duration: motionDuration }} out:slide={{ duration: motionDuration }}>
      <InlineOperationalAlert message={commandStateError} severity="block" />
    </div>
  {:else if !commandState}
    <div class="command-empty" in:fade={{ duration: motionDuration }}>{emptyStateText}</div>
  {:else if commandState.state === 'disabled'}
    <div class="command-disabled" in:fade={{ duration: motionDuration }}>
      <span class="command-label">{commandState.command?.label ?? '命令'}</span>
      <span class="command-reason" data-testid="command-disabled-reason">{commandState.disabledReason}</span>
    </div>
  {:else if confirming}
    <div class="command-confirm" in:slide={{ duration: motionDuration }} out:slide={{ duration: motionDuration }}>
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
    <button class="btn-command" data-testid="command-btn" in:fade={{ duration: motionDuration }} onclick={onRequestConfirm}>{commandState?.command?.label ?? '执行命令'}</button>
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
