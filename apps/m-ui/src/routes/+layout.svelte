<script lang="ts">
  import { page } from '$app/state'
  import { appState } from '$lib/stores.svelte.ts'
  import NavRail from '$lib/components/layout/NavRail.svelte'
  import TokenInput from '$lib/components/ui/TokenInput.svelte'
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

  const navItems = $derived((appState.routes?.routes ?? []).map((route) => {
    const label = route.title === '控制室概览' ? '控制室总览' : route.title
    return {
      id: route.id,
      label,
      ariaLabel: route.title,
      enabled: true,
      path: ROUTE_PATH_MAP[route.id]
    }
  }))
  const selectedNav = $derived(
    navItems.find((item) => item.path && page.url.pathname.startsWith(item.path))?.id ?? ''
  )

  const connectionModifier = $derived(
    appState.error ? 'error' : appState.loading ? 'loading' : 'ready'
  )
  const connectionText = $derived(
    appState.error ? 'Core 异常' : appState.loading ? '同步中' : 'Core healthy'
  )

  const coreVersion = $derived(appState.overview?.core.version ?? '0.1.0')
  const actorName = $derived(appState.actor ?? null)
  const permissionsPreview = $derived(
    appState.permissions.slice(0, 2).join(' · ') || '未授权'
  )

  // Operator avatar icon drawn as part of the M-UI inline SVG icon family.
  const OPERATOR_AVATAR_SVG =
    '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="7" r="4.5" fill="currentColor" stroke="none"/><path d="M4 21c0-5 3.5-8.5 8-8.5s8 3.5 8 8.5"/></svg>'
</script>

<div class="workbench-shell">
  <nav class="workbench-rail" aria-label="主导航">
    <NavRail items={navItems} selected={selectedNav} />
  </nav>

  <div class="workbench-stage">
    <header
      class="top-chrome"
      data-testid="m-ui-top-app-bar"
      aria-label="Meristem 控制室顶栏"
    >
      <div class="top-chrome-main">
        <div class="top-chrome-search">
          <TokenInput />
        </div>

        <div class="top-chrome-actions" aria-label="状态与操作者">
          <span class="status-pill version">Meristem v{coreVersion}</span>
          <span class="status-pill healthy">BFF connected</span>
          <span class="status-pill status-pill--{connectionModifier}">
            {connectionText}
          </span>
          {#if actorName}
            <div class="operator-context" title={permissionsPreview}>
              <span class="operator-avatar" aria-hidden="true">{@html OPERATOR_AVATAR_SVG}</span>
              <div class="operator-body">
                <span class="operator-name">{actorName}</span>
                <span class="operator-perms">{permissionsPreview}</span>
              </div>
              <span class="operator-chevron" aria-hidden="true">▾</span>
            </div>
          {/if}
        </div>
      </div>

      {#if appState.error || appState.loading}
        <div class="top-chrome-feedback" aria-live="polite">
          {#if appState.error}
            <p class="error-banner" role="alert">连接错误：{appState.error}</p>
          {/if}
          {#if appState.loading}
            <p class="loading" role="status">正在加载控制室数据...</p>
          {/if}
        </div>
      {/if}
    </header>

    <main class="workbench-primary">
      {@render children()}
    </main>
  </div>
</div>

<style>
  .workbench-shell {
    display: grid;
    grid-template-columns: var(--nav-rail-width) minmax(0, 1fr);
    height: 100vh;
    overflow: hidden;
    background: var(--surface-root);
  }

  .workbench-rail {
    position: relative;
    z-index: 20;
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 0;
    border-right: 1px solid color-mix(in srgb, var(--line-soft) 86%, transparent);
    background: color-mix(in srgb, var(--surface-root) 92%, black);
    box-shadow: inset -1px 0 0 color-mix(in srgb, var(--line-glass) 22%, transparent);
  }

  .workbench-stage {
    display: grid;
    grid-template-rows: auto 1fr;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .top-chrome {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-2) var(--shell-padding-x) var(--space-3);
    border-bottom: 1px solid color-mix(in srgb, var(--line-chrome) 78%, transparent);
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--surface-app-bar) 94%, black), var(--surface-chrome));
    box-shadow:
      inset 0 -1px 0 color-mix(in srgb, var(--line-glass) 28%, transparent),
      var(--elevation-app-bar);
  }

  .top-chrome-main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-4);
    min-height: var(--app-bar-height);
  }

  .top-chrome-search {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    max-width: min(880px, 60vw);
  }

  .top-chrome-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    min-width: 0;
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    flex: 0 0 auto;
    padding: 6px 12px;
    border: 1px solid color-mix(in srgb, var(--line-glass-strong) 78%, transparent);
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--surface-glass) 82%, var(--surface-chrome-raised));
    color: var(--text-100);
    font-size: var(--text-xs);
    font-weight: var(--fw-medium);
    white-space: nowrap;
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--glass-panel-highlight) 55%, transparent);
  }

  .status-pill::before {
    display: block;
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-pill);
    background: currentColor;
    content: '';
  }

  .status-pill.version::before {
    background: var(--accent-purple);
  }

  .status-pill.healthy::before {
    background: var(--signal-connected);
  }

  .status-pill--ready::before {
    background: var(--signal-ok);
  }

  .status-pill--loading::before {
    background: var(--signal-attention);
  }

  .status-pill--error::before {
    background: var(--signal-block);
  }

  .operator-context {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: 6px 12px 6px 8px;
    border: 1px solid color-mix(in srgb, var(--line-glass-strong) 72%, transparent);
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--surface-glass-strong) 86%, var(--surface-chrome-raised));
    color: var(--text-100);
    font-size: var(--text-xs);
    white-space: nowrap;
    cursor: default;
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--glass-panel-highlight) 45%, transparent);
  }

  .operator-avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: var(--radius-pill);
    background: var(--accent-purple-soft);
    color: var(--accent-purple);
  }

  .operator-body {
    display: flex;
    flex-direction: column;
    line-height: var(--lh-tight);
  }

  .operator-name {
    font-weight: var(--fw-medium);
    color: var(--text-100);
  }

  .operator-perms {
    color: var(--text-60);
    font-family: var(--font-mono);
    font-size: 10px;
  }

  .operator-chevron {
    color: var(--text-40);
    font-size: 10px;
    margin-left: -2px;
  }

  .top-chrome-feedback {
    display: grid;
    gap: var(--space-2);
  }

  .workbench-primary {
    min-width: 0;
    overflow-y: auto;
    padding: var(--shell-padding-y) var(--shell-padding-x);
    background:
      radial-gradient(
        ellipse at 0 0,
        color-mix(in srgb, var(--surface-panel) 60%, transparent),
        transparent 45%
      ),
      linear-gradient(180deg, color-mix(in srgb, var(--surface-root) 90%, black), var(--surface-sunken));
  }

  .error-banner {
    border: 1px solid var(--signal-block);
    background: var(--surface-glass-strong);
    color: var(--text-100);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--control-radius);
    font-size: var(--text-sm);
  }

  .loading {
    color: var(--text-60);
    font-size: var(--text-sm);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--line-glass-strong);
    border-radius: var(--control-radius);
    background: var(--surface-glass);
  }

  @media (max-width: 1200px) {
    .top-chrome-main {
      grid-template-columns: 1fr;
      gap: var(--space-2);
    }

    .top-chrome-search {
      max-width: none;
      width: 100%;
    }

    .top-chrome-actions {
      flex-wrap: wrap;
      justify-content: flex-start;
    }
  }

  @media (max-width: 760px) {
    .workbench-shell {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr;
      height: auto;
      min-height: 100vh;
      overflow: visible;
    }

    .workbench-rail {
      order: 2;
      height: auto;
      border-right: none;
      border-top: 1px solid var(--line-chrome);
      box-shadow: none;
    }

    .workbench-stage {
      order: 1;
      overflow: visible;
    }

    .workbench-primary {
      overflow: visible;
    }
  }
</style>
