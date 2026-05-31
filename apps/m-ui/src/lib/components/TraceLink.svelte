<script lang="ts">
  let { correlationId } = $props<{ correlationId: string }>()
</script>

<a class="trace-link" href={`/trace/${correlationId}`} aria-label={`查看关联 ${correlationId}`}>
  {correlationId}
</a>

<style>
  .trace-link {
    color: var(--signal-info);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-decoration: underline;
    text-underline-offset: var(--space-1);
  }

  .trace-link:focus-visible {
    outline: 1px solid var(--signal-info);
    outline-offset: var(--space-1);
  }
</style>
