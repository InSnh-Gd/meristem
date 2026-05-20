<script lang="ts">
  import { normalizeBearerTokenInput } from '../bff'
  import { appState } from '../stores.svelte.ts'

  function submitToken(event: SubmitEvent) {
    event.preventDefault()
    appState.token = normalizeBearerTokenInput(appState.token)
    void appState.refresh()
  }
</script>

<form class="token-input" onsubmit={submitToken}>
  <input data-testid="token-input"
    type="text"
    autocomplete="off"
    spellcheck="false"
    placeholder="输入操作者令牌..."
    value={appState.token}
    oninput={(e: Event) => appState.token = (e.target as HTMLInputElement).value}
  />
  <button type="submit" data-testid="token-submit" disabled={!appState.token.trim() || appState.loading}>
    连接
  </button>
</form>

<style>
  .token-input {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .token-input input {
    background: var(--surface-root);
    color: var(--text-80);
    border: 1px solid var(--line-soft);
    padding: var(--space-1) var(--space-3);
    border-radius: 4px;
    font-size: var(--text-sm);
    font-family: var(--font-mono);
    width: var(--token-input-width);
    min-width: var(--token-input-min-width);
  }
  .token-input input:focus { outline: none; border-color: var(--signal-info); }
  .token-input input::placeholder { color: var(--text-40); }
  .token-input button {
    background: var(--surface-raised);
    color: var(--text-80);
    border: 1px solid var(--line-soft);
    padding: var(--space-1) var(--space-3);
    border-radius: 4px;
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .token-input button:hover:not(:disabled) {
    background: var(--line-strong);
  }
  .token-input button:disabled {
    color: var(--text-40);
    cursor: not-allowed;
  }

  @media (max-width: 760px) {
    .token-input {
      align-items: stretch;
    }
    .token-input input {
      flex: 1;
      min-width: 0;
      width: 100%;
    }
  }
</style>
