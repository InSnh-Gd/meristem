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
    border: 1px solid color-mix(in srgb, var(--line-soft) 84%, transparent);
    border-radius: var(--glass-panel-radius);
    background: linear-gradient(180deg, color-mix(in srgb, var(--surface-panel) 94%, var(--surface-raised)), color-mix(in srgb, var(--surface-root) 96%, black));
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--glass-panel-highlight) 24%, transparent);
    overflow: hidden;
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
    padding: var(--space-3);
    text-align: left;
    transition:
      background var(--duration-fast) var(--easing-ui);
  }

  button:hover {
    background: color-mix(in srgb, var(--surface-raised) 50%, transparent);
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
