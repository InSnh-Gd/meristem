<script lang="ts">
  let { data, title } = $props<{
    data: unknown
    title: string
  }>()

  let expanded = $state(false)
  const formatted = $derived(JSON.stringify(data, null, 2))
</script>

<section class="raw-envelope-view">
  <button type="button" onclick={() => expanded = !expanded} aria-expanded={expanded}>
    <span>{title}</span>
    <span>{expanded ? '收起' : '展开'}</span>
  </button>
  {#if expanded}
    <pre>{formatted}</pre>
  {/if}
</section>

<style>
  .raw-envelope-view {
    border: 1px solid var(--line-soft);
    border-radius: var(--space-1);
    background: var(--surface-sunken);
  }

  button {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    border: none;
    background: transparent;
    color: var(--text-100);
    cursor: pointer;
    font-family: var(--font-body);
    font-size: var(--text-sm);
    font-weight: var(--fw-medium);
    padding: var(--space-2) var(--space-3);
    text-align: left;
  }

  button:focus-visible {
    outline: 1px solid var(--signal-info);
    outline-offset: var(--space-1);
  }

  pre {
    overflow-x: auto;
    border-top: 1px solid var(--line-soft);
    color: var(--text-80);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: var(--lh-log);
    padding: var(--space-3);
    user-select: text;
    white-space: pre-wrap;
  }
</style>
