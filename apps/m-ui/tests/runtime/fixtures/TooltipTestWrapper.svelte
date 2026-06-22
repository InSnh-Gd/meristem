<script lang="ts">
  import Tooltip from '$lib/components/ui/Tooltip.svelte';

  let { content, triggerText } = $props<{
    content: string;
    triggerText: string;
  }>();
</script>

<Tooltip {content} delayDuration={0}>
  <button>{triggerText}</button>
</Tooltip>
