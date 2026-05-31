<script lang="ts">
  type NavItem = { id: string; label: string; enabled: boolean; path?: string; disabledReason?: string }

  let { items, selected } = $props<{
    items: NavItem[]
    selected: string
  }>()
</script>

<div class="nav-rail">
  {#each items as item}
    {#if item.enabled && item.path}
      <a
        class="nav-item"
        class:active={item.id === selected}
        href={item.path}
        data-sveltekit-preload-data="off"
      >
        <span class="nav-label">{item.label}</span>
      </a>
    {:else}
      <button
        class="nav-item disabled"
        title={item.disabledReason ?? '功能尚未实现'}
        aria-disabled="true"
      >
        <span class="nav-label">{item.label}</span>
        <span class="nav-disabled-reason">{item.disabledReason ?? '未实现'}</span>
      </button>
    {/if}
  {/each}
</div>

<style>
  .nav-rail { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-3) var(--space-2); }
  .nav-item { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-2) var(--space-3); border: none; border-radius: 4px; background: transparent; color: var(--text-80); font-size: var(--text-sm); cursor: pointer; text-align: left; width: 100%; }
  .nav-item:hover:not(.disabled) { background: var(--surface-raised); }
  .nav-item.active { background: var(--surface-raised); color: var(--text-100); }
  .nav-item.disabled { color: var(--text-40); cursor: not-allowed; }
  .nav-disabled-reason { font-size: var(--text-xs); color: var(--text-40); }

  @media (max-width: 760px) {
    .nav-rail {
      flex-direction: row;
      overflow-x: auto;
    }
    .nav-item {
      min-width: 88px;
    }
  }
</style>
