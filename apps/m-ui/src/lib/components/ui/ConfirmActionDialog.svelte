<script lang="ts">
  import { AlertDialog } from 'bits-ui';
  import type { Snippet } from 'svelte';

  type Props = {
    title: string;
    description: string;
    cancelLabel: string;
    confirmLabel: string;
    disabledReason?: string;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    onConfirm: () => void | Promise<void>;
    children?: Snippet;
  };

	  let {
	    title,
	    description,
    cancelLabel,
    confirmLabel,
    disabledReason,
    open = $bindable(false),
    onOpenChange,
	    onConfirm,
	    children
	  }: Props = $props();

	  let confirming = $state(false);

	  const normalizedTitle = $derived(title?.trim() || '缺少操作标题');
	  const normalizedDescription = $derived(description?.trim() || '缺少操作描述说明');
	  const isInvalid = $derived(
	    !title?.trim() || !description?.trim() || !confirmLabel?.trim() || !!disabledReason?.trim()
	  );
	  
	  const activeDisabledReason = $derived.by(() => {
	    if (disabledReason?.trim()) return disabledReason.trim();
	    if (!title?.trim()) return '缺少操作标题';
	    if (!description?.trim()) return '缺少操作描述说明';
	    if (!confirmLabel?.trim()) return '缺少确认按钮文案';
	    if (confirming) return '确认操作进行中，暂时无法取消或重复提交';
	    return null;
	  });

	  async function handleConfirm(e: MouseEvent) {
    if (isInvalid || confirming) {
      e.preventDefault();
      return;
    }
    confirming = true;
    try {
      await onConfirm();
      open = false;
      onOpenChange?.(false);
    } finally {
      confirming = false;
    }
  }

  function handleOpenChange(v: boolean) {
    if (!v) {
      open = false;
      onOpenChange?.(false);
    } else {
      open = true;
      onOpenChange?.(true);
    }
  }
</script>

<AlertDialog.Root bind:open onOpenChange={handleOpenChange}>
  {#if children}
    <AlertDialog.Trigger>
      {@render children()}
    </AlertDialog.Trigger>
  {/if}
  <AlertDialog.Portal>
    <AlertDialog.Overlay class="dialog-overlay" />
    <AlertDialog.Content class="dialog-content">
	      <AlertDialog.Title class="dialog-title">{normalizedTitle}</AlertDialog.Title>
	      <AlertDialog.Description class="dialog-description">{normalizedDescription}</AlertDialog.Description>
      
	      {#if activeDisabledReason}
	        <div class="dialog-disabled-reason" role="alert">
	          {activeDisabledReason}
	        </div>
	      {/if}

	      <div class="dialog-actions">
	        <!-- 挂起确认期间必须把取消控件真实禁用，避免中途关闭造成状态漂移。 -->
	        <AlertDialog.Cancel>
	          {#snippet child({ props })}
	            <button {...props} class="btn-cancel" disabled={confirming}>
	              {cancelLabel}
	            </button>
	          {/snippet}
	        </AlertDialog.Cancel>
	        <AlertDialog.Action>
	          {#snippet child({ props })}
	            <button
	              {...props}
	              class="btn-confirm"
	              onclick={handleConfirm}
	              disabled={isInvalid || confirming}
	            >
	              {confirmLabel?.trim() || '操作无效'}
	            </button>
	          {/snippet}
	        </AlertDialog.Action>
	      </div>
	    </AlertDialog.Content>
	  </AlertDialog.Portal>
	</AlertDialog.Root>

<style>
  :global(.dialog-overlay) {
    --overlay-bg: color-mix(in srgb, var(--surface-sunken) 80%, transparent);
    position: fixed;
    inset: 0;
    z-index: 50;
    background: var(--overlay-bg);
  }

  :global(.dialog-content) {
    position: fixed;
    left: 50%;
    top: 50%;
    z-index: 50;
    width: 100%;
    max-width: 480px;
    transform: translate(-50%, -50%);
    background: var(--surface-panel);
    border: 1px solid var(--line-strong);
    border-radius: var(--space-2);
    padding: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  :global(.dialog-title) {
    font-size: var(--text-lg);
    font-weight: var(--fw-semibold);
    color: var(--signal-block);
    margin: 0;
  }

  :global(.dialog-description) {
    font-size: var(--text-sm);
    color: var(--text-80);
    line-height: var(--lh-prose);
    margin: 0;
  }

  .dialog-disabled-reason {
    font-size: var(--text-sm);
    color: var(--signal-block);
    background: color-mix(in srgb, var(--signal-block) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--signal-block) 20%, transparent);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--space-1);
    line-height: var(--lh-normal);
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }

  :global(.btn-cancel) {
    background: var(--surface-raised);
    color: var(--text-80);
    border: 1px solid var(--line-soft);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--space-1);
    font-size: var(--text-sm);
    cursor: pointer;
  }
  
  :global(.btn-cancel:hover:not(:disabled)) {
    background: var(--line-soft);
  }
  
  :global(.btn-cancel:disabled) {
    opacity: 0.5;
    cursor: not-allowed;
  }

  :global(.btn-confirm) {
    background: var(--signal-block);
    color: var(--surface-root);
    border: none;
    padding: var(--space-2) var(--space-4);
    border-radius: var(--space-1);
    font-size: var(--text-sm);
    font-weight: var(--fw-medium);
    cursor: pointer;
  }
  
  :global(.btn-confirm:hover:not(:disabled)) {
    opacity: 0.9;
  }
  
  :global(.btn-confirm:disabled) {
    background: var(--line-strong);
    color: var(--text-60);
    cursor: not-allowed;
  }
</style>
