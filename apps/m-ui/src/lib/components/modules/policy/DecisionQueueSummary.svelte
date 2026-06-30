<script lang="ts">
  let { pendingCount } = $props<{ pendingCount: number }>()
</script>

<span class:pending={pendingCount > 0} class="decision-queue-summary">
  {pendingCount > 0 ? `${pendingCount} 项待审` : '无待审'}
</span>

<style>
  .decision-queue-summary {
    display: inline-flex;
    align-items: center;
    width: fit-content;
    border: 1px solid var(--line-soft);
    border-radius: var(--space-1);
    background: color-mix(in srgb, var(--surface-root) 70%, var(--surface-panel));
    color: var(--text-60);
    font-size: var(--text-xs);
    padding: var(--space-1) var(--space-2);
  }

  .decision-queue-summary.pending {
    border-color: var(--signal-warn);
    background: color-mix(in srgb, var(--signal-warn) 10%, var(--surface-root));
    color: var(--signal-warn);
  }
</style>
