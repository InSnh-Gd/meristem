<script lang="ts">
  import Tooltip from '$lib/components/ui/Tooltip.svelte'
  let { correlationId } = $props<{ correlationId: string }>()
</script>

<Tooltip content={`关联追踪 ID: ${correlationId}`}>
  <span class="trace-evidence" aria-label={`追踪凭证 ${correlationId}`}>
    {correlationId}
  </span>
</Tooltip>

<style>
  .trace-evidence {
    color: var(--text-60);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: var(--space-1) var(--space-2);
    background-color: var(--surface-raised);
    border-radius: 4px;
    border: 1px solid var(--line-soft);
  }
</style>
