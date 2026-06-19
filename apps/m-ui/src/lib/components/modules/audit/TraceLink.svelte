<script lang="ts">
  let { correlationId } = $props<{ correlationId: string }>()
</script>

<span class="trace-evidence" aria-label={`追踪凭证 ${correlationId}`} title={`关联追踪 ID: ${correlationId}`}>
  {correlationId}
</span>

<style>
  .trace-evidence {
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: var(--space-1) var(--space-2);
    background-color: var(--surface-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-color);
  }
</style>
