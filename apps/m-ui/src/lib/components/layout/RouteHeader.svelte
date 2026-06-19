<script lang="ts">
  import StateSourceBadge from '$lib/components/ui/StateSourceBadge.svelte'

  let { routeName, stateSources } = $props<{
    routeName: string
    stateSources: string[]
  }>()
</script>

<header class="route-header">
  <h1>{routeName}</h1>
  <div class="state-sources" aria-label="状态来源">
    {#each stateSources as source}
      <StateSourceBadge {source} />
    {/each}
  </div>
</header>

<style>
  .route-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--panel-gap);
  }

  h1 {
    color: var(--text-100);
    font-size: var(--text-xl);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
  }

  .state-sources {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
</style>
