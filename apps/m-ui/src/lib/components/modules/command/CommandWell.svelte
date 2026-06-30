<script lang="ts">
  import type { CommandResult, CommandState, OverviewData } from '$lib/types.ts'
  import InlineOperationalAlert from '$lib/components/ui/InlineOperationalAlert.svelte'
  import { slide, fade } from 'svelte/transition'

  type Props = {
    emptyStateText?: string
    targetLabel?: string
    targetName?: string
    commandState: CommandState | null
    commandStateError?: string | null
    commandExecutionError?: string | null
    selectedNode: OverviewData['nodes'][number] | null
    taskResult?: CommandResult | null
    confirming: boolean
    onRequestConfirm: () => void
    onCancel: () => void
    onConfirm: () => void
  }

  let {
    commandState,
    commandStateError,
    commandExecutionError = null,
    selectedNode,
    taskResult = null,
    confirming,
    emptyStateText = '请选择目标以执行命令',
    targetLabel = 'target',
    targetName,
    onRequestConfirm,
    onCancel,
    onConfirm
  }: Props = $props()

  const COMMAND_ICONS: Record<string, string> = {
    task:
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="2.5" fill="currentColor" fill-opacity="0.12"/><path d="m9 8 5 4-5 4z" fill="currentColor" stroke="none"/></svg>',
    refresh:
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3.6-7.2"/><path d="M21 3v5h-5"/></svg>',
    event:
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="2.5" fill="currentColor" fill-opacity="0.12"/><circle cx="8.5" cy="9" r="2" fill="currentColor" stroke="none"/><path d="M12.5 9h6"/><circle cx="8.5" cy="15" r="2" fill="currentColor" stroke="none"/><path d="M12.5 15h6"/></svg>',
    restart:
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12a7 7 0 1 1-2.8-5.6"/><path d="M19 6v6h-6"/></svg>',
    relay:
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h10v10H7z" fill="currentColor" fill-opacity="0.12"/><path d="M7 12h10"/><path d="M12 7v10"/></svg>'
  }

  const ROW_ICONS: Record<string, string> = {
    target:
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7L12 2.5z"/><path d="M12 8v8"/><path d="m8.5 10 3.5 2 3.5-2"/></svg>',
    requires:
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="3"/><circle cx="16" cy="16" r="3"/><path d="M10.2 10.2 13.8 13.8"/><path d="M4 20c.5-2.4 2-4 4-4s3.5 1.6 4 4"/></svg>',
    policy:
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 19.5 7v5.5c0 4.8-3 7.4-7.5 9-4.5-1.6-7.5-4.2-7.5-9V7L12 3.5z"/><path d="m9 12 2 2 4-4"/></svg>',
    audit:
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M9 8h6"/><path d="M9 12h6"/><path d="M9 16h4"/></svg>',
    confirm:
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12"/><path d="M6 21h12"/><path d="M8 3c0 5 4 6 4 9s-4 4-4 9"/><path d="M16 3c0 5-4 6-4 9s4 4 4 9"/></svg>'
  }

  const displayCommands = [
    {
      id: 'leaf.refresh',
      iconSvg: COMMAND_ICONS.refresh,
      label: '刷新 Leaf 状态',
      target: (name: string | null) => (name ? `target: ${name}` : '需要选择节点'),
      requires: 'audit:read',
      policy: 'optional',
      audit: 'optional',
      disabledReason: (hasNode: boolean, reachable: boolean) => {
        if (!hasNode) return '需要选择节点'
        if (!reachable) return 'selected node is not reachable'
        return '能力未激活'
      }
    },
    {
      id: 'eventbus.summary',
      iconSvg: COMMAND_ICONS.event,
      label: '查看 EventBus publish summary',
      target: () => 'source: eventBusMetrics',
      requires: 'audit:read',
      policy: 'optional',
      audit: 'optional',
      disabledReason: () => '能力未激活'
    },
    {
      id: 'task.restart',
      iconSvg: COMMAND_ICONS.restart,
      label: '运行 重启任务',
      target: (name: string | null) => (name ? `target: ${name}` : '需要选择节点'),
      requires: 'task:submit',
      policy: 'required',
      audit: 'required',
      disabledReason: (hasNode: boolean, reachable: boolean) => {
        if (!hasNode) return '需要选择节点'
        if (!reachable) return 'selected node is not reachable'
        return '能力未激活'
      }
    },
    {
      id: 'network.forced-relay.change.execute',
      iconSvg: COMMAND_ICONS.relay,
      label: '切换强制 Relay 类',
      target: (name: string | null) => (name ? `target: ${name}` : '需要选择节点'),
      requires: 'network:profile-enable',
      policy: 'required',
      audit: 'required',
      disabledReason: (hasNode: boolean, reachable: boolean) => {
        if (!hasNode) return '需要选择节点'
        if (!reachable) return 'selected node is not reachable'
        return '仅中国区 NetBird v0.3.0 Leaf 节点可用'
      }
    }
  ]

  function isTaskCommandResult(result: CommandResult): result is Extract<CommandResult, { task: unknown }> {
    return 'task' in result
  }

  let prefersReducedMotion = $state(false)
  let motionDuration = $state(220)

  $effect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    prefersReducedMotion = mediaQuery.matches
    const listener = (e: MediaQueryListEvent) => {
      prefersReducedMotion = e.matches
    }
    mediaQuery.addEventListener('change', listener)
    return () => mediaQuery.removeEventListener('change', listener)
  })

  $effect(() => {
    if (prefersReducedMotion) {
      motionDuration = 0
      return
    }
    try {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--duration-normal')
      const ms = parseFloat(raw)
      motionDuration = Number.isFinite(ms) && ms > 0 ? ms : 220
    } catch {
      motionDuration = 220
    }
  })

  function isReachable(node: OverviewData['nodes'][number] | null): boolean {
    if (!node) return false
    return node.reachability === 'reachable' || node.reachability === 'public'
  }

  const hasSelectedNode = $derived(!!selectedNode)
  const selectedReachable = $derived(isReachable(selectedNode))
  const selectedName = $derived(targetName ?? selectedNode?.name ?? null)
</script>

{#snippet rowIcon(kind: keyof typeof ROW_ICONS)}
  <span class="command-row-icon" aria-hidden="true">{@html ROW_ICONS[kind]}</span>
{/snippet}

<div class="command-well" data-testid="command-well">
  {#if commandExecutionError}
    <div in:slide={{ duration: motionDuration }} out:slide={{ duration: motionDuration }}>
      <InlineOperationalAlert message={commandExecutionError} severity="block" />
    </div>
  {/if}

  {#if taskResult}
    <dl class="command-result" aria-label="命令结果">
      {#if isTaskCommandResult(taskResult)}
        <div>
          <dt>task.id</dt>
          <dd>{taskResult.task.id}</dd>
        </div>
        <div>
          <dt>task.status</dt>
          <dd>{taskResult.task.status === 'accepted' ? 'queued' : taskResult.task.status}</dd>
        </div>
        <div>
          <dt>policyDecisionId</dt>
          <dd>{taskResult.policyDecisionId}</dd>
        </div>
        <div>
          <dt>correlationId</dt>
          <dd>{taskResult.correlationId}</dd>
        </div>
      {:else}
        <div>
          <dt>networkId</dt>
          <dd>{taskResult.networkId}</dd>
        </div>
        <div>
          <dt>routeClass</dt>
          <dd>{taskResult.routeClass}</dd>
        </div>
        <div>
          <dt>policyDecisionId</dt>
          <dd>{taskResult.policyDecisionId}</dd>
        </div>
        <div>
          <dt>auditId</dt>
          <dd>{taskResult.auditId}</dd>
        </div>
        <div>
          <dt>eventId</dt>
          <dd>{taskResult.eventId}</dd>
        </div>
        <div>
          <dt>correlationId</dt>
          <dd>{taskResult.correlationId}</dd>
        </div>
      {/if}
    </dl>
  {/if}

  <div class="command-deck">
    <!-- Primary controlled command -->
    <article class="command-card primary" class:confirming aria-label={commandState?.command?.label ?? '运行 noop 任务'}>
      <div class="command-card-title">
        <span class="command-card-icon" aria-hidden="true">{@html commandState?.command?.id === 'network.forced-relay.change.execute' ? COMMAND_ICONS.relay : COMMAND_ICONS.task}</span>
        {commandState?.command?.label ?? '运行 noop 任务'}
      </div>
      <div class="command-card-target">{@render rowIcon('target')}{targetLabel}: {selectedName ?? '—'}</div>
      <div class="command-card-requirements">
        <span>{@render rowIcon('requires')}<span class="requirement-key">requires</span>{commandState?.command?.requiredPermissions?.join(', ') ?? 'task:submit'}</span>
        <span>{@render rowIcon('policy')}<span class="requirement-key">policy</span>{commandState?.command?.requiresPolicy ? 'required' : 'optional'}</span>
        <span>{@render rowIcon('audit')}<span class="requirement-key">audit</span>{commandState?.command?.requiresAudit ? 'required' : 'optional'}</span>
      </div>

      {#if commandStateError}
        <div class="command-card-status block" in:slide={{ duration: motionDuration }}>
          状态: 加载失败
        </div>
        <div in:slide={{ duration: motionDuration }}>
          <InlineOperationalAlert message={commandStateError} severity="block" />
        </div>
      {:else if !commandState}
        <div class="command-card-status" in:fade={{ duration: motionDuration }}>{emptyStateText}</div>
      {:else if commandState.state === 'disabled'}
        <div class="command-card-status block">
          状态: 禁用
          <span class="command-reason" data-testid="command-disabled-reason">{commandState.disabledReason}</span>
        </div>
      {:else if confirming}
        <div
          class="command-card-status attention"
          in:slide={{ duration: motionDuration }}
          out:slide={{ duration: motionDuration }}
        >
          <span class="confirm-label">{@render rowIcon('confirm')}状态: 需要确认</span>
          <div class="confirm-actions">
            <button
              class="btn-execute primary"
              data-testid="command-confirm-btn"
              onclick={onConfirm}
            >确认执行</button>
            <button
              class="btn-execute"
              data-testid="command-cancel-btn"
              onclick={onCancel}
            >取消</button>
          </div>
        </div>
      {:else}
        <div class="command-card-status ready">
          状态: 就绪
          <button
            class="btn-execute primary"
            data-testid="command-btn"
            in:fade={{ duration: motionDuration }}
            onclick={onRequestConfirm}
          >
            {commandState?.command?.label ?? '执行命令'} · 执行
          </button>
        </div>
      {/if}
    </article>

    <!-- Display-only controlled-operation cards -->
    <article class="command-card disabled" aria-label={displayCommands[0].label}>
      <div class="command-card-title">
        <span class="command-card-icon" aria-hidden="true">{@html displayCommands[0].iconSvg}</span>
        {displayCommands[0].label}
      </div>
      <div class="command-card-target">{@render rowIcon('target')}{displayCommands[0].target(selectedName)}</div>
      <div class="command-card-requirements">
        <span>{@render rowIcon('requires')}<span class="requirement-key">requires</span>{displayCommands[0].requires}</span>
        <span>{@render rowIcon('policy')}<span class="requirement-key">policy</span>{displayCommands[0].policy}</span>
        <span>{@render rowIcon('audit')}<span class="requirement-key">audit</span>{displayCommands[0].audit}</span>
      </div>
      <div class="command-card-status block">
        状态: 禁用
        <span class="command-reason">{displayCommands[0].disabledReason(hasSelectedNode, selectedReachable)}</span>
      </div>
    </article>

    <article class="command-card disabled" aria-label={displayCommands[1].label}>
      <div class="command-card-title">
        <span class="command-card-icon" aria-hidden="true">{@html displayCommands[1].iconSvg}</span>
        {displayCommands[1].label}
      </div>
      <div class="command-card-target">{@render rowIcon('target')}{displayCommands[1].target(selectedName)}</div>
      <div class="command-card-requirements">
        <span>{@render rowIcon('requires')}<span class="requirement-key">requires</span>{displayCommands[1].requires}</span>
        <span>{@render rowIcon('policy')}<span class="requirement-key">policy</span>{displayCommands[1].policy}</span>
        <span>{@render rowIcon('audit')}<span class="requirement-key">audit</span>{displayCommands[1].audit}</span>
      </div>
      <div class="command-card-status block">
        状态: 禁用
        <span class="command-reason">{displayCommands[1].disabledReason(hasSelectedNode, selectedReachable)}</span>
      </div>
    </article>

    <article class="command-card disabled" aria-label={displayCommands[2].label}>
      <div class="command-card-title">
        <span class="command-card-icon" aria-hidden="true">{@html displayCommands[2].iconSvg}</span>
        {displayCommands[2].label}
      </div>
      <div class="command-card-target">{@render rowIcon('target')}{displayCommands[2].target(selectedName)}</div>
      <div class="command-card-requirements">
        <span>{@render rowIcon('requires')}<span class="requirement-key">requires</span>{displayCommands[2].requires}</span>
        <span>{@render rowIcon('policy')}<span class="requirement-key">policy</span>{displayCommands[2].policy}</span>
        <span>{@render rowIcon('audit')}<span class="requirement-key">audit</span>{displayCommands[2].audit}</span>
      </div>
      <div class="command-card-status block">
        状态: 禁用
        <span class="command-reason">{displayCommands[2].disabledReason(hasSelectedNode, selectedReachable)}</span>
      </div>
    </article>

    <article class="command-card disabled" aria-label={displayCommands[3].label}>
      <div class="command-card-title">
        <span class="command-card-icon" aria-hidden="true">{@html displayCommands[3].iconSvg}</span>
        {displayCommands[3].label}
      </div>
      <div class="command-card-target">{@render rowIcon('target')}{displayCommands[3].target(selectedName)}</div>
      <div class="command-card-requirements">
        <span>{@render rowIcon('requires')}<span class="requirement-key">requires</span>{displayCommands[3].requires}</span>
        <span>{@render rowIcon('policy')}<span class="requirement-key">policy</span>{displayCommands[3].policy}</span>
        <span>{@render rowIcon('audit')}<span class="requirement-key">audit</span>{displayCommands[3].audit}</span>
      </div>
      <div class="command-card-status block">
        状态: 禁用
        <span class="command-reason">{displayCommands[3].disabledReason(hasSelectedNode, selectedReachable)}</span>
      </div>
    </article>
  </div>
</div>

<style>
  .command-well {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-height: 0;
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
    font-size: 12px;
    letter-spacing: 0.06em;
    margin: 0;
    text-transform: uppercase;
  }

  .command-result dd {
    color: var(--text-100);
    font-family: var(--font-mono);
    font-size: 15px;
    line-height: var(--lh-tight);
    margin: var(--space-1) 0 0;
    word-break: break-all;
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

  .command-row-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 15px;
    height: 15px;
    color: var(--text-70);
  }

  .command-card.confirming .command-row-icon {
    color: var(--signal-attention);
  }

  .requirement-key {
    display: inline-flex;
    align-items: center;
    margin-right: 5px;
    padding: 1px 5px;
    border: 1px solid color-mix(in srgb, var(--line-soft) 84%, transparent);
    border-radius: var(--radius-pill);
    color: var(--text-60);
    font-size: 10px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .command-card-status {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 13px;
    color: var(--text-60);
    margin-top: auto;
  }

  .command-card.confirming .command-card-status.attention {
    margin-right: calc(var(--space-3) * -1);
    margin-bottom: calc(var(--space-3) * -1);
    margin-left: calc(var(--space-3) * -1);
    padding: var(--space-2) var(--space-3);
    border-top: 1px solid color-mix(in srgb, var(--signal-attention) 34%, var(--line-soft));
    border-radius: 0 0 var(--operational-card-radius) var(--operational-card-radius);
    background: linear-gradient(90deg, color-mix(in srgb, var(--signal-attention) 20%, transparent), color-mix(in srgb, var(--signal-attention) 7%, transparent));
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
    font-size: 11px;
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

  @media (max-width: 760px) {
    .command-well {
      align-items: stretch;
    }

    .command-result {
      grid-template-columns: 1fr;
    }

    .confirm-actions {
      margin-left: 0;
    }
  }
</style>
