<script lang="ts">
  import { Tooltip } from 'bits-ui';
  import type { Snippet } from 'svelte';

  type Props = {
    content: string;
    children: Snippet;
    delayDuration?: number;
  };

  let { content, children, delayDuration = 200 }: Props = $props();
</script>

<!-- ponytail: Provider is wrapped internally for single-tooltip usage, 
     sacrificing global hover-delay grouping for simplicity and strict boundary. -->
<Tooltip.Provider {delayDuration}>
  <Tooltip.Root {delayDuration}>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <span {...props} class="tooltip-trigger">
          {@render children()}
        </span>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content sideOffset={4} class="tooltip-content" role="tooltip">
        {content}
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
</Tooltip.Provider>

<style>
  :global(.tooltip-trigger) {
    display: contents;
  }

  :global(.tooltip-content) {
    z-index: 50;
    background: var(--surface-panel);
    border: 1px solid var(--line-strong);
    color: var(--text-80);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--space-1);
    font-size: var(--text-xs);
    box-shadow: 0 4px 6px -1px color-mix(in srgb, var(--surface-sunken) 50%, transparent);
    max-width: 240px;
    word-break: break-word;
  }
</style>
