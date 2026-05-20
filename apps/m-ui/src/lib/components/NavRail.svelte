<script lang="ts">
  type NavItem = { id: string; label: string; enabled: boolean }

  let { items, selected, onSelect } = $props<{
    items: NavItem[]
    selected: string
    onSelect: (id: string) => void
  }>()
</script>

<div class="nav-rail">
  {#each items as item}
    <button
      class="nav-item"
      class:active={item.id === selected}
      class:disabled={!item.enabled}
      onclick={() => item.enabled && onSelect(item.id)}
      title={!item.enabled ? '功能尚未实现' : undefined}
    >
      <span class="nav-label">{item.label}</span>
      {#if !item.enabled}
        <span class="nav-disabled-reason">未实现</span>
      {/if}
    </button>
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
