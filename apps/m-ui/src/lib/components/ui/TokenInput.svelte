<script lang="ts">
  import { normalizeBearerTokenInput } from '$lib/bff'
  import { appState } from '$lib/stores.svelte.ts'

  function submitToken(event: SubmitEvent) {
    event.preventDefault()
    appState.token = normalizeBearerTokenInput(appState.token)
    void appState.refresh()
  }
</script>

<div class="token-control">
  <form class="token-input" onsubmit={submitToken}>
    <span class="search-hint" aria-hidden="true">⌘ K</span>
    <input
      data-testid="token-input"
      type="text"
      autocomplete="off"
      spellcheck="false"
      placeholder="Search nodes, tasks, events, correlation ids..."
      value={appState.token}
      aria-describedby="token-help"
      oninput={(e: Event) => (appState.token = (e.target as HTMLInputElement).value)}
    />
    <button
      type="submit"
      data-testid="token-submit"
      class="search-submit"
      disabled={!appState.token.trim() || appState.loading}
      aria-label="连接"
    >
      连接
    </button>
  </form>

  <p id="token-help" class="token-help">
    本地开发请使用 Bearer JWT，不要把 <code>MERISTEM_JWT_SECRET</code> 的原始 secret 当成 token。
  </p>
</div>

<style>
  .token-control {
    display: grid;
    gap: 2px;
    width: 100%;
  }

  .token-input {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1);
    border: 1px solid var(--line-chrome-strong);
    border-radius: var(--radius-pill);
    background: var(--surface-glass);
    backdrop-filter: var(--glass-panel-backdrop);
    transition:
      border-color var(--duration-fast) var(--easing-ui),
      background var(--duration-fast) var(--easing-ui);
  }

  .token-input:focus-within {
    border-color: var(--signal-info);
    background: var(--surface-glass-strong);
  }

  .search-hint {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--line-chrome-strong);
    border-radius: var(--radius-pill);
    background: var(--surface-chrome-raised);
    color: var(--text-60);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: var(--fw-medium);
    white-space: nowrap;
  }

  .token-input input {
    min-width: 0;
    width: 100%;
    background: transparent;
    color: var(--text-100);
    border: none;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-pill);
    font-size: var(--text-sm);
    font-family: var(--font-mono);
    line-height: var(--lh-normal);
  }

  .token-input input:focus {
    outline: none;
  }

  .token-input input::placeholder {
    color: var(--text-40);
  }

  .search-submit {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-chrome-raised);
    color: var(--text-100);
    border: 1px solid var(--line-chrome-strong);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-pill);
    font-size: var(--text-xs);
    font-weight: var(--fw-medium);
    line-height: var(--lh-tight);
    cursor: pointer;
    transition:
      border-color var(--duration-fast) var(--easing-ui),
      background var(--duration-fast) var(--easing-ui),
      color var(--duration-fast) var(--easing-ui);
  }

  .search-submit:hover:not(:disabled) {
    background: var(--surface-raised);
    border-color: var(--signal-info);
  }

  .search-submit:disabled {
    color: var(--text-40);
    cursor: not-allowed;
  }

  .search-submit:focus-visible {
    outline: 1px solid var(--signal-info);
    outline-offset: var(--space-1);
  }

  .token-help {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @media (max-width: 760px) {
    .token-control {
      width: 100%;
      min-width: 0;
    }

    .token-input {
      align-items: stretch;
    }

    .search-hint {
      display: none;
    }

    .search-submit {
      white-space: nowrap;
    }

    .token-input input {
      padding-inline: var(--space-2);
    }
  }
</style>
