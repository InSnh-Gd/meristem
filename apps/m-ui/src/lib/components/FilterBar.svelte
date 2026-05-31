<script lang="ts">
  let { placeholder, onFilter } = $props<{
    placeholder: string
    onFilter: (q: string) => void
  }>()

  let query = $state('')

  function updateFilter(value: string) {
    query = value
    onFilter(query)
  }

  function clearFilter() {
    if (!query) return
    updateFilter('')
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') clearFilter()
  }
</script>

<div class="filter-bar">
  <input
    type="text"
    {placeholder}
    bind:value={query}
    oninput={(event) => onFilter(event.currentTarget.value)}
    onkeydown={handleKeydown}
    aria-label={placeholder}
  />
  <button type="button" onclick={clearFilter} disabled={!query}>清除</button>
</div>

<style>
  .filter-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  input {
    min-width: 0;
    flex: 1;
    border: 1px solid var(--line-soft);
    border-radius: var(--space-1);
    background: var(--surface-sunken);
    color: var(--text-100);
    font-family: var(--font-body);
    font-size: var(--text-sm);
    padding: var(--space-2) var(--space-3);
  }

  input:focus {
    border-color: var(--signal-info);
    outline: 1px solid var(--signal-info);
    outline-offset: 0;
  }

  button {
    border: none;
    background: transparent;
    color: var(--text-60);
    cursor: pointer;
    font-size: var(--text-xs);
  }

  button:hover:not(:disabled),
  button:focus-visible:not(:disabled) {
    color: var(--text-100);
  }

  button:disabled {
    color: var(--text-40);
    cursor: not-allowed;
  }
</style>
