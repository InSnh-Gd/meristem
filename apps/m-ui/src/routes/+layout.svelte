<script lang="ts">
  import { page } from '$app/state'
  import { appState } from '$lib/stores.svelte.ts'
  import NavRail from '$lib/components/NavRail.svelte'
  import TokenInput from '$lib/components/TokenInput.svelte'
  import '../app.css'

  let { children } = $props<{ children: import('svelte').Snippet }>()

  /** SDUI route id → SvelteKit path 映射，不含动态路由（如 /nodes/:id）。 */
  const ROUTE_PATH_MAP: Record<string, string> = {
    'control-room.overview': '/control-room',
    'nodes.index': '/nodes',
    'timeline.index': '/timeline',
    'audit.index': '/audit',
    'policy.decisions': '/policy/decisions',
    'policy.approvals': '/policy/approvals',
    'network.profiles': '/network/profiles',
    'services.index': '/services',
    'networks.index': '/networks',
    'mnet.dataplane.status': '/mnet/dataplane-status',
    'mnet.profile.migration': '/mnet/profile-migration',
    'mnet.break-glass': '/mnet/break-glass'
  }

  const navItems = $derived((appState.routes?.routes ?? []).map((route) => ({
    id: route.id,
    label: route.title,
    enabled: true,
    path: ROUTE_PATH_MAP[route.id]
  })))
  const selectedNav = $derived(
    navItems.find((item) => item.path && page.url.pathname.startsWith(item.path))?.id ?? ''
  )
</script>

<div class="shell">
  <header class="shell-header">
    <span class="shell-title">Meristem 控制室</span>
    <TokenInput />
  </header>
  <div class="shell-body">
    <nav class="shell-nav">
      <NavRail items={navItems} selected={selectedNav} />
    </nav>
    <main class="shell-primary">
      {#if appState.error}
        <div class="error-banner">{appState.error}</div>
      {/if}
      {#if appState.loading}
        <div class="loading">加载中...</div>
      {/if}
      {@render children()}
    </main>
  </div>
</div>

<style>
  .shell {
    display: grid;
    grid-template-rows: auto 1fr;
    height: 100vh;
    overflow: hidden;
  }
  .shell-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--shell-padding-y) var(--shell-padding-x);
    border-bottom: 1px solid var(--line-soft);
    background: var(--surface-panel);
  }
  .shell-title {
    font-size: var(--text-xl);
    font-weight: var(--fw-semibold);
    color: var(--text-100);
  }
  .shell-body {
    display: grid;
    grid-template-columns: var(--nav-rail-width) 1fr;
    overflow: hidden;
  }
  .shell-nav {
    border-right: 1px solid var(--line-soft);
    background: var(--surface-panel);
    overflow-y: auto;
  }
  .shell-primary {
    overflow-y: auto;
    padding: var(--space-4) var(--shell-padding-x);
    padding-bottom: var(--command-well-offset);
  }
  .error-banner {
    background: var(--signal-block);
    color: var(--text-100);
    padding: var(--space-2) var(--space-3);
    border-radius: 4px;
    margin-bottom: var(--space-3);
    font-size: var(--text-sm);
  }
  .loading {
    color: var(--text-60);
    font-size: var(--text-sm);
    padding: var(--space-6) 0;
  }

  @media (max-width: 760px) {
    .shell {
      height: auto;
      min-height: 100vh;
      overflow: visible;
    }
    .shell-header {
      align-items: stretch;
      flex-direction: column;
    }
    .shell-body {
      grid-template-columns: 1fr;
      overflow: visible;
    }
    .shell-nav {
      border-right: none;
      border-bottom: 1px solid var(--line-soft);
    }
    .shell-primary {
      overflow: visible;
      padding-bottom: var(--command-well-offset-mobile);
    }
  }
</style>
